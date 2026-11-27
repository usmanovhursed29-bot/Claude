// Напоминания пить воду: цель на день (по умолчанию 2,5 л) делится поровну между напоминаниями с утра до вечера.
// Каждое напоминание — с кнопками «+150 / +250 / +330 мл»; выпитое пишется в «Здоровье» приложения (команда water_<мл>)
// и считается за день. Когда цель выполнена, бот больше не напоминает до завтра. Настройки: /water.
import { localNow } from "./parse.js";

export const WATER_DEFAULT = { goal: 2500, from: 8, to: 22, every: 60 };
const dayOf = (l) => `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;

// Сколько напоминаний за день и сколько пить в каждом (округляем до 10 мл).
export function plan(s) {
  const n = Math.max(1, Math.floor(((s.to - s.from) * 60) / s.every) + 1);
  return { n, portion: Math.ceil(s.goal / n / 10) * 10 };
}
const bar = (d, g) => { const k = Math.min(10, Math.round((10 * d) / g)); return "🟦".repeat(k) + "⬜".repeat(10 - k); };
const L = (ml) => (ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 ? 1 : 0).replace(".", ",")} л` : `${ml} мл`);

async function get(env, id) { return env.DB.prepare("SELECT * FROM water WHERE user_id = ?").bind(id).first(); }
async function today(env, id) { const u = await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(id).first(); return localNow(u?.tz || "Europe/Moscow"); }

// Учесть выпитое (кнопкой или сообщением «выпил 300 мл»).
export async function waterAdd(env, id, ml, now = Date.now()) {
  const s = await get(env, id);
  if (!s) return null;
  const u = await env.DB.prepare("SELECT tz FROM users WHERE id = ?").bind(id).first();
  const d = dayOf(localNow(u?.tz || "Europe/Moscow", now));
  const drunk = (s.day === d ? s.drunk : 0) + ml;
  await env.DB.prepare("UPDATE water SET day = ?, drunk = ? WHERE user_id = ?").bind(d, drunk, id).run();
  return { drunk, goal: s.goal, done: drunk >= s.goal };
}

function settingsText(s) {
  const p = plan(s);
  return [
    `💧 Вода: цель ${L(s.goal)} в день — ${s.on ? "напоминания включены" : "напоминания выключены"}`,
    "",
    `С ${s.from}:00 до ${s.to}:00, каждые ${s.every} мин — это ${p.n} напоминаний по ~${p.portion} мл.`,
    `Сегодня выпито: ${L(s.drunk_today || 0)} из ${L(s.goal)}`,
  ].join("\n");
}
function settingsKb(s) {
  const b = (t, d, on) => ({ text: (on ? "✓ " : "") + t, callback_data: d });
  return { inline_keyboard: [
    [b("2 л", "wt:goal:2000", s.goal === 2000), b("2,5 л", "wt:goal:2500", s.goal === 2500), b("3 л", "wt:goal:3000", s.goal === 3000)],
    [b("30 мин", "wt:every:30", s.every === 30), b("45 мин", "wt:every:45", s.every === 45), b("60 мин", "wt:every:60", s.every === 60), b("90 мин", "wt:every:90", s.every === 90)],
    [b("с 7:00", "wt:from:7", s.from === 7), b("с 8:00", "wt:from:8", s.from === 8), b("с 9:00", "wt:from:9", s.from === 9)],
    [b("до 21:00", "wt:to:21", s.to === 21), b("до 22:00", "wt:to:22", s.to === 22), b("до 23:00", "wt:to:23", s.to === 23)],
    [s.on ? { text: "🔕 Выключить", callback_data: "wt:off" } : { text: "🔔 Включить", callback_data: "wt:on", style: "success" }],
  ] };
}
async function withToday(env, s, id) { const d = dayOf(await today(env, id)); return { ...s, drunk_today: s.day === d ? s.drunk : 0 }; }

// /water — включить (с настройками по умолчанию) и показать настройки.
export async function waterCommand(env, tg, chatId, id) {
  let s = await get(env, id);
  if (!s) {
    const d = WATER_DEFAULT;
    await env.DB.prepare("INSERT INTO water (user_id, on_, goal, from_h, to_h, every_min, last_at, day, drunk) VALUES (?, 1, ?, ?, ?, ?, 0, '', 0)").bind(id, d.goal, d.from, d.to, d.every).run();
    s = await get(env, id);
  }
  const v = await withToday(env, norm(s), id);
  return tg("sendMessage", { chat_id: chatId, text: settingsText(v), reply_markup: settingsKb(v) });
}
const norm = (r) => ({ on: !!r.on_, goal: r.goal, from: r.from_h, to: r.to_h, every: r.every_min, day: r.day, drunk: r.drunk });

export async function waterCallback(env, tg, q) {
  const id = q.from.id, [, kind, val] = String(q.data).split(":"), v = Number(val);
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  if (kind === "add") {
    if (!(v > 0 && v <= 1000)) return answer();
    const r = await waterAdd(env, id, v);
    if (!r) return answer();
    await env.DB.prepare("INSERT INTO inbox (user_id, cmd, ts, done) VALUES (?, ?, ?, 0)").bind(id, `water_${v}`, Date.now()).run();
    await answer(`+${v} мл`);
    const text = r.done ? `🎉 Цель на сегодня выполнена: ${L(r.drunk)} из ${L(r.goal)}! Больше не напоминаю до завтра.` : `✅ +${v} мл. Сегодня ${L(r.drunk)} из ${L(r.goal)}\n${bar(r.drunk, r.goal)}`;
    return tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
  }
  if (kind === "later") { await answer("Хорошо, напомню в следующий раз"); return tg("editMessageReplyMarkup", { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); }
  const set = { on: "on_ = 1", off: "on_ = 0" }[kind];
  const col = { goal: "goal", every: "every_min", from: "from_h", to: "to_h" }[kind];
  const ok = { goal: [2000, 2500, 3000], every: [30, 45, 60, 90], from: [7, 8, 9], to: [21, 22, 23] }[kind];
  if (set) await env.DB.prepare(`UPDATE water SET ${set} WHERE user_id = ?`).bind(id).run();
  else if (col && ok.includes(v)) await env.DB.prepare(`UPDATE water SET ${col} = ? WHERE user_id = ?`).bind(v, id).run();
  else return answer();
  const s = await withToday(env, norm(await get(env, id)), id);
  await answer(kind === "off" ? "Напоминания выключены" : "Готово");
  return tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: settingsText(s), reply_markup: settingsKb(s) });
}

// Cron раз в минуту: кому пора напомнить.
export async function sendWater(env, tg, now = Date.now()) {
  if (!env.DB) return 0;
  const rows = (await env.DB.prepare("SELECT w.*, u.tz, u.blocked FROM water w LEFT JOIN users u ON u.id = w.user_id WHERE w.on_ = 1 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const r of rows) {
    if (r.blocked) continue;
    const l = localNow(r.tz || "Europe/Moscow", now), d = dayOf(l), mins = l.hh * 60 + l.mm;
    const drunk = r.day === d ? r.drunk : 0;
    if (mins < r.from_h * 60 || mins > r.to_h * 60 || drunk >= r.goal) continue;
    if (now - (r.last_at || 0) < r.every_min * 60000 - 30000) continue;
    const p = plan({ goal: r.goal, from: r.from_h, to: r.to_h, every: r.every_min });
    const left = r.goal - drunk;
    await env.DB.prepare("UPDATE water SET last_at = ?, day = ?, drunk = ? WHERE user_id = ?").bind(now, d, drunk, r.user_id).run();
    await tg("sendMessage", { chat_id: r.user_id, text: `💧 Время попить воды — ~${Math.min(p.portion, left)} мл\nСегодня ${L(drunk)} из ${L(r.goal)}\n${bar(drunk, r.goal)}`,
      reply_markup: { inline_keyboard: [[{ text: "+150 мл", callback_data: "wt:add:150" }, { text: "+250 мл", callback_data: "wt:add:250", style: "primary" }, { text: "+330 мл", callback_data: "wt:add:330" }], [{ text: "Позже", callback_data: "wt:later" }]] } }).catch(() => {});
    n++;
  }
  return n;
}
