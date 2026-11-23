// Kwantoww advice server for Cloudflare Workers.
// Secrets: BOT_TOKEN (from @BotFather), GEMINI_KEY (from Google AI Studio).
// Vars: ALLOWED_ORIGIN, GEMINI_MODEL, DAILY_LIMIT, APP_URL. KV binding: LIMITS.
// Routes: POST /advice and /sync (from the mini app), POST /telegram (bot webhook).

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
  "Записывать что-то в приложение ты не можешь: если просят записать, подскажи нажать кнопку «Открыть» и записать там.";

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
      ctx.waitUntil(handleMessage(update.message, env));
      return new Response("ok");
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "Неверный запрос" });
    }
    const { section, context, initData } = body;
    if (typeof context !== "string" || !context) return reply(400, { error: "Неверный запрос" });
    const user = await telegramUser(initData, env.BOT_TOKEN);
    if (!user) return reply(401, { error: "Советы работают только внутри Telegram-бота" });

    if (path === "/sync") {
      await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
      return reply(200, { ok: true });
    }
    if (path !== "/advice" || !PROMPTS[section]) return reply(404, { error: "Not found" });

    if (!(await takeQuota(user.id, env))) return reply(429, { error: `На сегодня советы закончились (${env.DAILY_LIMIT} в день). Завтра будут снова` });
    // only the overview carries every section; a section's advice must not overwrite the full picture
    if (section === "overview") await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
    const text = await askGemini(env, `${PROMPTS[section]} ${RULES}`, [{ role: "user", parts: [{ text: `Данные пользователя:\n${context.slice(0, MAX_CONTEXT)}` }] }]);
    if (text === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
    return reply(200, { text: text || "Пока нечего посоветовать: запишите больше данных за день" });
  },
};

async function handleMessage(message, env) {
  if (!message?.text || !message.from) return;
  const chatId = message.chat.id, userId = message.from.id, text = message.text.trim();
  const histKey = `hist:${userId}`;

  if (text.startsWith("/start")) {
    return sendMessage(env, chatId, `Привет, ${message.from.first_name || ""}! Я помощник Kwantoww.\n\nПиши мне вопросы обычными сообщениями: про деньги, питание, привычки, планы. Чтобы я видел твои данные, хотя бы раз открой приложение кнопкой ниже.\n\n/reset — начать разговор заново`, true);
  }
  if (text.startsWith("/reset")) {
    await env.LIMITS.delete(histKey);
    return sendMessage(env, chatId, "Начали заново. О чём поговорим?");
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
async function askGemini(env, system, contents) {
  const prompt = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 600, temperature: 0.6 },
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
