// Javob: один Telegram-бот на много бизнесов. Cloudflare Workers + D1.
// Гость приходит по ссылке t.me/<бот>?start=<slug>, и бот отвечает от имени этого бизнеса.
// Секреты (только в секретах Worker, в коде их нет):
//   BOT_TOKEN       — токен бота от @BotFather
//   WEBHOOK_SECRET  — случайная строка; Telegram присылает её в заголовке
// Привязки: DB (D1) — к какому бизнесу привязан чат, шаги брони, брони; AI (Workers AI) — свободные вопросы, необязательно.

import { tenants, bySlug } from "./tenants/index.js";

const MAIN_KB = {
  keyboard: [
    [{ text: "📋 Меню" }, { text: "📍 Адреса" }],
    [{ text: "🕒 Часы и телефон" }, { text: "🪑 Забронировать стол" }],
  ],
  resize_keyboard: true,
};

export function menuText(b) {
  const lines = [`<b>Меню — ${b.name}</b>`];
  for (const cat of b.menu) {
    lines.push("", `<b>${cat.category}</b>`);
    for (const it of cat.items) lines.push(`• ${it.name} — ${it.price} ${b.currency}`);
  }
  if (b.demoPrices) lines.push("", "<i>Цены примерные, уточняйте у официанта.</i>");
  return lines.join("\n");
}
export const addressText = (b) => ["<b>Наши адреса</b>", ...b.branches.map((x) => `📍 ${x.address}`)].join("\n");
export const hoursText = (b) => `🕒 Работаем ${b.hours}\n📞 ${b.phone}`;
const helloText = (b) =>
  `Ассалому алейкум! Я бот ${b.name} (${b.cuisine}).\nЯ — бот, а не человек. Подскажу меню, адреса и забронирую стол. Если нужен живой человек, напишите «человек».`;
const javobText = () =>
  [
    "Это <b>Javob</b> — ИИ-агенты для бизнеса в Telegram.",
    "Я — бот. Отвечаю клиентам круглосуточно: цены, запись, заказы.",
    "",
    "Посмотрите демо:",
    ...tenants.map((t) => `• ${t.name}: /start ${t.slug}`),
  ].join("\n");

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
const send = (env, chat_id, text, extra = {}) =>
  tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", reply_markup: MAIN_KB, ...extra });

// ---- к какому бизнесу привязан чат ----
async function getTenant(env, chatId) {
  const row = await env.DB.prepare("SELECT tenant FROM chats WHERE chat_id = ?").bind(chatId).first();
  return row ? bySlug[row.tenant] || null : null;
}
const setTenant = (env, chatId, slug) =>
  env.DB.prepare("INSERT INTO chats (chat_id, tenant) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET tenant = excluded.tenant")
    .bind(chatId, slug).run();

// ---- шаги брони ----
async function getState(env, chatId) {
  const row = await env.DB.prepare("SELECT step, data FROM sessions WHERE chat_id = ?").bind(chatId).first();
  return row ? { step: row.step, data: JSON.parse(row.data || "{}") } : null;
}
const setState = (env, chatId, step, data) =>
  env.DB.prepare("INSERT INTO sessions (chat_id, step, data) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET step = excluded.step, data = excluded.data")
    .bind(chatId, step, JSON.stringify(data)).run();
const clearState = (env, chatId) => env.DB.prepare("DELETE FROM sessions WHERE chat_id = ?").bind(chatId).run();

const branchKb = (b) => ({
  reply_markup: { keyboard: b.branches.map((x) => [{ text: x.title }]), resize_keyboard: true, one_time_keyboard: true },
});
const noKb = { reply_markup: { remove_keyboard: true } };

async function notifyOwner(env, b, text) {
  if (b.ownerChatId) await tg(env, "sendMessage", { chat_id: b.ownerChatId, text });
}

async function bookingStep(env, b, chatId, text, state, from) {
  const d = state.data;
  if (state.step === "branch") {
    const br = b.branches.find((x) => text.includes(x.title));
    if (!br) return send(env, chatId, "Выберите адрес кнопкой ниже.", branchKb(b));
    d.branch = br.id;
    await setState(env, chatId, "when", d);
    return send(env, chatId, "На какой день и время? Например: «завтра 19:00».", noKb);
  }
  if (state.step === "when") {
    d.when = text.slice(0, 100);
    await setState(env, chatId, "guests", d);
    return send(env, chatId, "Сколько будет гостей?", noKb);
  }
  if (state.step === "guests") {
    const n = parseInt(text, 10);
    if (!n || n < 1 || n > 50) return send(env, chatId, "Напишите число гостей цифрой, например 4.", noKb);
    d.guests = n;
    await setState(env, chatId, "phone", d);
    return send(env, chatId, "Оставьте телефон для связи: нажмите кнопку или напишите номер.", {
      reply_markup: { keyboard: [[{ text: "📱 Отправить номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }
  if (state.step === "phone") {
    d.phone = text.slice(0, 30);
    const br = b.branches.find((x) => x.id === d.branch);
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "гость";
    await env.DB.prepare(
      "INSERT INTO bookings (tenant, chat_id, name, branch, when_text, guests, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(b.slug, chatId, name, d.branch, d.when, d.guests, d.phone, new Date().toISOString()).run();
    await clearState(env, chatId);
    await notifyOwner(env, b, `🪑 Новая бронь — ${b.name}\n${br.title}\nКогда: ${d.when}\nГостей: ${d.guests}\nИмя: ${name}\nТелефон: ${d.phone}`);
    return send(env, chatId, `Заявка принята ✅\n${br.title}, ${d.when}, гостей: ${d.guests}.\nАдминистратор подтвердит бронь по телефону.`);
  }
}

// ---- свободный вопрос: ИИ отвечает только по данным бизнеса ----
async function aiAnswer(env, b, question) {
  if (!env.AI) return null;
  const facts = [menuText(b), addressText(b), hoursText(b)].join("\n\n").replace(/<[^>]+>/g, "");
  const system = `Ты бот-помощник заведения ${b.name}. Ты бот, не человек. Отвечай коротко, вежливо, на языке вопроса. Используй ТОЛЬКО факты ниже. Если ответа в фактах нет, скажи, что не знаешь, и предложи написать «человек». Никогда не придумывай цены, блюда, акции и время.\n\nФАКТЫ:\n${facts}`;
  try {
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "system", content: system }, { role: "user", content: question.slice(0, 500) }],
      max_tokens: 300,
    });
    return out?.response?.trim() || null;
  } catch {
    return null;
  }
}

export async function handleUpdate(env, update) {
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const text = (msg.contact?.phone_number || msg.text || "").trim();
  const low = text.toLowerCase();

  if (low === "/myid") return send(env, chatId, `Номер этого чата: <code>${chatId}</code>`, noKb);

  if (low.startsWith("/start")) {
    await clearState(env, chatId);
    const slug = text.split(/\s+/)[1];
    const b = slug && bySlug[slug];
    if (!b) return send(env, chatId, javobText(), noKb);
    await setTenant(env, chatId, b.slug);
    return send(env, chatId, helloText(b));
  }

  const b = await getTenant(env, chatId);
  if (!b) return send(env, chatId, javobText(), noKb);

  if (low.includes("отмена")) { await clearState(env, chatId); return send(env, chatId, "Отменил. Чем ещё помочь?"); }

  const state = await getState(env, chatId);
  if (state) return bookingStep(env, b, chatId, text, state, msg.from);

  if (low.includes("меню") || low.includes("цен")) return send(env, chatId, menuText(b));
  if (low.includes("адрес") || low.includes("где")) return send(env, chatId, addressText(b));
  if (low.includes("час") || low.includes("телефон") || low.includes("работ")) return send(env, chatId, hoursText(b));
  if (low.includes("брон") || low.includes("стол")) {
    await setState(env, chatId, "branch", {});
    return send(env, chatId, "Какой адрес?", branchKb(b));
  }
  if (low.includes("человек") || low.includes("оператор")) {
    await notifyOwner(env, b, `🙋 Гость просит живого человека: ${msg.from?.first_name || ""} (чат ${chatId})`);
    return send(env, chatId, `Передал администратору. Можно и позвонить: ${b.phone}`);
  }

  const ai = await aiAnswer(env, b, text);
  return send(env, chatId, ai || "Я пока не знаю ответа. Выберите кнопку ниже или напишите «человек».");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secretOk = (v) => env.WEBHOOK_SECRET && v === env.WEBHOOK_SECRET;

    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) return new Response("forbidden", { status: 403 });
      await handleUpdate(env, await request.json());
      return new Response("ok");
    }
    // Подключение вебхука один раз после выкладки: /setup?key=<WEBHOOK_SECRET>
    // Токен бота не покидает Worker.
    if (url.pathname === "/setup") {
      if (!secretOk(url.searchParams.get("key"))) return new Response("forbidden", { status: 403 });
      const res = await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message"],
      });
      return Response.json({ ok: res.ok, description: res.description });
    }
    return new Response("Javob bot is running");
  },
};
