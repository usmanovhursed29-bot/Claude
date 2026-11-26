// Дневник дня: только для владельца бота (ADMIN_IDS). Каждый вечер бот присылает дату и задаёт вопросы по одному,
// каждый ответ сразу уходит в очередь записей (inbox) командой journal_<base64url JSON {d, k, v}> — приложение кладёт его во вкладку «Дневник».
// Состояние разговора — в KV: jr:<id> = {d, step}. Голосовые ответы работают: их распознаёт обычный обработчик сообщений.
import { localNow } from "./parse.js";

export const JOURNAL_Q = [
  ["highlight", "✨ Хайлайт дня — что было главным сегодня? (одной фразой, встанет в скобки рядом с датой)"],
  ["vibe", "🎧 Вайб дня — напиши пунктами, каким был день"],
  ["desc", "📝 Опиши день"],
  ["insight", "💡 Инсайт дня — что ты сегодня понял?"],
  ["dream", "🚀 Что ты сегодня сделал на пути к мечте?"],
  ["drain", "🪫 Что сегодня отодвинуло тебя от мечты и высосало энергию? Как избежать этого завтра?"],
  ["first", "🎯 Какую главную вещь сделать завтра в первую очередь — ту, что сильнее приблизит к мечте или сделает остальное проще?"],
  ["tomorrow", "🗓 Опиши завтрашний день: что будешь делать утром, днём и вечером?"],
];
export const JOURNAL_HOUR = 21; // во сколько по местному времени бот начинает дневник
const STATE_TTL = 2 * 24 * 60 * 60;
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const isOwner = (env, id) => String(env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(String(id));
const dayOf = (l) => `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
export const dateRu = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export function journalCmd(d, k, v) {
  const bytes = new TextEncoder().encode(JSON.stringify({ d, k, v }));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "journal_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const kb = { inline_keyboard: [[{ text: "Пропустить вопрос", callback_data: "jr:skip" }, { text: "Закончить", callback_data: "jr:stop" }]] };
async function ask(env, tg, chatId, st) {
  const [, q] = JOURNAL_Q[st.step];
  return tg("sendMessage", { chat_id: chatId, text: `${st.step + 1}/${JOURNAL_Q.length}. ${q}`, reply_markup: kb });
}

export async function getState(env, userId) {
  if (!env.LIMITS) return null;
  const raw = await env.LIMITS.get(`jr:${userId}`);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
const putState = (env, userId, st) => env.LIMITS.put(`jr:${userId}`, JSON.stringify(st), { expirationTtl: STATE_TTL });

// Начать дневник за день d (по умолчанию — сегодня по времени владельца).
export async function startJournal(env, tg, userId, tz, d) {
  const day = d || dayOf(localNow(tz || "Europe/Moscow"));
  const st = { d: day, step: 0 };
  await putState(env, userId, st);
  await tg("sendMessage", { chat_id: userId, text: `📔 Дневник · ${dateRu(day)}\n\nОтвечай текстом или голосом. Каждый ответ сразу сохраняется во вкладку «Дневник» в приложении.` });
  return ask(env, tg, userId, st);
}

// Ответ на текущий вопрос. Возвращает true, если сообщение забрал дневник.
export async function journalAnswer(env, tg, userId, text) {
  const st = await getState(env, userId);
  if (!st) return false;
  const [k] = JOURNAL_Q[st.step];
  await env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(userId, journalCmd(st.d, k, String(text).slice(0, 4000)), Date.now()).run();
  return next(env, tg, userId, st);
}

async function next(env, tg, userId, st) {
  st.step++;
  if (st.step >= JOURNAL_Q.length) {
    await env.LIMITS.delete(`jr:${userId}`);
    await tg("sendMessage", { chat_id: userId, text: `✅ Дневник за ${dateRu(st.d)} сохранён. Открой приложение → «Дневник», там всё записано.`, reply_markup: { inline_keyboard: [[{ text: "📱 Открыть Kwantoww", web_app: { url: env.APP_URL } }]] } });
    return true;
  }
  await putState(env, userId, st);
  await ask(env, tg, userId, st);
  return true;
}

export async function journalCallback(env, tg, userId, action) {
  const st = await getState(env, userId);
  if (!st) return "Дневник сейчас не идёт. Начать: /diary";
  if (action === "stop") {
    await env.LIMITS.delete(`jr:${userId}`);
    await tg("sendMessage", { chat_id: userId, text: "Хорошо, закончили. Что успел ответить — уже сохранено. Продолжить заново: /diary" });
    return "Закончили";
  }
  await next(env, tg, userId, st);
  return "Пропустили";
}

// Cron раз в минуту: в JOURNAL_HOUR по местному времени владельца начинаем дневник, один раз в день.
export async function sendJournal(env, tg, now = Date.now()) {
  if (!env.DB || !env.LIMITS) return 0;
  const ids = String(env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const id of ids) {
    const u = await env.DB.prepare("SELECT tz, blocked FROM users WHERE id = ?").bind(Number(id)).first();
    if (!u || u.blocked) continue;
    const tz = u.tz || "Europe/Moscow";
    const l = localNow(tz, now);
    const day = dayOf(l);
    if (l.hh !== JOURNAL_HOUR || (await env.LIMITS.get(`jrsent:${id}`)) === day) continue;
    await env.LIMITS.put(`jrsent:${id}`, day, { expirationTtl: 3 * 24 * 60 * 60 });
    await startJournal(env, tg, Number(id), tz, day);
    n++;
  }
  return n;
}
