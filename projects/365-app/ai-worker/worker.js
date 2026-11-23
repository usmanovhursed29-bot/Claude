// Kwantoww advice server for Cloudflare Workers.
// Secrets: BOT_TOKEN (from @BotFather), GEMINI_KEY (from Google AI Studio).
// Vars: ALLOWED_ORIGIN, GEMINI_MODEL, DAILY_LIMIT. KV binding: LIMITS.

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

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/advice") return reply(404, { error: "Not found" });

    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "Неверный запрос" });
    }
    const { section, context, initData } = body;
    if (!PROMPTS[section] || typeof context !== "string" || !context) return reply(400, { error: "Неверный запрос" });

    const user = await telegramUser(initData, env.BOT_TOKEN);
    if (!user) return reply(401, { error: "Советы работают только внутри Telegram-бота" });

    const day = new Date().toISOString().slice(0, 10);
    const key = `${user.id}:${day}`;
    const used = Number(await env.LIMITS.get(key)) || 0;
    const limit = Number(env.DAILY_LIMIT) || 20;
    if (used >= limit) return reply(429, { error: `На сегодня советы закончились (${limit} в день). Завтра будут снова` });
    await env.LIMITS.put(key, String(used + 1), { expirationTtl: 2 * 24 * 60 * 60 });

    // free-tier models get retired or overloaded; try the configured list in order
    const prompt = JSON.stringify({
      systemInstruction: { parts: [{ text: `${PROMPTS[section]} ${RULES}` }] },
      contents: [{ role: "user", parts: [{ text: `Данные пользователя:\n${context.slice(0, MAX_CONTEXT)}` }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.6 },
    });
    let res;
    for (const model of env.GEMINI_MODEL.split(",").map((m) => m.trim())) {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
        body: prompt,
      });
      if (res.ok) break;
      console.log("gemini error", model, res.status, await res.text());
    }
    if (!res.ok) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("").trim();
    return reply(200, { text: text || "Пока нечего посоветовать: запишите больше данных за день" });
  },
};

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
