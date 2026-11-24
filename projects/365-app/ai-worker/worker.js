// Kwantoww advice server for Cloudflare Workers.
// Secrets: BOT_TOKEN (from @BotFather), GEMINI_KEY (from Google AI Studio).
// Vars: ALLOWED_ORIGIN, GEMINI_MODEL, DAILY_LIMIT, APP_URL, ADMIN_IDS (Telegram user ids через запятую).
// Bindings: KV LIMITS (лимиты, история чата, сводка дня), D1 DB (пользователи, события, очередь записей).
// Routes: POST /advice, /sync, /inbox, /inbox/ack (from the mini app), POST /telegram (bot webhook).
import { parseEntries, entriesFromAI, AI_EXTRACT_PROMPT } from "./parse.js";

const RULES = "Отвечай по-русски, коротко: до 3 предложений или до 4 коротких пунктов. " +
  "Опирайся только на данные пользователя ниже, ничего не выдумывай. Сначала главное, потом один конкретный совет. " +
  "Без приветствий, без эмодзи, без markdown. Медицинских диагнозов не ставь.";

const PROMPTS = {
  overview: "Ты видишь весь день пользователя. Скажи, что сейчас важнее всего сделать и что уже получается хорошо.",
  tasks: "Ты помогаешь с задачами и календарём. Подскажи, с чего начать, что перенести и где перегруз.",
  habits: "Ты помогаешь с привычками. Отметь, какая привычка проседает и как её удержать.",
  health: "Ты помогаешь со сном, водой, шагами, питанием и тренировками. Сравни с целями и подскажи, что поправить сегодня.",
  money: "Ты помогаешь с личными финансами. Найди, куда уходит больше всего денег, и предложи одну реальную экономию.",
};

const MAX_CONTEXT = 6000;
const AUTH_MAX_AGE = 24 * 60 * 60;
const HISTORY = 12;
const DAY_TTL = 2 * 24 * 60 * 60;
const CONTEXT_TTL = 14 * 24 * 60 * 60;

const CHAT_PROMPT = "Ты помощник в личном приложении Kwantoww: задачи, привычки, здоровье, питание, финансы. " +
  "Отвечай как живой собеседник, коротко и по делу. Если в сообщении есть данные пользователя, опирайся на них. " +
  "Записи вроде «выпил 200 мл воды» или «14000 шагов» бот сохраняет сам, отдельно от тебя: ты на них не отвечай.";

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return reply(404, { error: "Not found" });

    if (path === "/telegram") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env.BOT_TOKEN))) return new Response("forbidden", { status: 403 });
      const update = await request.json();
      // answer Telegram at once; a slow model reply would make it resend the update
      if (update.my_chat_member) ctx.waitUntil(handleMember(update.my_chat_member, env));
      else ctx.waitUntil(handleMessage(update.message, env));
      return new Response("ok");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "Неверный запрос" });
    }
    const user = await telegramUser(body.initData, env.BOT_TOKEN);
    if (!user) return reply(401, { error: "Советы работают только внутри Telegram-бота" });

    // Записи, которые человек отправил боту в чате: приложение забирает их и записывает у себя.
    if (path === "/inbox") {
      if (!env.DB) return reply(200, { items: [] });
      const rows = await env.DB.prepare("SELECT id, cmd, ts FROM inbox WHERE user_id = ? AND done = 0 ORDER BY id LIMIT 100").bind(user.id).all();
      return reply(200, { items: rows.results || [] });
    }
    if (path === "/inbox/ack") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
      if (env.DB && ids.length) {
        await env.DB.prepare(`UPDATE inbox SET done = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(user.id, ...ids).run();
      }
      return reply(200, { ok: true });
    }

    const { section, context } = body;
    if (typeof context !== "string" || !context) return reply(400, { error: "Неверный запрос" });

    if (path === "/sync") {
      await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
      await track(env, user, "app_open");
      return reply(200, { ok: true });
    }
    if (path !== "/advice" || !PROMPTS[section]) return reply(404, { error: "Not found" });

    if (!(await takeQuota(user.id, env))) return reply(429, { error: `На сегодня советы закончились (${env.DAILY_LIMIT} в день). Завтра будут снова` });
    await track(env, user, `advice_${section}`);
    // only the overview carries every section; a section's advice must not overwrite the full picture
    if (section === "overview") await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
    const text = await askGemini(env, `${PROMPTS[section]} ${RULES}`, [{ role: "user", parts: [{ text: `Данные пользователя:\n${context.slice(0, MAX_CONTEXT)}` }] }]);
    if (text === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
    return reply(200, { text: text || "Пока нечего посоветовать: запишите больше данных за день" });
  },
};

// ---- учёт пользователей и событий (D1). Без базы бот работает, просто без статистики и записей из чата. ----
async function track(env, from, type) {
  if (!env.DB || !from?.id) return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, first_name, username, lang, first_seen, last_seen, blocked) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username, last_seen = excluded.last_seen, blocked = 0`
    ).bind(from.id, from.first_name || null, from.username || null, from.language_code || null, now, now),
    env.DB.prepare("INSERT INTO events (user_id, type, ts) VALUES (?, ?, ?)").bind(from.id, type, now),
  ]);
}

// Человек заблокировал бота или вернулся: Telegram присылает my_chat_member.
async function handleMember(m, env) {
  if (!env.DB || m.chat?.type !== "private") return;
  const status = m.new_chat_member?.status;
  if (status === "kicked") {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET blocked = 1 WHERE id = ?").bind(m.from.id),
      env.DB.prepare("INSERT INTO events (user_id, type, ts) VALUES (?, 'left', ?)").bind(m.from.id, Date.now()),
    ]);
  } else if (status === "member") {
    await track(env, m.from, "returned");
  }
}

const isAdmin = (env, id) => String(env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(String(id));

export async function adminText(env) {
  if (!env.DB) return "База статистики не подключена (привязка D1 DB).";
  const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first())?.c ?? 0;
  const D = 86400000, now = Date.now();
  const total = await one("SELECT COUNT(*) c FROM users");
  const blocked = await one("SELECT COUNT(*) c FROM users WHERE blocked = 1");
  const newDay = await one("SELECT COUNT(*) c FROM users WHERE first_seen >= ?", now - D);
  const newWeek = await one("SELECT COUNT(*) c FROM users WHERE first_seen >= ?", now - 7 * D);
  const leftWeek = await one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE type = 'left' AND ts >= ?", now - 7 * D);
  const dau = await one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE ts >= ?", now - D);
  const wau = await one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE ts >= ?", now - 7 * D);
  const mau = await one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE ts >= ?", now - 30 * D);
  const opens = await one("SELECT COUNT(*) c FROM events WHERE type = 'app_open' AND ts >= ?", now - D);
  const msgs = await one("SELECT COUNT(*) c FROM events WHERE type = 'message' AND ts >= ?", now - D);
  const rec = await one("SELECT COUNT(*) c FROM inbox WHERE ts >= ?", now - D);
  const pending = await one("SELECT COUNT(*) c FROM inbox WHERE done = 0");
  const kinds = (await env.DB.prepare("SELECT substr(cmd, 1, instr(cmd, '_') - 1) k, COUNT(*) c FROM inbox WHERE ts >= ? GROUP BY k ORDER BY c DESC").bind(now - 7 * D).all()).results || [];
  const names = { steps: "шаги", water: "вода", sleep: "сон", weight: "вес", exp: "расходы", inc: "доходы", mood: "настроение", energy: "энергия", meal: "еда", task: "задачи" };
  return [
    "📊 Kwantoww: статистика",
    "",
    `Всего пользователей: ${total} (заблокировали бота: ${blocked})`,
    `Новых: ${newDay} за сутки, ${newWeek} за неделю`,
    `Ушли (заблокировали) за неделю: ${leftWeek}`,
    `Активных: ${dau} за сутки · ${wau} за 7 дней · ${mau} за 30 дней`,
    `Открытий приложения за сутки: ${opens}`,
    `Сообщений боту за сутки: ${msgs}`,
    `Записей из чата за сутки: ${rec} (ждут открытия приложения: ${pending})`,
    kinds.length ? `Что записывают (7 дней): ${kinds.map((k) => `${names[k.k] || k.k} ${k.c}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// Бот должен получать события «заблокировал»: проверяем вебхук и, если нужно, включаем их, не меняя адрес и секрет.
async function ensureWebhookUpdates(env) {
  const info = await (await telegram(env, "getWebhookInfo", {})).json();
  const url = info.result?.url;
  const allowed = info.result?.allowed_updates || [];
  // пустой список = все типы, my_chat_member уже входит
  if (url && allowed.length && !allowed.includes("my_chat_member")) {
    await telegram(env, "setWebhook", { url, secret_token: await webhookSecret(env.BOT_TOKEN), allowed_updates: [...new Set([...allowed, "message", "my_chat_member"])] });
  }
}

async function saveEntries(env, userId, entries, ts) {
  await env.DB.batch(entries.map((e) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, e.cmd, ts)));
}

async function handleMessage(message, env) {
  if (!message?.text || !message.from) return;
  const chatId = message.chat.id, userId = message.from.id, text = message.text.trim();
  const histKey = `hist:${userId}`;
  await track(env, message.from, text.startsWith("/start") ? "start" : "message");

  if (text.startsWith("/start")) {
    return sendMessage(env, chatId, `Привет, ${message.from.first_name || ""}! Я помощник Kwantoww.\n\nПиши мне обычными сообщениями, я сам запишу в приложение:\n• «14 000 шагов»\n• «выпил 300 мл воды»\n• «спал 7,5 часов»\n• «потратил 500 на кафе»\n• «план: купить хлеб»\n\nМожно и просто спросить совет про деньги, питание, привычки.\n\n/reset — начать разговор заново`, true);
  }
  if (text.startsWith("/admin")) {
    if (!isAdmin(env, userId)) return sendMessage(env, chatId, "Эта команда только для администратора.");
    await ensureWebhookUpdates(env).catch(() => {});
    return sendMessage(env, chatId, await adminText(env));
  }
  if (text.startsWith("/myid")) return sendMessage(env, chatId, `Ваш Telegram ID: ${userId}`);
  if (text.startsWith("/reset")) {
    await env.LIMITS.delete(histKey);
    return sendMessage(env, chatId, "Начали заново. О чём поговорим?");
  }

  // 1) записи обычным кодом; 2) если в сообщении есть числа, но код не понял — спрашиваем ИИ; 3) иначе разговор.
  let entries = parseEntries(text);
  if (!entries.length && /\d/.test(text) && text.length <= 500 && env.GEMINI_KEY) {
    const json = await askGemini(env, AI_EXTRACT_PROMPT, [{ role: "user", parts: [{ text }] }], { json: true, maxTokens: 400 });
    try { entries = entriesFromAI(JSON.parse(json || "[]")); } catch { entries = []; }
  }
  if (entries.length) {
    if (!env.DB) return sendMessage(env, chatId, "Записи из чата пока не подключены. Запишите в приложении.", true);
    await saveEntries(env, userId, entries, (message.date || Math.floor(Date.now() / 1000)) * 1000);
    return sendMessage(env, chatId, `Записал ✅\n${entries.map((e) => "• " + e.label).join("\n")}\n\nВ приложении появится при следующем открытии.`, true);
  }

  if (!(await takeQuota(userId, env))) return sendMessage(env, chatId, `На сегодня сообщения закончились (${env.DAILY_LIMIT} в день). Завтра продолжим`);
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const history = JSON.parse((await env.LIMITS.get(histKey)) || "[]");
  const context = await env.LIMITS.get(`ctx:${userId}`);
  const system = `${CHAT_PROMPT} ${RULES}${context ? `\n\nДанные пользователя из приложения:\n${context}` : "\n\nДанных из приложения пока нет."}`;
  const contents = [...history, { role: "user", parts: [{ text: text.slice(0, 2000) }] }];
  const answer = await askGemini(env, system, contents);
  if (answer === null) return sendMessage(env, chatId, "ИИ сейчас недоступен. Попробуй через минуту");
  const reply = answer || "Не знаю, что ответить. Попробуй спросить иначе";
  contents.push({ role: "model", parts: [{ text: reply }] });
  await env.LIMITS.put(histKey, JSON.stringify(contents.slice(-HISTORY)), { expirationTtl: CONTEXT_TTL });
  return sendMessage(env, chatId, reply);
}

async function takeQuota(userId, env) {
  const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.LIMITS.get(key)) || 0;
  if (used >= Number(env.DAILY_LIMIT)) return false;
  await env.LIMITS.put(key, String(used + 1), { expirationTtl: DAY_TTL });
  return true;
}

// Returns the answer text, or null when every configured model failed.
// Free-tier models get retired or overloaded, so GEMINI_MODEL is a list tried in order.
async function askGemini(env, system, contents, { json = false, maxTokens = 600 } = {}) {
  const prompt = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: json ? 0 : 0.6, ...(json ? { responseMimeType: "application/json" } : {}) },
  });
  for (const model of env.GEMINI_MODEL.split(",").map((m) => m.trim())) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: prompt,
    });
    if (res.ok) {
      const data = await res.json();
      return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("").trim();
    }
    console.log("gemini error", model, res.status, await res.text());
  }
  return null;
}

function telegram(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function sendMessage(env, chatId, text, withAppButton = false) {
  const payload = { chat_id: chatId, text };
  if (withAppButton) payload.reply_markup = { inline_keyboard: [[{ text: "Открыть Kwantoww", web_app: { url: env.APP_URL } }]] };
  return telegram(env, "sendMessage", payload);
}

// The webhook secret is derived from the bot token so no extra secret has to be configured.
async function webhookSecret(botToken) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`webhook:${botToken}`));
  return [...new Uint8Array(digest)].slice(0, 24).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Telegram Mini App auth: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function telegramUser(initData, botToken) {
  if (typeof initData !== "string" || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");

  const enc = new TextEncoder();
  const hmac = async (key, msg) => {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
  };
  const secret = await hmac(enc.encode("WebAppData"), enc.encode(botToken));
  const expected = [...(await hmac(secret, enc.encode(checkString)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > AUTH_MAX_AGE) return null;
  return JSON.parse(params.get("user") || "null");
}

