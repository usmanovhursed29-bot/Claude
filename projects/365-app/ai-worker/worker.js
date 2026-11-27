// Kwantoww advice server for Cloudflare Workers.
// Secrets: BOT_TOKEN (from @BotFather), GEMINI_KEY (from Google AI Studio).
// Vars: ALLOWED_ORIGIN, GEMINI_MODEL, DAILY_LIMIT, APP_URL, ADMIN_IDS (Telegram user ids через запятую).
// Bindings: KV LIMITS (лимиты, история чата, сводка дня), D1 DB (пользователи, события, очередь записей).
// Vars (необязательно): REMIND_MINUTES — за сколько минут напоминать о событии (по умолчанию 15).
// Routes: POST /me, /plus-link, /advice, /ask, /sync, /inbox, /inbox/ack, /reminders, /backup, /restore (from the mini app), POST /telegram (bot webhook). Cron: напоминания.
import { saveDays, praise, insights, createChallenge, joinChallenge, leaderboard, boardText, myChallenge, finishChallenges } from "./features.js";
import { parseEntries, entriesFromAI, AI_EXTRACT_PROMPT, parseEvent, eventCmd, localNow } from "./parse.js";
import { isOwner, startJournal, journalAnswer, journalCallback, sendJournal } from "./journal.js";
import { analyzeFood, foodCmd, foodText } from "./food.js";
import { waterCommand, waterCallback, sendWater, waterAdd } from "./water.js";
import { namazCommand, namazCallback, sendNamaz } from "./namaz.js";
import { sendGuide } from "./guide.js";
import { planText, sendMorning, prefs, setPrefs, parseHabit, habitAdd, habitList, sendHabits, habitCallback, onboardStart, onboardCallback, applyReferral, REF_DAYS } from "./daily.js";

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
const BACKUP_KEYS = ["settings", "tasks", "events", "habits", "health", "food", "workouts", "money", "notes", "journal", "chats", "focus", "meta"];
const BACKUP_MAX = 1_800_000; // символов JSON на раздел (лимит строки D1 — 2 МБ)
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

// Характер ИИ (бонус подписки Plus). «Друг» — у всех по умолчанию.
const STYLES = {
  friend: { name: "🤝 Друг", prompt: "" },
  coach: { name: "💪 Строгий тренер", prompt: "Говори как требовательный, но справедливый тренер: прямо, коротко, без сюсюканья, с призывом к действию прямо сейчас." },
  fun: { name: "😄 С юмором", prompt: "Отвечай с лёгким добрым юмором и одной уместной шуткой, но совет должен остаться полезным и точным." },
};
async function stylePrompt(env, userId) {
  if (!env.DB) return "";
  const u = await env.DB.prepare("SELECT ai_style, premium_until FROM users WHERE id = ?").bind(userId).first();
  if (!u || (u.premium_until || 0) <= Date.now()) return "";
  return STYLES[u.ai_style]?.prompt ? " " + STYLES[u.ai_style].prompt : "";
}

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
    // Приложение «Команды» на iPhone присылает данные из «Здоровья» по личной ссылке /health?t=<код> (код выдаёт бот: /health).
    if (path === "/health") return reply(...(await healthImport(env, request)));
    if (request.method !== "POST") return reply(404, { error: "Not found" });

    if (path === "/telegram") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env.BOT_TOKEN))) return new Response("forbidden", { status: 403 });
      const update = await request.json();
      // answer Telegram at once; a slow model reply would make it resend the update
      if (update.my_chat_member) ctx.waitUntil(handleMember(update.my_chat_member, env));
      else if (update.callback_query) ctx.waitUntil(handleCallback(update.callback_query, env));
      else if (update.pre_checkout_query) ctx.waitUntil(handlePreCheckout(update.pre_checkout_query, env));
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

    // Облачная копия данных приложения: по разделам, новее побеждает. Так данные идут за аккаунтом Telegram на любое устройство.
    if (path === "/backup") {
      if (!env.DB) return reply(503, { error: "Нет базы" });
      const docs = body.docs && typeof body.docs === "object" ? body.docs : {};
      const stmts = [];
      for (const [k, d] of Object.entries(docs)) {
        if (!BACKUP_KEYS.includes(k) || !d || !(Number(d.at) > 0)) continue;
        const v = JSON.stringify(d.v ?? null);
        if (v.length > BACKUP_MAX) continue;
        stmts.push(env.DB.prepare("INSERT INTO backups (user_id, key, at, v) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET at = excluded.at, v = excluded.v WHERE excluded.at > backups.at").bind(user.id, k, Math.round(Number(d.at)), v));
      }
      if (stmts.length) await env.DB.batch(stmts);
      return reply(200, { ok: true, saved: stmts.length });
    }
    if (path === "/restore") {
      if (!env.DB) return reply(200, { docs: {} });
      const rows = (await env.DB.prepare("SELECT key, at, v FROM backups WHERE user_id = ?").bind(user.id).all()).results || [];
      const docs = {};
      for (const r of rows) { try { docs[r.key] = { at: r.at, v: JSON.parse(r.v) }; } catch {} }
      return reply(200, { docs });
    }

    // Фото еды из приложения (кнопка камеры во вкладке «Питание»): ИИ оценивает КБЖУ, приложение само записывает.
    if (path === "/food-photo") {
      const img = String(body.image || "");
      if (!img || img.length > 8_000_000) return reply(400, { error: "Фото слишком большое или пустое" });
      if (!isAdmin(env, user.id) && !(await takeAiQuota(user.id, env)).ok) return reply(429, { error: `На сегодня бесплатные разборы ИИ закончились (${FREE_AI(env)} в день). Безлимит — с подпиской Plus` });
      await track(env, user, "food_photo");
      const r = await analyzeFood(env, askGemini, img, String(body.mime || "image/jpeg"), String(body.caption || "").slice(0, 200));
      if (r === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
      return reply(200, r);
    }

    // Статус подписки для приложения и ссылка на оплату прямо из приложения.
    if (path === "/me") {
      const plus = await isPlus(env, user.id);
      return reply(200, { plus, freeAi: FREE_AI(env), stars: PLUS_STARS(env) });
    }
    if (path === "/plus-link") {
      const url = await invoiceLink(env, user.id);
      return url ? reply(200, { url }) : reply(502, { error: "Оплата временно недоступна" });
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
      if (!(await takeAiQuota(user.id, env)).ok) return reply(429, { error: `На сегодня бесплатные вопросы закончились (${FREE_AI(env)} в день). Безлимит — с подпиской Kwantoww Plus: напишите боту /plus` });
      await track(env, user, "ask");
      const ctxText = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT) : "";
      const hist = (Array.isArray(body.history) ? body.history : []).slice(-3)
        .flatMap((h) => [{ role: "user", parts: [{ text: String(h.q || "").slice(0, 600) }] }, { role: "model", parts: [{ text: String(h.a || "").slice(0, 1200) }] }]);
      const system = `Ты помощник в личном приложении Kwantoww. ${ASK_STYLE}${await stylePrompt(env, user.id)}${ctxText ? `\n\nДанные пользователя за сегодня:\n${ctxText}` : ""}`;
      const text = await askGemini(env, system, [...hist, { role: "user", parts: [{ text: q }] }], { maxTokens: 400 });
      if (text === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
      return reply(200, { text: text || "Не знаю, что ответить. Попробуйте спросить иначе" });
    }

    const { section, context } = body;
    if (typeof context !== "string" || !context) return reply(400, { error: "Неверный запрос" });

    if (path === "/sync") {
      await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
      await track(env, user, "app_open");
      if (env.DB && Array.isArray(body.days)) await saveDays(env, user.id, body.days, body.goals);
      return reply(200, { ok: true });
    }
    if (path !== "/advice" || !PROMPTS[section]) return reply(404, { error: "Not found" });

    if (!(await takeAiQuota(user.id, env)).ok) return reply(429, { error: `На сегодня бесплатные советы ИИ закончились (${FREE_AI(env)} в день). Безлимит — с подпиской Kwantoww Plus в чате с ботом` });
    await track(env, user, `advice_${section}`);
    // only the overview carries every section; a section's advice must not overwrite the full picture
    if (section === "overview") await env.LIMITS.put(`ctx:${user.id}`, context.slice(0, MAX_CONTEXT), { expirationTtl: CONTEXT_TTL });
    const text = await askGemini(env, `${PROMPTS[section]} ${RULES}${await stylePrompt(env, user.id)}`, [{ role: "user", parts: [{ text: `Данные пользователя:\n${context.slice(0, MAX_CONTEXT)}` }] }]);
    if (text === null) return reply(502, { error: "ИИ сейчас недоступен. Попробуйте через минуту" });
    return reply(200, { text: text || "Пока нечего посоветовать: запишите больше данных за день" });
  },
  // Раз в минуту: кому пора напомнить о событии.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([sendDueReminders(env), sendCheckins(env), sendWeekly(env), sendJournal(env, (m, p) => telegram(env, m, p)), sendWater(env, (m, p) => telegram(env, m, p)), sendMorning(env, (m, p) => telegram(env, m, p)), sendHabits(env, (m, p) => telegram(env, m, p)), sendNamaz(env, (m, p) => telegram(env, m, p)), ensureWebhookOnce(env), sendNewsOnce(env).catch(() => 0), env.DB ? finishChallenges(env, (id, t) => sendMessage(env, id, t)) : null]));
  },
};

// ---- учёт пользователей и событий (D1). Без базы бот работает, просто без статистики и записей из чата. ----
async function track(env, from, type) {
  if (!env.DB || !from?.id) return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, first_name, username, lang, first_seen, last_seen, blocked, checkin_on, morning_h) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 10)
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
    `DELETE FROM reminders WHERE user_id = ? AND sent < 2 ${keys.length ? `AND key NOT IN (${keys.map(() => "?").join(",")})` : ""}
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

// Два уведомления: за REMIND_MINUTES до начала (sent = 1) и в момент начала (sent = 2).
export async function sendDueReminders(env, now = Date.now()) {
  if (!env.DB) return 0;
  const lead = remindLead(env);
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.user_id, r.title, r.at, r.time, r.sent FROM reminders r JOIN users u ON u.id = r.user_id
     WHERE u.blocked = 0 AND ((r.sent = 0 AND r.at - ? <= ? AND r.at > ?) OR (r.sent < 2 AND r.at <= ? AND r.at > ?)) LIMIT 200`
  ).bind(lead, now, now, now, now - 10 * 60000).all()).results || [];
  for (const r of rows) {
    const started = r.at <= now;
    await env.DB.prepare("UPDATE reminders SET sent = ? WHERE id = ?").bind(started ? 2 : 1, r.id).run();
    const text = started
      ? `🔔 Сейчас: ${r.title}${r.time ? ` (${r.time})` : ""}\nПора идти!`
      : `⏰ Через ${Math.max(1, Math.round((r.at - now) / 60000))} мин: ${r.title}${r.time ? ` (в ${r.time})` : ""}\nНе опаздывайте!`;
    await sendMessage(env, r.user_id, text, true).catch(() => {});
  }
  // старые записи чистим, чтобы база не росла
  await env.DB.prepare("DELETE FROM reminders WHERE at < ?").bind(now - 7 * 86400000).run();
  return rows.length;
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

// ---- утренний вопрос-кнопки про сон: всем пользователям в 10:00 по их времени, можно выключить в /checkin ----
const CHECK_SLEEP = [5, 6, 7, 8, 9, 10];
const CHECK_STEPS = [2000, 4000, 6000, 8000, 10000, 12000];
const CHECK_WATER = [500, 1000, 1500, 2000, 2500, 3000];
const kb = (rows) => ({ inline_keyboard: rows });
const chunk = (arr, n) => arr.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);

async function sendCheckinSettings(env, chatId, userId) {
  if (!env.DB) return sendMessage(env, chatId, "Вопросы пока недоступны.");
  const u = await env.DB.prepare("SELECT checkin_on, morning_h, evening_h, tz FROM users WHERE id = ?").bind(userId).first();
  const on = u?.checkin_on !== 0, m = u?.morning_h ?? 10;
  const text = `☀️ Утренний вопрос про сон: ${on ? "включён" : "выключен"}\n\nКаждый день в ${m}:00 спрошу, как вы поспали. Ответ — одно нажатие на кнопку.${u?.tz ? "" : "\n\nВремя пока московское. Откройте приложение один раз, и я узнаю ваш часовой пояс."}`;
  return telegram(env, "sendMessage", { chat_id: chatId, text, reply_markup: kb([
    [{ text: on ? "🔕 Выключить" : "🔔 Включить", callback_data: on ? "ci:off" : "ci:on" }],
    [7, 8, 9].map((h) => ({ text: `${h === m ? "✅ " : ""}${h}:00`, callback_data: `ci:m:${h}` })),
    [10, 11, 12].map((h) => ({ text: `${h === m ? "✅ " : ""}${h}:00`, callback_data: `ci:m:${h}` })),
  ]) });
}

const sleepKb = () => kb([...chunk(CHECK_SLEEP.map((h) => ({ text: `${h} ч`, callback_data: `ci:sleep:${h}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);
const stepsKb = () => kb([...chunk(CHECK_STEPS.map((n) => ({ text: n >= 12000 ? "12 000+" : `~${n / 1000} 000`, callback_data: `ci:steps:${n}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);
const waterKb = () => kb([...chunk(CHECK_WATER.map((ml) => ({ text: `${ml / 1000} л`.replace(".", ","), callback_data: `ci:water:${ml}` })), 3), [{ text: "Пропустить", callback_data: "ci:skip" }]]);

// Отчёт недели всем: воскресенье, 19:00 по времени человека. У Plus — ещё и закономерности за 30 дней.
export async function sendWeekly(env, now = Date.now()) {
  if (!env.DB) return 0;
  const users = (await env.DB.prepare("SELECT id, tz, last_w, premium_until FROM users WHERE blocked = 0 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const u of users) {
    const l = localNow(u.tz || "Europe/Moscow", now);
    const day = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
    if (l.wd !== 0 || l.hh !== 19 || u.last_w === day) continue;
    await env.DB.prepare("UPDATE users SET last_w = ? WHERE id = ?").bind(day, u.id).run();
    const plus = (u.premium_until || 0) > now;
    const week = await insights(env, u.id, now, { days: 7, patterns: false });
    if (!week) continue; // за неделю нет данных — не беспокоим
    const more = plus ? await insights(env, u.id, now, { days: 30, patterns: true }) : "";
    const pat = plus && more.includes("🔍") ? "\n\n" + more.slice(more.indexOf("🔍")) : "";
    await telegram(env, "sendMessage", { chat_id: u.id, text: `📬 Ваш отчёт недели${plus ? " ⭐" : ""}\n\n${week.replace(/^📈 Ваша неделя\n\n/, "")}${pat}\n\nХорошей новой недели! 💪`,
      reply_markup: plus ? MAIN_KB : { inline_keyboard: [[{ text: "⭐ Закономерности в Plus", callback_data: "pay:info", style: "success" }]] } }).catch(() => {});
    n++;
  }
  return n;
}

export async function sendCheckins(env, now = Date.now()) {
  if (!env.DB) return 0;
  const users = (await env.DB.prepare("SELECT id, tz, morning_h, last_m FROM users WHERE checkin_on = 1 AND blocked = 0 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const u of users) {
    const tz = u.tz || "Europe/Moscow";
    const l = localNow(tz, now);
    const day = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
    if (l.hh === (u.morning_h ?? 10) && u.last_m !== day) {
      await env.DB.prepare("UPDATE users SET last_m = ? WHERE id = ?").bind(day, u.id).run();
      await telegram(env, "sendMessage", { chat_id: u.id, text: "☀️ Доброе утро! Как вы поспали? Сколько часов спали?", reply_markup: sleepKb() }).catch(() => {});
      n++;
    }
  }
  return n;
}

async function handleCallback(q, env) {
  const data = String(q.data || ""), userId = q.from.id, chatId = q.message?.chat?.id ?? userId, msgId = q.message?.message_id;
  const answer = (text) => telegram(env, "answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  const edit = (text, markup) => telegram(env, "editMessageText", { chat_id: chatId, message_id: msgId, text, ...(markup ? { reply_markup: markup } : {}) });
  if (data === "pay:info") { await answer(); return sendPlusInfo(env, chatId, userId); }
  if (data.startsWith("nz:") && env.DB) return namazCallback(env, (m, p) => telegram(env, m, p), q);
  if (data.startsWith("hb:") && env.DB) return habitCallback(env, (m, p) => telegram(env, m, p), q);
  if (data.startsWith("ob:") && env.DB) return onboardCallback(env, (m, p) => telegram(env, m, p), q, env.APP_URL);
  if (data.startsWith("pl:") && env.DB) {
    const [, k, v] = data.split(":");
    if (k === "on" || k === "off") await setPrefs(env, userId, { plan_on: k === "on" ? 1 : 0 });
    if (k === "h" && Number(v) >= 5 && Number(v) <= 11) await setPrefs(env, userId, { plan_on: 1, plan_h: Number(v) });
    await answer("Готово");
    return edit(await planSettingsText(env, userId), await planKb(env, userId));
  }
  if (data.startsWith("wt:")) { if (!env.DB) return answer(); return waterCallback(env, (m, p) => telegram(env, m, p), q); }
  if (data.startsWith("jr:")) {
    if (!isOwner(env, userId) || !env.DB) return answer();
    return answer(await journalCallback(env, (m, p) => telegram(env, m, p), userId, data.slice(3)));
  }
  if (data.startsWith("st:")) {
    const k = data.slice(3);
    if (k === "menu" || !STYLES[k]) { await answer(); return sendStyle(env, chatId, userId); }
    if (k !== "friend" && !(await isPlus(env, userId))) { await answer("Это бонус подписки Plus"); return sendPlusInfo(env, chatId, userId); }
    await env.DB.prepare("UPDATE users SET ai_style = ? WHERE id = ?").bind(k, userId).run();
    await answer("Готово");
    return edit(`🎭 Теперь ИИ отвечает в стиле: ${STYLES[k].name}`);
  }
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
    const extra = await praise(env, userId, [`sleep_${v}`]).catch(() => "");
    return edit(`✅ Сон: ${v} ч.${extra ? "\n" + extra : ""}\nХорошего дня!`);
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

const PLAN_HEAD = /^(план|планы|задач[аи]|сделать|todo|напомни)\s*[:\-—]\s*/i;

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
  const plusNow = await one("SELECT COUNT(*) c FROM users WHERE premium_until > ?", now);
  const stars30 = await one("SELECT COALESCE(SUM(stars), 0) c FROM payments WHERE ts >= ?", now - 30 * D);
  const remSent = await one("SELECT COUNT(*) c FROM reminders WHERE sent = 1 AND at >= ?", now - D);
  const remWait = await one("SELECT COUNT(*) c FROM reminders WHERE sent = 0 AND at >= ?", now);
  const kinds = (await env.DB.prepare("SELECT substr(cmd, 1, instr(cmd, '_') - 1) k, COUNT(*) c FROM inbox WHERE ts >= ? GROUP BY k ORDER BY c DESC").bind(now - 7 * D).all()).results || [];
  const names = { steps: "шаги", water: "вода", sleep: "сон", weight: "вес", exp: "расходы", inc: "доходы", mood: "настроение", energy: "энергия", meal: "еда", task: "задачи", event: "события" };
  // удержание: из пришедших 7–14 дней назад — сколько были активны за последние 7 дней
  const cohort = await one("SELECT COUNT(*) c FROM users WHERE first_seen BETWEEN ? AND ?", now - 14 * D, now - 7 * D);
  const kept = await one("SELECT COUNT(DISTINCT e.user_id) c FROM events e JOIN users u ON u.id = e.user_id WHERE u.first_seen BETWEEN ? AND ? AND e.ts >= ?", now - 14 * D, now - 7 * D, now - 7 * D);
  const refs = await one("SELECT COUNT(*) c FROM referrals WHERE ts >= ?", now - 30 * D);
  const buyers30 = await one("SELECT COUNT(DISTINCT user_id) c FROM payments WHERE ts >= ?", now - 30 * D);
  const waterOn = await one("SELECT COUNT(*) c FROM water WHERE on_ = 1");
  const planOn = await one("SELECT COUNT(*) c FROM prefs WHERE plan_on = 1");
  const habits = await one("SELECT COUNT(DISTINCT user_id) c FROM habit_rem");
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
    `⭐ Подписчиков Plus: ${plusNow}, оплачено за 30 дней: ${stars30} звёзд`,
    `Напоминаний отправлено за сутки: ${remSent}, впереди: ${remWait}`,
    `Вернулись через неделю: ${kept} из ${cohort} новичков прошлой недели${cohort ? ` (${Math.round((100 * kept) / cohort)}%)` : ""}`,
    `Купили Plus за 30 дней: ${buyers30} чел. · пришли по приглашениям: ${refs}`,
    `Включено: вода у ${waterOn}, утренний план у ${planOn}, привычки у ${habits}`,
    kinds.length ? `Что записывают (7 дней): ${kinds.map((k) => `${names[k.k] || k.k} ${k.c}`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// Бот должен получать события «заблокировал»: проверяем вебхук и, если нужно, включаем их, не меняя адрес и секрет.
async function ensureWebhookUpdates(env) {
  const info = await (await telegram(env, "getWebhookInfo", {})).json();
  const url = info.result?.url;
  const allowed = info.result?.allowed_updates || [];
  // пустой список = все типы, my_chat_member уже входит
  const need = ["message", "my_chat_member", "callback_query", "pre_checkout_query"];
  if (url && allowed.length && need.some((x) => !allowed.includes(x))) {
    await telegram(env, "setWebhook", { url, secret_token: await webhookSecret(env.BOT_TOKEN), allowed_updates: [...new Set([...allowed, ...need])] });
  }
}
// Один раз после выкладки: кнопки бота должны доходить до сервера.
// Разовая рассылка всем пользователям: что нового в боте (кнопки внизу появятся вместе с сообщением).
const NEWS_FLAG = "news-2026-11-27";
async function sendNewsOnce(env) {
  if (!env.DB || (await env.LIMITS.get(NEWS_FLAG))) return 0;
  await env.LIMITS.put(NEWS_FLAG, "1");
  const rows = (await env.DB.prepare("SELECT id FROM users WHERE COALESCE(blocked, 0) = 0 LIMIT 5000").all()).results || [];
  const text = ["🆕 Что нового в Kwantoww:", "", "♾ Вопросы ИИ — теперь без ограничений, бесплатно",
    "🍳 Рецепты с фото, рационы на 2000–3000 ккал и список покупок",
    "🕌 Время намаза с уведомлением и аятом или хадисом", "💧 Напоминания пить воду", "☀️ План дня по утрам и ⏰ напоминания привычек",
    "", "👇 Всё это теперь кнопками внизу чата. Полный список — «❓ Все команды»."].join("\n");
  let n = 0;
  for (const r of rows) {
    const res = await telegram(env, "sendMessage", { chat_id: r.id, text, reply_markup: MAIN_KB }).catch(() => null);
    if (res && res.status === 403) await env.DB.prepare("UPDATE users SET blocked = 1 WHERE id = ?").bind(r.id).run();
    else if (res?.ok) n++;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  return n;
}
async function ensureWebhookOnce(env) {
  const flag = "webhook-updates-v13";
  if (await env.LIMITS.get(flag)) return;
  await ensureWebhookUpdates(env);
  // меню бота (кнопка «Меню» у поля ввода)
  const cmds = [
    { command: "plus", description: "⭐ Подписка Plus: характер ИИ и бонусы" },
    { command: "insights", description: "📈 Мои итоги и закономерности" },
    { command: "challenge", description: "🏃 Челлендж шагов с друзьями" },
    { command: "top", description: "🏆 Таблица челленджа" },
    { command: "checkin", description: "☀️ Утренний вопрос про сон" },
    { command: "water", description: "💧 Напоминания пить воду" },
    { command: "plan", description: "☀️ План дня и утренняя рассылка" },
    { command: "habit", description: "⏰ Напоминания привычек" },
    { command: "recipes", description: "🍳 Рецепты, рационы и список покупок" },
    { command: "namaz", description: "🕌 Время намаза и уведомления" },
    { command: "invite", description: "🎁 Пригласить друга — неделя Plus" },
    { command: "health", description: "❤️ Связать со «Здоровьем» iPhone" },
    { command: "style", description: "🎭 Характер ИИ (Plus)" },
    { command: "help", description: "❓ Все команды и что умеет бот" },
    { command: "start", description: "👋 Начать заново" },
    { command: "paysupport", description: "Вопросы по оплате" },
  ];
  await telegram(env, "setMyCommands", { commands: cmds });
  // у владельца в меню есть ещё «Дневник»
  for (const id of String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    await telegram(env, "setMyCommands", { scope: { type: "chat", chat_id: Number(id) }, commands: [{ command: "diary", description: "📔 Дневник дня" }, { command: "guide", description: "📘 Гайд по блогу" }, ...cmds] }).catch(() => {});
    // один раз прислать владельцу гайд по блогу (и закрепить)
    if (!(await env.LIMITS.get("guide-sent"))) { await sendGuide(async (m, p) => (await telegram(env, m, p)).json().catch(() => null), Number(id)).catch(() => {}); await env.LIMITS.put("guide-sent", "1"); }
  }
  await env.LIMITS.put(flag, "1");
}

async function saveEntries(env, userId, entries, ts) {
  await env.DB.batch(entries.map((e) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, e.cmd, ts)));
  // вода из сообщений («выпил 300 мл») тоже идёт в счёт дневной цели напоминаний
  const ml = entries.filter((e) => /^water_\d+$/.test(e.cmd)).reduce((a, e) => a + Number(e.cmd.slice(6)), 0);
  if (ml > 0) await waterAdd(env, userId, ml, ts).catch(() => {});
}

async function handleMessage(message, env) {
  if (message?.successful_payment) return handlePayment(message, env);
  if (message?.from && (message.photo || /^image\//.test(message.document?.mime_type || ""))) return handleFoodPhoto(message, env);
  if (!message?.from || !(message.text || message.voice || message.audio)) return;
  const chatId = message.chat.id, userId = message.from.id;
  let text = (message.text || "").trim();
  if (!text) {
    // Голосовое: распознаём речь и дальше обрабатываем как обычный текст.
    const media = message.voice || message.audio;
    if ((media.duration || 0) > 120) return sendMessage(env, chatId, "Голосовое длиннее 2 минут, такие я не разбираю. Скажите короче, пожалуйста.");
    if (!(await takeQuota(userId, env))) return sendMessage(env, chatId, "Сегодня очень много сообщений. Продолжим завтра.");
    await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    text = (await transcribe(env, media)) || "";
    await track(env, message.from, "voice");
    if (!text) return sendMessage(env, chatId, "Не разобрал голосовое. Попробуйте ещё раз или напишите текстом.");
    await sendMessage(env, chatId, `🎤 «${text.slice(0, 300)}»`);
  }
  const histKey = `hist:${userId}`;
  await track(env, message.from, text.startsWith("/start") ? "start" : "message");

  // Дневник дня — только у владельца бота.
  if (isOwner(env, userId) && env.DB && env.LIMITS) {
    const tg = (m, p) => telegram(env, m, p);
    if (text.startsWith("/diary") || text === "📔 Дневник") {
      const u = await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(userId).first();
      return startJournal(env, tg, userId, u?.tz);
    }
    if (text.startsWith("/guide") || text === "📘 Гайд") return sendGuide(async (m, p) => (await telegram(env, m, p)).json().catch(() => null), chatId);
    if (!text.startsWith("/") && (await journalAnswer(env, tg, userId, text))) return;
  }

  if (text.startsWith("/start ref_") && env.DB) {
    const fresh = await env.DB.prepare("SELECT first_seen FROM users WHERE id = ?").bind(userId).first();
    const inviter = Number(text.slice(11).trim());
    if (fresh && Date.now() - fresh.first_seen < 60000 && (await applyReferral(env, userId, inviter))) {
      await telegram(env, "sendMessage", { chat_id: inviter, text: `🎁 По твоей ссылке пришёл ${message.from.first_name || "друг"}! Вам обоим +${REF_DAYS} дней Kwantoww Plus.` }).catch(() => {});
      await telegram(env, "sendMessage", { chat_id: chatId, text: `🎁 Тебя пригласил друг — тебе ${REF_DAYS} дней Kwantoww Plus в подарок!` });
    }
    text = "/start";
  }
  if (text.startsWith("/invite") || text === "🎁 Пригласить друга") {
    const link = `https://t.me/${await botUsername(env)}?start=ref_${userId}`;
    const n = env.DB ? (await env.DB.prepare("SELECT COUNT(*) c FROM referrals WHERE inviter = ?").bind(userId).first())?.c || 0 : 0;
    return telegram(env, "sendMessage", { chat_id: chatId, text: `🎁 Пригласи друга — вы оба получите ${REF_DAYS} дней Kwantoww Plus (характер ИИ на выбор и закономерности недели).\n\nТвоя ссылка:\n${link}\n\nУже пришло по ссылке: ${n}`,
      reply_markup: { inline_keyboard: [[{ text: "📨 Отправить другу", style: "primary", url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Попробуй Kwantoww — бот, который сам записывает задачи, воду, сон и еду по фото. По моей ссылке неделя Plus бесплатно!")}` }]] } });
  }
  if ((text.startsWith("/namaz") || text === "🕌 Намаз" || /^время намаза$/i.test(text)) && env.DB) return namazCommand(env, (m, p) => telegram(env, m, p), chatId, userId, text.split(/\s+/)[1]);
  if (text.startsWith("/recipes") || text === "🍳 Рецепты") {
    const u = new URL(env.APP_URL || "https://usmanovhursed29-bot.github.io/Claude/"); u.searchParams.set("view", "recipes");
    return telegram(env, "sendMessage", { chat_id: chatId, text: "🍳 Рецепты: завтраки, обеды, ужины и перекусы с фото и КБЖУ.\n\nВо вкладке «Рационы» — готовые меню на 2000 / 2500 / 3000 ккал. Отметь 1–2 дня, и во вкладке «Покупки» будет список продуктов.",
      reply_markup: { inline_keyboard: [[{ text: "🍳 Открыть рецепты", web_app: { url: u.toString() }, style: "primary" }]] } });
  }
  if ((text.startsWith("/plan") || text === "☀️ План дня") && env.DB) {
    const l = localNow((await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(userId).first())?.tz || "Europe/Moscow");
    const d = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
    await telegram(env, "sendMessage", { chat_id: chatId, text: await planText(env, userId, d) });
    return telegram(env, "sendMessage", { chat_id: chatId, text: await planSettingsText(env, userId), reply_markup: await planKb(env, userId) });
  }
  if ((text.startsWith("/habit") || text === "⏰ Привычки" || /^напоминай\s+.+\s+в\s+\d{1,2}[:.]\d{2}\s*$/i.test(text)) && env.DB) {
    const tg2 = (m, p) => telegram(env, m, p), h = parseHabit(text);
    return h ? habitAdd(env, tg2, chatId, userId, h) : habitList(env, tg2, chatId, userId);
  }
  if (text.startsWith("/start ch_") && env.DB) {
    const r = await joinChallenge(env, userId, text.slice(10).trim());
    if (r.error) return sendMessage(env, chatId, r.error, true);
    const b = await leaderboard(env, r.ch.code);
    const owner = b.rows.find((x) => x.id === r.ch.owner_id)?.name || "друг";
    return sendMessage(env, chatId, `🏃 Вы в челлендже шагов с ${owner}!\n\nЗаписывайте шаги в приложении или пишите мне «9000 шагов». Таблица: /top\n\n` + boardText(b, "Участники"), true);
  }
  if (text.startsWith("/start")) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: `Привет, ${message.from.first_name || ""}! 👋`, reply_markup: MAIN_KB });
    await sendMessage(env, chatId, helpText(), "plus");
    // новичку — знакомство в 3 нажатия (вода, подъём, утренний план)
    if (env.DB && !(await prefs(env, userId))?.onboarded) { await setPrefs(env, userId, { onboarded: 1 }); return onboardStart(env, (m, p) => telegram(env, m, p), chatId); }
    return;
  }

  if (text.startsWith("/admin")) {
    if (!isAdmin(env, userId)) return sendMessage(env, chatId, "Эта команда только для администратора.");
    await ensureWebhookUpdates(env).catch(() => {});
    return sendMessage(env, chatId, await adminText(env));
  }
  if (text.startsWith("/plus") || text.startsWith("/premium") || /купить подписку|подписка plus/i.test(text)) return sendPlusInfo(env, chatId, userId);
  if (text === "📈 Мои итоги") return sendMessage(env, chatId, env.DB ? await insights(env, userId) : "Пока недоступно.");
  if (text === "❓ Помощь" || text === "❓ Все команды" || text.startsWith("/help")) return sendMessage(env, chatId, helpText(), "plus");
  if (text === "🏃 Челлендж") {
    const my = env.DB ? await myChallenge(env, userId) : null;
    if (my) return sendMessage(env, chatId, boardText(await leaderboard(env, my.code), "🏃 Ваш челлендж шагов") + "\n\nНовый челлендж с другими друзьями: /challenge");
    return sendMessage(env, chatId, "🏃 Челлендж шагов: соревнуйтесь с друзьями неделю, кто пройдёт больше.\n\nСоздать и получить ссылку для друзей: /challenge");
  }
  if (text.startsWith("/style") || text === "🎭 Характер ИИ") return sendStyle(env, chatId, userId);
  if (text.startsWith("/paysupport")) return sendMessage(env, chatId, "Вопросы по оплате и возврату звёзд: напишите @Kwantoww. Ответим в течение дня.");
  if (text.startsWith("/insights") || /^(мои )?закономерност/i.test(text)) return sendMessage(env, chatId, env.DB ? await insights(env, userId) : "Пока недоступно.", true);
  if (text.startsWith("/challenge")) {
    if (!env.DB) return sendMessage(env, chatId, "Пока недоступно.");
    const c = await createChallenge(env, userId);
    const link = `https://t.me/${await botUsername(env)}?start=ch_${c.code}`;
    return telegram(env, "sendMessage", { chat_id: chatId, text: `🏃 Челлендж шагов на 7 дней создан!\n\nОтправьте друзьям эту ссылку. Кто пройдёт больше шагов до ${c.end.slice(8)}.${c.end.slice(5, 7)}, тот победил:\n${link}\n\nТаблица: /top`,
      reply_markup: { inline_keyboard: [[{ text: "📨 Отправить другу", style: "primary", url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Давай соревноваться, кто больше пройдёт шагов за неделю!")}` }]] } });
  }
  if (text.startsWith("/top")) {
    if (!env.DB) return sendMessage(env, chatId, "Пока недоступно.");
    const my = await myChallenge(env, userId);
    if (!my) return sendMessage(env, chatId, "Вы пока не участвуете в челлендже. Создайте свой: /challenge");
    return sendMessage(env, chatId, boardText(await leaderboard(env, my.code), "🏃 Челлендж шагов") + "\n\nШаги берутся из приложения и записей в чате.");
  }
  if (text.startsWith("/checkin") || text.startsWith("/вопросы")) return sendCheckinSettings(env, chatId, userId);
  if ((text.startsWith("/water") || text === "💧 Вода" || /^напоминай.*(вод|пить)/i.test(text)) && env.DB) return waterCommand(env, (m, p) => telegram(env, m, p), chatId, userId);
  if (text.startsWith("/health") || text === "❤️ Здоровье iPhone") return sendHealthLink(env, chatId, userId, text.includes("new"));
  if (text.startsWith("/myid")) return sendMessage(env, chatId, `Ваш Telegram ID: ${userId}`);
  if (text.startsWith("/reset")) {
    await env.LIMITS.delete(histKey);
    return sendMessage(env, chatId, "Начали заново. О чём поговорим?");
  }

  // 1) события со временем («завтра в 12:00 врач», в плане — построчно); 2) записи обычным кодом;
  // 3) если в сообщении есть числа, но код не понял — спрашиваем ИИ; 4) иначе разговор.
  const ts = (message.date || Math.floor(Date.now() / 1000)) * 1000;
  const tzRow = env.DB ? await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(userId).first() : null;
  const tz = tzRow?.tz || "Europe/Moscow";
  const isPlan = PLAN_HEAD.test(text);
  const events = [];
  let rest = text;
  if (isPlan) {
    const lines = text.replace(PLAN_HEAD, "").split(/\n|;/).map((l) => l.replace(/^(\d+[.)]\s+|[-•*]\s*)/, "").trim()).filter(Boolean);
    const other = [];
    for (const l of lines) { const ev = parseEvent(l, tz); if (ev) events.push(ev); else other.push(l); }
    rest = other.length ? "план: " + other.join("\n") : "";
  }
  let entries = rest ? parseEntries(rest) : [];
  if (!isPlan && !entries.length) { const ev = parseEvent(text, tz); if (ev) events.push(ev); }
  if (!entries.length && !events.length && /\d/.test(text) && text.length <= 500 && env.GEMINI_KEY) {
    const json = await askGemini(env, AI_EXTRACT_PROMPT, [{ role: "user", parts: [{ text }] }], { json: true, maxTokens: 400 });
    try { entries = entriesFromAI(JSON.parse(json || "[]")); } catch { entries = []; }
  }
  if (events.length || entries.length) {
    if (!env.DB) return sendMessage(env, chatId, "Записи из чата пока не подключены. Запишите в приложении.", true);
    const out = [];
    for (const ev of events) {
      const res = await env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, eventCmd(ev), ts).run();
      const inboxId = res.meta?.last_row_id ?? res.lastInsertRowid;
      await env.DB.prepare("INSERT INTO reminders (user_id, key, title, at, time, sent) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(user_id, key) DO NOTHING")
        .bind(userId, "c" + inboxId, ev.title, ev.at, ev.time).run();
      const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }).format(new Date(ev.date + "T12:00:00Z"));
      out.push(`📅 Записал в календарь: ${ev.title}\n${day}, ${ev.time}`);
    }
    if (events.length) out.push(`⏰ Напомню за ${Math.round(remindLead(env) / 60000)} минут и в момент начала.${tzRow?.tz ? "" : " Время московское: откройте приложение один раз, и я узнаю ваш часовой пояс."}`);
    if (entries.length) {
      await saveEntries(env, userId, entries, ts);
      const extra = await praise(env, userId, entries.map((e) => e.cmd)).catch(() => "");
      out.push(`Записал ✅\n${entries.map((e) => "• " + e.label).join("\n")}${extra ? "\n\n" + extra : ""}`);
    }
    out.push("В приложении появится при следующем открытии.");
    return sendMessage(env, chatId, out.join("\n\n"), true);
  }

  const q = await takeAiQuota(userId, env);
  if (!q.ok) return telegram(env, "sendMessage", { chat_id: chatId, text: q.plus || env.AI_LIMITS !== "on" ? "Сегодня вы задали очень много вопросов. Продолжим завтра." : limitText(env), reply_markup: q.plus || env.AI_LIMITS !== "on" ? undefined : plusButton });
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const history = JSON.parse((await env.LIMITS.get(histKey)) || "[]");
  const context = await env.LIMITS.get(`ctx:${userId}`);
  const system = `${CHAT_PROMPT} ${RULES}${await stylePrompt(env, userId)}${context ? `\n\nДанные пользователя из приложения:\n${context}` : "\n\nДанных из приложения пока нет."}`;
  const contents = [...history, { role: "user", parts: [{ text: text.slice(0, 2000) }] }];
  const answer = await askGemini(env, system, contents, { maxTokens: 400 });
  if (answer === null) return sendMessage(env, chatId, "ИИ сейчас недоступен. Попробуй через минуту");
  const reply = answer || "Не знаю, что ответить. Попробуй спросить иначе";
  contents.push({ role: "model", parts: [{ text: reply }] });
  await env.LIMITS.put(histKey, JSON.stringify(contents.slice(-HISTORY)), { expirationTtl: CONTEXT_TTL });
  if (q.left === 0) return telegram(env, "sendMessage", { chat_id: chatId, text: reply + `\n\n— Это был последний бесплатный вопрос ИИ на сегодня. Безлимит — с подпиской ⭐`, reply_markup: plusButton });
  return sendMessage(env, chatId, reply);
}

// ---- подписка Kwantoww Plus (Telegram Stars) ----
const FREE_AI = (env) => Number(env.FREE_AI_PER_DAY) || 3;
const PLUS_AI = (env) => Number(env.PLUS_AI_PER_DAY) || 100; // защита от злоупотреблений, для человека это «безлимит»
const PLUS_STARS = (env) => Number(env.PREMIUM_STARS) || 150;
async function isPlus(env, userId) {
  if (!env.DB) return false;
  const u = await env.DB.prepare("SELECT premium_until FROM users WHERE id = ?").bind(userId).first();
  return (u?.premium_until || 0) > Date.now();
}
// Вопросы ИИ (чат, «Спросить ИИ», советы): бесплатно 3 в день, с подпиской без ограничений.
// Защита от спама: человек этого не заметит, а бот не упрётся в лимит Gemini из-за одного спамера.
const SPAM_CAP = (env) => Number(env.SPAM_CAP_PER_DAY) || 200;
async function spamOk(env, userId, kind) {
  if (isAdmin(env, userId)) return true;
  const key = `spam:${kind}:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.LIMITS.get(key)) || 0;
  if (used >= SPAM_CAP(env)) return false;
  await env.LIMITS.put(key, String(used + 1), { expirationTtl: DAY_TTL });
  return true;
}
// Сейчас вопросы ИИ без ограничений для всех (кроме защиты от спама). Вернуть лимиты: переменная AI_LIMITS = "on".
async function takeAiQuota(userId, env) {
  const plus = await isPlus(env, userId);
  if (env.AI_LIMITS !== "on") return { ok: await spamOk(env, userId, "ai"), plus, left: null };
  const key = `ai:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.LIMITS.get(key)) || 0;
  if (used >= (plus ? PLUS_AI(env) : FREE_AI(env))) return { ok: false, plus };
  await env.LIMITS.put(key, String(used + 1), { expirationTtl: DAY_TTL });
  return { ok: true, plus, left: plus ? null : FREE_AI(env) - used - 1 };
}
const limitText = (env) => `На сегодня бесплатные вопросы ИИ закончились (${FREE_AI(env)} в день). Завтра будут снова.\n\n⭐ С подпиской Kwantoww Plus — без ограничений.`;
const plusButton = { inline_keyboard: [[{ text: "⭐ Купить подписку", callback_data: "pay:info", style: "success" }]] };

async function sendPlusInfo(env, chatId, userId) {
  const plus = await isPlus(env, userId);
  if (plus) {
    const u = await env.DB.prepare("SELECT premium_until FROM users WHERE id = ?").bind(userId).first();
    const till = new Date(u.premium_until).toISOString().slice(0, 10).split("-").reverse().join(".");
    return telegram(env, "sendMessage", { chat_id: chatId, text: `⭐ У вас подписка Kwantoww Plus до ${till}. Продлевается сама, отменить можно в Telegram: Настройки → Telegram Stars → Подписки.\n\nВыбрать характер ИИ: /style\nВопросы по оплате: /paysupport`,
      reply_markup: { inline_keyboard: [[{ text: "🎭 Выбрать характер ИИ", callback_data: "st:menu" }]] } });
  }
  const url = await invoiceLink(env, userId);
  if (!url) return sendMessage(env, chatId, "Оплата временно недоступна. Попробуйте позже.");
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: `⭐ Kwantoww Plus — ${PLUS_STARS(env)} звёзд в месяц (около 200 ₽)\n\nЧто входит:\n• 🎭 Характер ИИ на выбор: друг, строгий тренер или с юмором\n• 🔍 Закономерности в отчёте недели: как сон влияет на шаги, настроение и расходы\n• ⭐ Звезда рядом с именем в челленджах\n\nВсё остальное бесплатно для всех: вопросы ИИ без ограничений, записи из чата и голосом, напоминания, утренний вопрос про сон, /insights, челленджи.\n\nОплата звёздами Telegram, подписка продлевается сама через 30 дней. Отменить можно в любой момент: Настройки Telegram → Telegram Stars → Подписки.`,
    reply_markup: { inline_keyboard: [[{ text: `Оформить за ${PLUS_STARS(env)} ⭐`, url, style: "success" }]] },
  });
}

async function invoiceLink(env, userId) {
  const link = await (await telegram(env, "createInvoiceLink", {
    title: "Kwantoww Plus",
    description: "Характер ИИ на выбор, закономерности в отчёте недели. 30 дней, продлевается сама.",
    payload: `plus:${userId}`, currency: "XTR",
    prices: [{ label: "Kwantoww Plus, 30 дней", amount: PLUS_STARS(env) }],
    subscription_period: 2592000,
  })).json();
  return link.ok ? link.result : null;
}

async function sendStyle(env, chatId, userId) {
  const plus = await isPlus(env, userId);
  const u = env.DB ? await env.DB.prepare("SELECT ai_style FROM users WHERE id = ?").bind(userId).first() : null;
  const cur = plus && STYLES[u?.ai_style] ? u.ai_style : "friend";
  return telegram(env, "sendMessage", { chat_id: chatId,
    text: plus ? "🎭 Каким будет ваш ИИ-помощник?" : "🎭 Характер ИИ — бонус подписки Plus. Сейчас ИИ отвечает как друг. С Plus можно выбрать строгого тренера или ИИ с юмором.",
    reply_markup: { inline_keyboard: [
      ...Object.entries(STYLES).map(([k, v]) => [{ text: `${cur === k ? "✅ " : ""}${v.name}`, callback_data: `st:${k}` }]),
      ...(plus ? [] : [[{ text: "⭐ Купить подписку", callback_data: "pay:info", style: "success" }]]),
    ] } });
}

async function handlePreCheckout(q, env) {
  const ok = q.currency === "XTR" && q.total_amount === PLUS_STARS(env) && String(q.invoice_payload) === `plus:${q.from.id}`;
  return telegram(env, "answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "Счёт устарел. Нажмите «Купить подписку» ещё раз." });
}

async function handlePayment(message, env) {
  const p = message.successful_payment, userId = message.from.id;
  if (!env.DB || p.currency !== "XTR") return;
  const until = p.subscription_expiration_date ? p.subscription_expiration_date * 1000 : Date.now() + 30 * 86400000;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET premium_until = ? WHERE id = ?").bind(until, userId),
    env.DB.prepare("INSERT OR IGNORE INTO payments (charge_id, user_id, stars, ts, recurring) VALUES (?, ?, ?, ?, ?)").bind(p.telegram_payment_charge_id, userId, p.total_amount, Date.now(), p.is_recurring ? 1 : 0),
  ]);
  await track(env, message.from, p.is_recurring && !p.is_first_recurring ? "renewed" : "paid");
  return sendMessage(env, message.chat.id, `🎉 Спасибо! Подписка Kwantoww Plus активна до ${new Date(until).toISOString().slice(0, 10).split("-").reverse().join(".")}.\nВопросы ИИ теперь без ограничений.`, true);
}

async function takeQuota(userId, env) {
  if (env.AI_LIMITS !== "on") return spamOk(env, userId, "msg");
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

// Имя бота для ссылок-приглашений (кэшируется).
async function botUsername(env) {
  const cached = await env.LIMITS.get("bot-username");
  if (cached) return cached;
  const me = await (await telegram(env, "getMe", {})).json();
  const name = me.result?.username || "";
  if (name) await env.LIMITS.put("bot-username", name, { expirationTtl: 7 * 86400 });
  return name;
}

function telegram(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function helpText() {
  return [
    "🆓 Бот бесплатный. Вот что я умею:",
    "",
    "✍️ Записываю за вас в приложение — просто напишите или скажите голосом 🎤:",
    "«14 000 шагов», «выпил 300 мл воды», «спал 7 часов», «потратил 500 на кафе»",
    "",
    "📅 Ставлю дела в календарь и напоминаю за 15 минут: «завтра в 12:00 поликлиника»",
    "",
    "📸 Пришлите фото еды — посчитаю калории и БЖУ и запишу в «Питание»",
    "",
    "💧 Напоминаю пить воду равномерно весь день — /water",
    "",
    "☀️ Утром присылаю план дня — /plan · ⏰ напоминаю о привычках — /habit",
    "",
    "🎁 Пригласи друга — вам обоим неделя Plus: /invite",
    "",
    "☀️ Каждое утро спрашиваю, как вы поспали — ответ одной кнопкой",
    "",
    "🏃 Челленджи с друзьями: кто пройдёт больше шагов за неделю — нажмите «Челлендж» внизу",
    "",
    "🍳 Рецепты с фото, рационы на 2000–3000 ккал и список покупок — /recipes",
    "",
    "🕌 Время намаза и уведомления с аятом или хадисом — /namaz",
    "",
    "📬 Каждое воскресенье вечером присылаю отчёт недели",
    "",
    "📈 Показываю ваши итоги: нажмите «Мои итоги» внизу",
    "",
    "🤖 Отвечаю на вопросы про здоровье, деньги и привычки — без ограничений",
    "",
    "👇 Все функции — кнопками внизу чата. Если кнопок не видно, нажмите значок ⌘ (четыре квадрата) справа от поля ввода. Команды — в «Меню» слева.",
    "",
    "———",
    "⭐ Хотите больше? В подписке Plus — характер ИИ на выбор и закономерности в отчёте недели.",
  ].join("\n");
}

// Постоянные кнопки внизу чата: подписку и главное видно без команд.
const MAIN_KB = {
  keyboard: [
    [{ text: "🍳 Рецепты" }, { text: "💧 Вода" }, { text: "🕌 Намаз" }],
    [{ text: "☀️ План дня" }, { text: "⏰ Привычки" }, { text: "📈 Мои итоги" }],
    [{ text: "🏃 Челлендж" }, { text: "🎁 Пригласить друга" }],
    [{ text: "❓ Все команды" }, { text: "⭐ Подписка Plus", style: "success" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function sendMessage(env, chatId, text, withAppButton = false) {
  const payload = { chat_id: chatId, text, reply_markup: MAIN_KB };
  if (withAppButton) payload.reply_markup = { inline_keyboard: [[{ text: "📱 Открыть Kwantoww", web_app: { url: env.APP_URL }, style: "primary" }], ...(withAppButton === "plus" ? [[{ text: "⭐ Купить подписку", callback_data: "pay:info", style: "success" }]] : [])] };
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


// ---- «Здоровье» iPhone → бот: личная ссылка для приложения «Команды» ----
async function sendHealthLink(env, chatId, userId, renew) {
  if (!env.LIMITS || !env.DB) return sendMessage(env, chatId, "Пока недоступно.");
  let t = renew ? null : await env.LIMITS.get(`htu:${userId}`);
  if (!t) {
    const old = await env.LIMITS.get(`htu:${userId}`);
    if (old) await env.LIMITS.delete(`ht:${old}`);
    t = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.LIMITS.put(`ht:${t}`, String(userId));
    await env.LIMITS.put(`htu:${userId}`, t);
  }
  const url = `${env.WORKER_URL || "https://kwantoww-ai.usmanovhursed747.workers.dev"}/health?t=${t}`;
  return telegram(env, "sendMessage", { chat_id: chatId, text: [
    "❤️ Ваша личная ссылка для приложения «Команды» на iPhone:",
    "", url, "",
    "Команда отправляет на неё шаги, воду, сон и вес из «Здоровья», а я записываю их в Kwantoww.",
    "Никому не пересылайте ссылку: по ней можно записать данные в ваш аккаунт. Новая ссылка (старая перестанет работать): /health_new",
  ].join("\n"), link_preview_options: { is_disabled: true } });
}

// Принимает JSON {steps, water, sleep, weight, date?}: water — мл за день (итог), sleep — часы, weight — кг. Пустые поля пропускаются.
export async function healthImport(env, request) {
  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") { try { body = await request.json(); } catch {} }
  for (const k of ["steps", "water", "sleep", "weight", "date", "quiet"]) if (body[k] == null && url.searchParams.has(k)) body[k] = url.searchParams.get(k);
  const t = String(url.searchParams.get("t") || body.t || "");
  const uid = t && env.LIMITS ? await env.LIMITS.get(`ht:${t}`) : null;
  if (!uid || !env.DB) return [401, { error: "Ссылка не подходит. Получите новую в боте: /health" }];
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; };
  const steps = num(body.steps), water = num(body.water), sleep = num(body.sleep), weight = num(body.weight);
  const cmds = [], lines = [];
  if (steps !== null && steps >= 0 && steps < 200000) { cmds.push(`steps_${Math.round(steps)}`); lines.push(`👣 ${Math.round(steps).toLocaleString("ru-RU")} шагов`); }
  if (water !== null && water > 0 && water < 20000) { cmds.push(`watert_${Math.round(water)}`); lines.push(`💧 ${Math.round(water)} мл воды`); }
  if (sleep !== null && sleep > 0 && sleep <= 16) { const h = Math.round(sleep * 10) / 10; cmds.push(`sleep_${String(h).replace(".", "-")}`); lines.push(`😴 сон ${h} ч`); }
  if (weight !== null && weight >= 30 && weight <= 300) { const w = Math.round(weight * 10) / 10; cmds.push(`weight_${String(w).replace(".", "-")}`); lines.push(`⚖️ вес ${w} кг`); }
  if (!cmds.length) {
    const got = Object.entries(body).filter(([k]) => k !== "t").map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`).join(", ");
    return [400, { error: "Нет данных: пришлите steps, water, sleep или weight", "пришло": got || `ничего (метод ${request.method})` }];
  }
  const ts = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? Date.parse(body.date + "T12:00:00Z") : Date.now();
  const userId = Number(uid);
  await env.DB.batch(cmds.map((c) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, c, ts)));
  if (body.quiet !== true && body.quiet !== "1") await telegram(env, "sendMessage", { chat_id: userId, text: "❤️ Из «Здоровья» iPhone записал:\n" + lines.join("\n") }).catch(() => {});
  return [200, { ok: true, saved: lines }];
}

// ---- фото еды в чате: ИИ считает КБЖУ и записывает в «Питание» ----
async function handleFoodPhoto(message, env) {
  const chatId = message.chat.id, userId = message.from.id;
  await track(env, message.from, "food_photo");
  if (!env.DB) return sendMessage(env, chatId, "Пока недоступно.");
  if (!isAdmin(env, userId)) {
    const q = await takeAiQuota(userId, env);
    if (!q.ok) return telegram(env, "sendMessage", { chat_id: chatId, text: limitText(env), reply_markup: plusButton });
  }
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const media = message.photo ? message.photo[message.photo.length - 1] : message.document;
  let b64 = null;
  try {
    const f = await (await telegram(env, "getFile", { file_id: media.file_id })).json();
    const res = f.result?.file_path ? await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`) : null;
    if (res?.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length <= 8 * 1024 * 1024) {
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        b64 = btoa(bin);
      }
    }
  } catch (e) { console.log("food photo", String(e)); }
  if (!b64) return sendMessage(env, chatId, "Не получилось открыть фото. Пришлите его ещё раз, пожалуйста.");
  const r = await analyzeFood(env, askGemini, b64, message.document?.mime_type || "image/jpeg", (message.caption || "").slice(0, 200));
  if (r === null) return sendMessage(env, chatId, "ИИ сейчас недоступен. Пришлите фото через минуту.");
  if (!r.food) return sendMessage(env, chatId, "Не вижу еды на фото 🤔 Сфотографируйте тарелку сверху, при хорошем свете. Можно подписать, что это, например «плов, половина тарелки».");
  const ts = Date.now();
  await env.DB.batch(r.items.map((it) => env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, foodCmd(it), ts)));
  return sendMessage(env, chatId, foodText(r.items), true);
}

async function planSettingsText(env, id) {
  const p = await prefs(env, id);
  return p?.plan_on ? `☀️ Утренний план включён: каждый день в ${p.plan_h ?? 8}:00 присылаю события, задачи и главное дело.` : "☀️ Утренний план выключен. Включи, и каждое утро я пришлю события, задачи и главное дело.";
}
async function planKb(env, id) {
  const p = await prefs(env, id), h = p?.plan_h ?? 8, on = !!p?.plan_on;
  return { inline_keyboard: [[6, 7, 8, 9, 10].map((x) => ({ text: (on && h === x ? "✓ " : "") + `${x}:00`, callback_data: `pl:h:${x}` })), [on ? { text: "🔕 Выключить", callback_data: "pl:off" } : { text: "🔔 Включить", callback_data: "pl:on", style: "success" }]] };
}
