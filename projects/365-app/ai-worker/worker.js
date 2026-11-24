// Kwantoww advice server for Cloudflare Workers.
// Secrets: BOT_TOKEN (from @BotFather), GEMINI_KEY (from Google AI Studio).
// Vars: ALLOWED_ORIGIN, GEMINI_MODEL, DAILY_LIMIT, APP_URL, ADMIN_IDS (Telegram user ids через запятую).
// Bindings: KV LIMITS (лимиты, история чата, сводка дня), D1 DB (пользователи, события, очередь записей).
// Vars (необязательно): REMIND_MINUTES — за сколько минут напоминать о событии (по умолчанию 15).
// Routes: POST /advice, /ask, /sync, /inbox, /inbox/ack, /reminders (from the mini app), POST /telegram (bot webhook). Cron: напоминания.
import { parseEntries, entriesFromAI, AI_EXTRACT_PROMPT, parseEvent, eventCmd, localNow } from "./parse.js";

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

// Как отвечать на свои вопросы людей (и в приложении, и в чате): коротко, понятно, полезно.
const ASK_STYLE = "Отвечай по-русски, простыми словами, как умный друг. Сначала прямой ответ одной фразой, " +
  "потом 1–3 конкретных шага, которые человек может сделать сегодня. Всего не больше 60 слов. " +
  "Если в данных пользователя есть что-то по теме вопроса (цифры за день, цели), используй это. " +
  "Не выдумывай факты и цифры. Без markdown, без эмодзи, без приветствий. " +
  "Про здоровье: общие советы, без диагнозов и лекарств; при тревожных симптомах — к врачу. Про деньги: без советов купить конкретные акции или криптовалюту.";

const CHAT_PROMPT = "Ты помощник в личном приложении Kwantoww: задачи, привычки, здоровье, питание, финансы. " + ASK_STYLE + " " +
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
      else if (update.callback_query) ctx.waitUntil(handleCallback(update.callback_query, env));
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

    // Ближайшие события из календаря приложения: сервер напомнит о них в чате.
    if (path === "/reminders") {
      if (!env.DB) return reply(200, { ok: true });
      await syncReminders(env, user, body);
      return reply(200, { ok: true });
    }

    // Свой вопрос ИИ из приложения.
    if (path === "/ask") {
      const q = typeof body.question === "string" ? body.question.trim().slice(0, 600) : "";
      if (!q) return reply(400, { error: "Напишите вопрос" });
      if (!(await takeQuota(user.id, env))) return reply(429, { error: `На сегодня вопросы закончились (${env.DAILY_LIMIT} в день). Завтра будут снова` });
      await track(env, user, "ask");
      const ctxText = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT) : "";
      const hist = (Array.isArray(body.history) ? body.history : []).slice(-3)
        .flatMap((h) => [{ role: "user", parts: [{ text: String(h.q || "").slice(0, 600) }] }, { role: "model", parts: [{ text: String(h.a || "").slice(0, 1200) }] }]);
      const system = `Ты помощник в личном приложении Kwantoww. ${ASK_STYLE}${ctxText ? `\n\nДанные пользователя за сегодня:\n${ctxText}` : ""}`;
      const text = await askGemini(env, system, [...hist, { role: "user", parts: [{ text: q }] }], { maxTokens: 400 });
      if (text === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
      return reply(200, { text: text || "Не знаю, что ответить. Попробуйте спросить иначе" });
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
  // Раз в минуту: кому пора напомнить о событии.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([sendDueReminders(env), sendCheckins(env), ensureWebhookOnce(env)]));
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

// ---- напоминания о событиях ----
const remindLead = (env) => (Number(env.REMIND_MINUTES) || 15) * 60000;
const validTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

async function syncReminders(env, user, body) {
  const tz = typeof body.tz === "string" && validTz(body.tz) ? body.tz : null;
  if (tz) await env.DB.prepare("UPDATE users SET tz = ? WHERE id = ?").bind(tz, user.id).run();
  const now = Date.now();
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((x) => x && typeof x.key === "string" && Number.isFinite(+x.at) && +x.at > now - 3600000 && +x.at < now + 31 * 86400000)
    .slice(0, 200)
    .map((x) => ({ key: x.key.slice(0, 40), title: String(x.title || "Событие").slice(0, 120), at: Math.round(+x.at), time: String(x.time || "").slice(0, 5) }));
  const keys = items.map((x) => x.key);
  // Удаляем то, чего в календаре больше нет. Событие из чата, ещё не забранное приложением, не трогаем.
  await env.DB.prepare(
    `DELETE FROM reminders WHERE user_id = ? AND sent = 0 ${keys.length ? `AND key NOT IN (${keys.map(() => "?").join(",")})` : ""}
     AND (key NOT LIKE 'c%' OR CAST(substr(key, 2) AS INTEGER) IN (SELECT id FROM inbox WHERE user_id = ? AND done = 1))`
  ).bind(user.id, ...keys, user.id).run();
  if (items.length) {
    await env.DB.batch(items.map((x) => env.DB.prepare(
      `INSERT INTO reminders (user_id, key, title, at, time, sent) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(user_id, key) DO UPDATE SET title = excluded.title, time = excluded.time,
         sent = CASE WHEN reminders.at = excluded.at THEN reminders.sent ELSE 0 END, at = excluded.at`
    ).bind(user.id, x.key, x.title, x.at, x.time)));
  }
}

export async function sendDueReminders(env, now = Date.now()) {
  if (!env.DB) return 0;
  const lead = remindLead(env);
  const due = (await env.DB.prepare("SELECT r.id, r.user_id, r.title, r.at, r.time FROM reminders r JOIN users u ON u.id = r.user_id WHERE r.sent = 0 AND r.at - ? <= ? AND r.at > ? AND u.blocked = 0 LIMIT 100")
    .bind(lead, now, now - 10 * 60000).all()).results || [];
  for (const r of due) {
    const mins = Math.max(0, Math.round((r.at - now) / 60000));
    const when = mins <= 1 ? "сейчас" : `через ${mins} мин`;
    await env.DB.prepare("UPDATE reminders SET sent = 1 WHERE id = ?").bind(r.id).run();
    await sendMessage(env, r.user_id, `⏰ ${when}: ${r.title}${r.time ? ` (в ${r.time})` : ""}\nНе опаздывайте!`, true).catch(() => {});
  }
  // старые записи чистим, чтобы база не росла
  await env.DB.prepare("DELETE FROM reminders WHERE at < ?").bind(now - 7 * 86400000).run();
  return due.length;
}

// ---- голосовые: Telegram → Gemini (распознавание речи) ----
async function transcribe(env, media) {
  try {
    const f = await (await telegram(env, "getFile", { file_id: media.file_id })).json();
    const path = f.result?.file_path;
    if (!path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mime = media.mime_type || "audio/ogg";
    const out = await askGemini(env, "Перепиши речь из аудио дословно, на том языке, на котором говорят. Только текст, без комментариев. Если речи нет, верни пустую строку.",
      [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: btoa(bin) } }, { text: "Распознай речь." }] }], { maxTokens: 300, json: false, temperature: 0 });
    return out ? out.replace(/^["«]|["»]$/g, "").trim() : null;
  } catch (e) {
    console.log("transcribe error", String(e));
    return null;
  }
}

// ---- вопросы-кнопки: утром про сон, вечером про шаги и воду ----
const CHECK_SLEEP = [5, 6, 7, 8, 9, 10];
const CHECK_STEPS = [2000, 4000, 6000, 8000, 10000, 12000];
const CHECK_WATER = [500, 1000, 1500, 2000, 2500, 3000];
const kb = (rows) => ({ inline_keyboard: rows });
const chunk = (arr, n) => arr.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);

async function sendCheckinSettings(env, chatId, userId) {
  if (!env.DB) return sendMessage(env, chatId, "Вопросы пока недоступны.");
  const u = await env.DB.prepare("SELECT checkin_on, morning_h, evening_h, tz FROM users WHERE id = ?").bind(userId).first();
  const on = u?.checkin_on === 1, m = u?.morning_h ?? 8, e = u?.evening_h ?? 21;
  const text = `🗓 Ежедневные вопросы: ${on ? "включены" : "выключены"}\n\nУтром в ${m}:00 спрошу, сколько вы спали. Вечером в ${e}:00 — сколько шагов и воды. Ответ — одно нажатие на кнопку.${u?.tz ? "" : "\n\nВремя пока московское. Откройте приложение один раз, и я узнаю ваш часовой пояс."}`;
  return telegram(env, "sendMessage", { chat_id: chatId, text, reply_markup: kb([
    [{ text: on ? "🔕 Выключить" : "🔔 Включить", callback_data: on ? "ci:off" : "ci:on" }],
    [6, 7, 8, 9, 10].map((h) => ({ text: `${h === m ? "✅ " : ""}утро ${h}:00`, callback_data: `ci:m:${h}` })).slice(0, 5),
    [20, 21, 22, 23].map((h) => ({ text: `${h === e ? "✅ " : ""}вечер ${h}:00`, callback_data: `ci:e:${h}` })),
  ]) });
}

const sleepKb = () => kb([...chunk(CHECK_SLEEP.map((h) => ({ text: `${h} ч`, callback_data: `ci:sleep:${h}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);
const stepsKb = () => kb([...chunk(CHECK_STEPS.map((n) => ({ text: n >= 12000 ? "12 000+" : `~${n / 1000} 000`, callback_data: `ci:steps:${n}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);
const waterKb = () => kb([...chunk(CHECK_WATER.map((ml) => ({ text: `${ml / 1000} л`.replace(".", ","), callback_data: `ci:water:${ml}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);

export async function sendCheckins(env, now = Date.now()) {
  if (!env.DB) return 0;
  const users = (await env.DB.prepare("SELECT id, tz, morning_h, evening_h, last_m, last_e FROM users WHERE checkin_on = 1 AND blocked = 0 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const u of users) {
    const tz = u.tz || "Europe/Moscow";
    const l = localNow(tz, now);
    const day = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
    if (l.hh === (u.morning_h ?? 8) && u.last_m !== day) {
      await env.DB.prepare("UPDATE users SET last_m = ? WHERE id = ?").bind(day, u.id).run();
      await telegram(env, "sendMessage", { chat_id: u.id, text: "☀️ Доброе утро! Сколько вы спали сегодня?", reply_markup: sleepKb() }).catch(() => {});
      n++;
    }
    if (l.hh === (u.evening_h ?? 21) && u.last_e !== day) {
      await env.DB.prepare("UPDATE users SET last_e = ? WHERE id = ?").bind(day, u.id).run();
      await telegram(env, "sendMessage", { chat_id: u.id, text: "🌙 Итоги дня. Сколько примерно шагов вы прошли?", reply_markup: stepsKb() }).catch(() => {});
      n++;
    }
  }
  return n;
}

async function handleCallback(q, env) {
  const data = String(q.data || ""), userId = q.from.id, chatId = q.message?.chat?.id ?? userId, msgId = q.message?.message_id;
  const answer = (text) => telegram(env, "answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  const edit = (text, markup) => telegram(env, "editMessageText", { chat_id: chatId, message_id: msgId, text, ...(markup ? { reply_markup: markup } : {}) });
  if (!data.startsWith("ci:") || !env.DB) return answer();
  await track(env, q.from, "checkin");
  const [, kind, val] = data.split(":");
  if (kind === "on" || kind === "off") {
    await env.DB.prepare("UPDATE users SET checkin_on = ? WHERE id = ?").bind(kind === "on" ? 1 : 0, userId).run();
    await answer(kind === "on" ? "Включено" : "Выключено");
    return sendCheckinSettings(env, chatId, userId);
  }
  if (kind === "m" || kind === "e") {
    const h = Number(val);
    if (!(h >= 0 && h <= 23)) return answer();
    await env.DB.prepare(`UPDATE users SET ${kind === "m" ? "morning_h" : "evening_h"} = ?, checkin_on = 1 WHERE id = ?`).bind(h, userId).run();
    await answer(`Буду спрашивать в ${h}:00`);
    return sendCheckinSettings(env, chatId, userId);
  }
  if (kind === "skip") { await answer("Хорошо"); return edit("Пропустили. До завтра!"); }
  const v = Number(val);
  const ts = Date.now();
  const save = (cmd) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, cmd, ts).run();
  if (kind === "sleep" && CHECK_SLEEP.includes(v)) {
    await save(`sleep_${v}`); await answer("Записал");
    return edit(`✅ Сон: ${v} ч. Хорошего дня!`);
  }
  if (kind === "steps" && CHECK_STEPS.includes(v)) {
    await save(`steps_${v}`); await answer("Записал");
    return edit(`✅ Шаги: ${v >= 12000 ? "12 000+" : "около " + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}\n\n💧 А сколько воды выпили за день?`, waterKb());
  }
  if (kind === "water" && CHECK_WATER.includes(v)) {
    await env.DB.prepare("DELETE FROM inbox WHERE user_id = ? AND cmd LIKE 'water_%' AND done = 0 AND ts > ?").bind(userId, ts - 3600000).run();
    await save(`water_${v}`); await answer("Записал");
    return edit(`✅ Вода: ${String(v / 1000).replace(".", ",")} л. Отличный день, спокойной ночи!\n\nВ приложении появится при следующем открытии.`);
  }
  return answer();
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
  const asks = await one("SELECT COUNT(*) c FROM events WHERE type = 'ask' AND ts >= ?", now - D);
  const rec = await one("SELECT COUNT(*) c FROM inbox WHERE ts >= ?", now - D);
  const pending = await one("SELECT COUNT(*) c FROM inbox WHERE done = 0");
  const remSent = await one("SELECT COUNT(*) c FROM reminders WHERE sent = 1 AND at >= ?", now - D);
  const remWait = await one("SELECT COUNT(*) c FROM reminders WHERE sent = 0 AND at >= ?", now);
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
    `Сообщений боту за сутки: ${msgs}, вопросов ИИ из приложения: ${asks}`,
    `Записей из чата за сутки: ${rec} (ждут открытия приложения: ${pending})`,
    `Напоминаний отправлено за сутки: ${remSent}, впереди: ${remWait}`,
    kinds.length ? `Что записывают (7 дней): ${kinds.map((k) => `${names[k.k] || k.k} ${k.c}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// Бот должен получать события «заблокировал»: проверяем вебхук и, если нужно, включаем их, не меняя адрес и секрет.
async function ensureWebhookUpdates(env) {
  const info = await (await telegram(env, "getWebhookInfo", {})).json();
  const url = info.result?.url;
  const allowed = info.result?.allowed_updates || [];
  // пустой список = все типы, my_chat_member уже входит
  const need = ["message", "my_chat_member", "callback_query"];
  if (url && allowed.length && need.some((x) => !allowed.includes(x))) {
    await telegram(env, "setWebhook", { url, secret_token: await webhookSecret(env.BOT_TOKEN), allowed_updates: [...new Set([...allowed, ...need])] });
  }
}
// Один раз после выкладки: кнопки бота должны доходить до сервера.
async function ensureWebhookOnce(env) {
  const flag = "webhook-updates-v2";
  if (await env.LIMITS.get(flag)) return;
  await ensureWebhookUpdates(env);
  await env.LIMITS.put(flag, "1");
}

async function saveEntries(env, userId, entries, ts) {
  await env.DB.batch(entries.map((e) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, e.cmd, ts)));
}

async function handleMessage(message, env) {
  if (!message?.from || !(message.text || message.voice || message.audio)) return;
  const chatId = message.chat.id, userId = message.from.id;
  let text = (message.text || "").trim();
  if (!text) {
    // Голосовое: распознаём речь и дальше обрабатываем как обычный текст.
    const media = message.voice || message.audio;
    if ((media.duration || 0) > 120) return sendMessage(env, chatId, "Голосовое длиннее 2 минут, такие я не разбираю. Скажите короче, пожалуйста.");
    if (!(await takeQuota(userId, env))) return sendMessage(env, chatId, `На сегодня запросы закончились (${env.DAILY_LIMIT} в день). Завтра продолжим`);
    await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    text = (await transcribe(env, media)) || "";
    await track(env, message.from, "voice");
    if (!text) return sendMessage(env, chatId, "Не разобрал голосовое. Попробуйте ещё раз или напишите текстом.");
    await sendMessage(env, chatId, `🎤 «${text.slice(0, 300)}»`);
  }
  const histKey = `hist:${userId}`;
  await track(env, message.from, text.startsWith("/start") ? "start" : "message");

  if (text.startsWith("/start")) {
    return sendMessage(env, chatId, `Привет, ${message.from.first_name || ""}! Я помощник Kwantoww.\n\nПиши мне обычными сообщениями, я сам запишу в приложение:\n• «14 000 шагов»\n• «выпил 300 мл воды»\n• «спал 7,5 часов»\n• «потратил 500 на кафе»\n• «план: купить хлеб»\n• «завтра в 12:00 поликлиника» — запишу в календарь и напомню за 15 минут\n\nМожно говорить голосовыми 🎤. А если хотите, буду сам спрашивать утром про сон и вечером про шаги и воду: /checkin\n\nМожно и просто спросить совет про деньги, питание, привычки.\n\n/reset — начать разговор заново`, true);
  }
  if (text.startsWith("/admin")) {
    if (!isAdmin(env, userId)) return sendMessage(env, chatId, "Эта команда только для администратора.");
    await ensureWebhookUpdates(env).catch(() => {});
    return sendMessage(env, chatId, await adminText(env));
  }
  if (text.startsWith("/checkin") || text.startsWith("/вопросы")) return sendCheckinSettings(env, chatId, userId);
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
  if (!entries.length && env.DB) {
    const u = await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(userId).first();
    const tz = u?.tz || "Europe/Moscow";
    const ev = parseEvent(text, tz);
    if (ev) {
      const ts = (message.date || Math.floor(Date.now() / 1000)) * 1000;
      const res = await env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, eventCmd(ev), ts).run();
      const inboxId = res.meta?.last_row_id ?? res.lastInsertRowid;
      await env.DB.prepare("INSERT INTO reminders (user_id, key, title, at, time, sent) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(user_id, key) DO NOTHING")
        .bind(userId, "c" + inboxId, ev.title, ev.at, ev.time).run();
      const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }).format(new Date(ev.date + "T12:00:00Z"));
      const lead = Math.round(remindLead(env) / 60000);
      return sendMessage(env, chatId, `📅 Записал в календарь: ${ev.title}\n${day}, ${ev.time}${u?.tz ? "" : " (по московскому времени: откройте приложение один раз, и я узнаю ваш часовой пояс)"}\n\n⏰ Напомню за ${lead} минут.`, true);
    }
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
  const answer = await askGemini(env, system, contents, { maxTokens: 400 });
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
async function askGemini(env, system, contents, { json = false, maxTokens = 600, temperature } = {}) {
  const prompt = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: temperature ?? (json ? 0 : 0.6), ...(json ? { responseMimeType: "application/json" } : {}) },
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

