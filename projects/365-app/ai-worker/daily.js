// Утренний план, напоминания привычек, знакомство новичка, «пригласи друга».
// Данные приложения берём из облачной копии (таблица backups: events, tasks, journal) — она есть у всех, кто открывал приложение.
import { localNow } from "./parse.js";

const dayOf = (l) => `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
const prevDay = (d) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const WEEK = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

async function backup(env, id, key) {
  const r = await env.DB.prepare("SELECT v FROM backups WHERE user_id = ? AND key = ?").bind(id, key).first();
  try { return r ? JSON.parse(r.v) : null; } catch { return null; }
}
export async function prefs(env, id) {
  return (await env.DB.prepare("SELECT * FROM prefs WHERE user_id = ?").bind(id).first()) || null;
}
export async function setPrefs(env, id, patch) {
  await env.DB.prepare("INSERT INTO prefs (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").bind(id).run();
  const ks = Object.keys(patch);
  if (ks.length) await env.DB.prepare(`UPDATE prefs SET ${ks.map((k) => `${k} = ?`).join(", ")} WHERE user_id = ?`).bind(...ks.map((k) => patch[k]), id).run();
}

// ---- 1. Утренний план ----
export async function planText(env, id, d) {
  const [events, tasks, journal, water] = await Promise.all([backup(env, id, "events"), backup(env, id, "tasks"), backup(env, id, "journal"), env.DB.prepare("SELECT goal, on_ FROM water WHERE user_id = ?").bind(id).first()]);
  const dt = new Date(d + "T12:00:00Z");
  const out = [`☀️ План на ${WEEK[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`];
  const first = journal?.days?.[prevDay(d)]?.first;
  if (first && String(first).trim()) out.push("", `🎯 Главное сегодня (ты записал вчера):\n${String(first).trim().slice(0, 300)}`);
  const ev = (Array.isArray(events) ? events : []).filter((e) => e.date === d).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  out.push("", ev.length ? "📅 Календарь:\n" + ev.slice(0, 8).map((e) => `• ${e.time || "весь день"} — ${e.title}`).join("\n") : "📅 В календаре на сегодня пусто.");
  const tk = (Array.isArray(tasks) ? tasks : []).filter((t) => !t.done && (t.bucket === "today" || (t.due && t.due <= d)));
  if (tk.length) out.push("", "✅ Задачи:\n" + tk.slice(0, 7).map((t) => `• ${t.title}`).join("\n") + (tk.length > 7 ? `\n…и ещё ${tk.length - 7}` : ""));
  if (water?.on_) out.push("", `💧 Вода: цель ${String(water.goal / 1000).replace(".", ",")} л, буду напоминать.`);
  out.push("", "Хорошего дня! Записать дело: просто напиши «в 15:00 встреча».");
  return out.join("\n");
}
export async function sendMorning(env, tg, now = Date.now()) {
  if (!env.DB) return 0;
  const rows = (await env.DB.prepare("SELECT p.user_id, p.plan_h, p.last_plan, u.tz, u.blocked FROM prefs p JOIN users u ON u.id = p.user_id WHERE p.plan_on = 1 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const r of rows) {
    if (r.blocked) continue;
    const l = localNow(r.tz || "Europe/Moscow", now), d = dayOf(l);
    if (l.hh !== r.plan_h || r.last_plan === d) continue;
    await env.DB.prepare("UPDATE prefs SET last_plan = ? WHERE user_id = ?").bind(d, r.user_id).run();
    await tg("sendMessage", { chat_id: r.user_id, text: await planText(env, r.user_id, d) }).catch(() => {});
    n++;
  }
  return n;
}

// ---- 2. Напоминания привычек: «/habit Читать 20 минут 21:00» ----
export function parseHabit(text) {
  const m = /^\/habit(?:@\w+)?\s+(.+?)\s+(\d{1,2})[:.](\d{2})\s*$/i.exec(String(text).trim()) || /^напоминай\s+(.+?)\s+в\s+(\d{1,2})[:.](\d{2})\s*$/i.exec(String(text).trim());
  if (!m) return null;
  const hh = Number(m[2]), mm = Number(m[3]), name = m[1].trim().replace(/^[«"]|[»"]$/g, "").slice(0, 60);
  return name && hh < 24 && mm < 60 ? { name, hh, mm } : null;
}
export function habitCmd(name) {
  const bytes = new TextEncoder().encode(name); let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "habit_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
export async function habitList(env, tg, chatId, id, note) {
  const rows = (await env.DB.prepare("SELECT id, name, hh, mm FROM habit_rem WHERE user_id = ? ORDER BY hh, mm").bind(id).all()).results || [];
  const text = (note ? note + "\n\n" : "") + (rows.length ? "⏰ Напоминания привычек:\n" + rows.map((r) => `• ${hhmm(r.hh, r.mm)} — ${r.name}`).join("\n") : "Напоминаний привычек пока нет.") +
    "\n\nДобавить: /habit Читать 20 минут 21:00\nили напиши: напоминай зарядка в 7:30";
  return tg("sendMessage", { chat_id: chatId, text, reply_markup: rows.length ? { inline_keyboard: rows.map((r) => [{ text: `🗑 Удалить «${r.name.slice(0, 24)}»`, callback_data: `hb:del:${r.id}` }]) } : undefined });
}
export async function habitAdd(env, tg, chatId, id, h) {
  const c = await env.DB.prepare("SELECT COUNT(*) c FROM habit_rem WHERE user_id = ?").bind(id).first();
  if ((c?.c || 0) >= 10) return tg("sendMessage", { chat_id: chatId, text: "Можно до 10 напоминаний. Удалите лишние: /habit" });
  await env.DB.prepare("INSERT INTO habit_rem (user_id, name, hh, mm, last_day) VALUES (?, ?, ?, ?, '')").bind(id, h.name, h.hh, h.mm).run();
  return habitList(env, tg, chatId, id, `✅ Буду напоминать «${h.name}» каждый день в ${hhmm(h.hh, h.mm)}. Кнопка «Сделал» отметит привычку в приложении.`);
}
export async function sendHabits(env, tg, now = Date.now()) {
  if (!env.DB) return 0;
  const rows = (await env.DB.prepare("SELECT h.*, u.tz, u.blocked FROM habit_rem h JOIN users u ON u.id = h.user_id LIMIT 5000").all()).results || [];
  let n = 0;
  for (const r of rows) {
    if (r.blocked) continue;
    const l = localNow(r.tz || "Europe/Moscow", now), d = dayOf(l);
    if (r.last_day === d || l.hh * 60 + l.mm < r.hh * 60 + r.mm || l.hh * 60 + l.mm > r.hh * 60 + r.mm + 30) continue;
    await env.DB.prepare("UPDATE habit_rem SET last_day = ? WHERE id = ?").bind(d, r.id).run();
    await tg("sendMessage", { chat_id: r.user_id, text: `⏰ Пора: ${r.name}`, reply_markup: { inline_keyboard: [[{ text: "✅ Сделал", callback_data: `hb:done:${r.id}`, style: "success" }, { text: "Не сегодня", callback_data: `hb:skip:${r.id}` }]] } }).catch(() => {});
    n++;
  }
  return n;
}
export async function habitCallback(env, tg, q) {
  const [, kind, sid] = String(q.data).split(":"), id = q.from.id;
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  const r = await env.DB.prepare("SELECT * FROM habit_rem WHERE id = ? AND user_id = ?").bind(Number(sid), id).first();
  if (!r) return answer("Напоминание уже удалено");
  const edit = (text) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
  if (kind === "del") { await env.DB.prepare("DELETE FROM habit_rem WHERE id = ?").bind(r.id).run(); await answer("Удалено"); return edit(`🗑 Напоминание «${r.name}» удалено. Список: /habit`); }
  if (kind === "skip") { await answer("Хорошо"); return edit(`⏭ ${r.name} — пропущено сегодня.`); }
  await env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(id, habitCmd(r.name), Date.now()).run();
  await answer("Отмечено!");
  return edit(`✅ ${r.name} — сделано! Отметил в приложении (вкладка «Привычки»).`);
}

// ---- 3. Знакомство новичка: 3 вопроса кнопками ----
export const ONBOARD = {
  water: { text: "Давай настроим бота под тебя за 3 нажатия 👇\n\n1/3. Сколько воды хочешь пить в день? Я буду напоминать равномерно весь день.", kb: [[{ text: "2 л", callback_data: "ob:water:2000" }, { text: "2,5 л", callback_data: "ob:water:2500" }, { text: "3 л", callback_data: "ob:water:3000" }], [{ text: "Не напоминать про воду", callback_data: "ob:water:0" }]] },
  wake: { text: "2/3. Во сколько обычно просыпаешься?", kb: [[{ text: "6:00", callback_data: "ob:wake:6" }, { text: "7:00", callback_data: "ob:wake:7" }, { text: "8:00", callback_data: "ob:wake:8" }, { text: "9:00", callback_data: "ob:wake:9" }]] },
  plan: { text: "3/3. Присылать утром план дня: события календаря, задачи и главное дело?", kb: [[{ text: "Да, присылай", callback_data: "ob:plan:1", style: "success" }, { text: "Нет", callback_data: "ob:plan:0" }]] },
};
export async function onboardStart(env, tg, chatId) { return tg("sendMessage", { chat_id: chatId, text: ONBOARD.water.text, reply_markup: { inline_keyboard: ONBOARD.water.kb } }); }
export async function onboardCallback(env, tg, q, appUrl) {
  const [, step, val] = String(q.data).split(":"), id = q.from.id, v = Number(val);
  const answer = () => tg("answerCallbackQuery", { callback_query_id: q.id });
  const edit = (text, kb) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
  await answer();
  if (step === "water") {
    if (v > 0) await env.DB.prepare("INSERT INTO water (user_id, on_, goal) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET on_ = 1, goal = excluded.goal").bind(id, v).run();
    else await env.DB.prepare("UPDATE water SET on_ = 0 WHERE user_id = ?").bind(id).run();
    return edit(ONBOARD.wake.text, ONBOARD.wake.kb);
  }
  if (step === "wake" && v >= 5 && v <= 11) {
    await env.DB.prepare("UPDATE water SET from_h = ? WHERE user_id = ?").bind(v, id).run();
    await env.DB.prepare("UPDATE users SET morning_h = ? WHERE id = ?").bind(Math.min(23, v + 1), id).run();
    await setPrefs(env, id, { plan_h: v });
    return edit(ONBOARD.plan.text, ONBOARD.plan.kb);
  }
  if (step === "plan") {
    await setPrefs(env, id, { plan_on: v ? 1 : 0, onboarded: 1 });
    const p = await prefs(env, id), w = await env.DB.prepare("SELECT on_, goal FROM water WHERE user_id = ?").bind(id).first();
    return edit(["✅ Готово, бот настроен:", w?.on_ ? `• 💧 вода ${String(w.goal / 1000).replace(".", ",")} л — напомню равномерно весь день` : "• 💧 напоминания о воде выключены", v ? `• ☀️ план дня — каждое утро в ${p?.plan_h ?? 8}:00` : "• ☀️ утренний план выключен",
      "", "Поменять потом: /water, /plan, /habit. Открой приложение кнопкой ниже, чтобы я знал твой часовой пояс."].join("\n"),
      [[{ text: "📱 Открыть Kwantoww", web_app: { url: appUrl } }]]);
  }
}

// ---- 4. «Пригласи друга — оба получите неделю Plus» ----
export const REF_DAYS = 7;
export async function applyReferral(env, newId, inviter, now = Date.now()) {
  if (!inviter || inviter === newId) return null;
  const inv = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(inviter).first();
  if (!inv) return null;
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO referrals (user_id, inviter, ts) VALUES (?, ?, ?)").bind(newId, inviter, now).run();
  if (!(ins.meta?.changes ?? ins.changes)) return null; // D1: meta.changes
  const add = REF_DAYS * 86400000;
  for (const id of [newId, inviter]) await env.DB.prepare("UPDATE users SET premium_until = MAX(COALESCE(premium_until, 0), ?) + ? WHERE id = ?").bind(now, add, id).run();
  return inviter;
}
