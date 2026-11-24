// Telegram-бот чайханы на Cloudflare Workers.
// Секреты (в коде их нет, только в секретах Worker):
//   BOT_TOKEN       — токен бота от @BotFather
//   WEBHOOK_SECRET  — случайная строка, Telegram присылает её в заголовке
//   OWNER_CHAT_ID   — чат, куда приходят брони (владелец или администратор)
// Привязки: DB (D1) — брони и шаги диалога; AI (Workers AI) — ответы на свободные вопросы, необязательно.

import { business } from "./data.js";

const MAIN_KB = {
  keyboard: [
    [{ text: "📋 Меню" }, { text: "📍 Адреса" }],
    [{ text: "🕒 Часы и телефон" }, { text: "🪑 Забронировать стол" }],
  ],
  resize_keyboard: true,
};

export function menuText(b = business) {
  const lines = [`<b>Меню — ${b.name}</b>`];
  for (const cat of b.menu) {
    lines.push("", `<b>${cat.category}</b>`);
    for (const it of cat.items) lines.push(`• ${it.name} — ${it.price} ${b.currency}`);
  }
  if (b.demoPrices) lines.push("", "<i>Цены примерные, уточняйте у официанта.</i>");
  return lines.join("\n");
}

export function addressText(b = business) {
  return ["<b>Наши адреса</b>", ...b.branches.map((x) => `📍 ${x.address}`)].join("\n");
}

export function hoursText(b = business) {
  return `🕒 Работаем ${b.hours}\n📞 ${b.phone}`;
}

function helloText(b = business) {
  return `Ассалому алейкум! Я бот ${b.name} (${b.cuisine}).\nЯ — бот, а не человек. Подскажу меню, адреса и забронирую стол. Если нужен живой человек, напишите «человек».`;
}

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

// ---- шаги диалога брони (хранятся в D1) ----
async function getState(env, chatId) {
  const row = await env.DB.prepare("SELECT step, data FROM sessions WHERE chat_id = ?").bind(chatId).first();
  return row ? { step: row.step, data: JSON.parse(row.data || "{}") } : null;
}
async function setState(env, chatId, step, data) {
  await env.DB.prepare(
    "INSERT INTO sessions (chat_id, step, data) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET step = excluded.step, data = excluded.data"
  ).bind(chatId, step, JSON.stringify(data)).run();
}
async function clearState(env, chatId) {
  await env.DB.prepare("DELETE FROM sessions WHERE chat_id = ?").bind(chatId).run();
}

async function bookingStep(env, chatId, text, state, from) {
  const d = state.data;
  if (state.step === "branch") {
    const br = business.branches.find((x) => text.includes(x.title));
    if (!br) return send(env, chatId, "Выберите адрес кнопкой ниже.", branchKb());
    d.branch = br.id;
    await setState(env, chatId, "when", d);
    return send(env, chatId, "На какой день и время? Например: «завтра 19:00».", { reply_markup: { remove_keyboard: true } });
  }
  if (state.step === "when") {
    d.when = text.slice(0, 100);
    await setState(env, chatId, "guests", d);
    return send(env, chatId, "Сколько будет гостей?", { reply_markup: { remove_keyboard: true } });
  }
  if (state.step === "guests") {
    const n = parseInt(text, 10);
    if (!n || n < 1 || n > 50) return send(env, chatId, "Напишите число гостей цифрой, например 4.", { reply_markup: { remove_keyboard: true } });
    d.guests = n;
    await setState(env, chatId, "phone", d);
    return send(env, chatId, "Оставьте телефон для связи: нажмите кнопку или напишите номер.", {
      reply_markup: { keyboard: [[{ text: "📱 Отправить номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }
  if (state.step === "phone") {
    d.phone = text.slice(0, 30);
    const br = business.branches.find((x) => x.id === d.branch);
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "гость";
    await env.DB.prepare(
      "INSERT INTO bookings (chat_id, name, branch, when_text, guests, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(chatId, name, d.branch, d.when, d.guests, d.phone, new Date().toISOString()).run();
    await clearState(env, chatId);
    if (env.OWNER_CHAT_ID) {
      await tg(env, "sendMessage", {
        chat_id: env.OWNER_CHAT_ID,
        text: `🪑 Новая бронь\n${br.title}\nКогда: ${d.when}\nГостей: ${d.guests}\nИмя: ${name}\nТелефон: ${d.phone}`,
      });
    }
    return send(env, chatId, `Заявка принята ✅\n${br.title}, ${d.when}, гостей: ${d.guests}.\nАдминистратор подтвердит бронь по телефону.`);
  }
}

function branchKb() {
  return { reply_markup: { keyboard: business.branches.map((x) => [{ text: x.title }]), resize_keyboard: true, one_time_keyboard: true } };
}

// ---- свободный вопрос: ИИ отвечает только по данным заведения ----
async function aiAnswer(env, question) {
  if (!env.AI) return null;
  const facts = [menuText(), addressText(), hoursText()].join("\n\n").replace(/<[^>]+>/g, "");
  const system = `Ты бот-помощник заведения ${business.name}. Ты бот, не человек. Отвечай коротко, вежливо, на языке вопроса. Используй ТОЛЬКО факты ниже. Если ответа в фактах нет, скажи, что не знаешь, и предложи написать «человек». Никогда не придумывай цены, блюда, акции и время.\n\nФАКТЫ:\n${facts}`;
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

  if (low === "/start") { await clearState(env, chatId); return send(env, chatId, helloText()); }
  if (low.includes("отмена")) { await clearState(env, chatId); return send(env, chatId, "Отменил. Чем ещё помочь?"); }

  const state = await getState(env, chatId);
  if (state) return bookingStep(env, chatId, text, state, msg.from);

  if (low.includes("меню") || low.includes("цен")) return send(env, chatId, menuText());
  if (low.includes("адрес") || low.includes("где")) return send(env, chatId, addressText());
  if (low.includes("час") || low.includes("телефон") || low.includes("работ")) return send(env, chatId, hoursText());
  if (low.includes("брон") || low.includes("стол")) {
    await setState(env, chatId, "branch", {});
    return send(env, chatId, "Какой адрес?", branchKb());
  }
  if (low.includes("человек") || low.includes("оператор")) {
    if (env.OWNER_CHAT_ID) await tg(env, "sendMessage", { chat_id: env.OWNER_CHAT_ID, text: `🙋 Гость просит живого человека: ${msg.from?.first_name || ""} (chat ${chatId})` });
    return send(env, chatId, `Передал администратору. Можно и позвонить: ${business.phone}`);
  }

  const ai = await aiAnswer(env, text);
  return send(env, chatId, ai || "Я пока не знаю ответа. Выберите кнопку ниже или напишите «человек».");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      await handleUpdate(env, await request.json());
      return new Response("ok");
    }
    return new Response("Javob bot is running", { status: 200 });
  },
};
