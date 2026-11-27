// node --experimental-sqlite test-daily.mjs — утренний план, привычки, знакомство, приглашения
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { planText, sendMorning, parseHabit, habitAdd, sendHabits, habitCallback, onboardStart, onboardCallback, applyReferral, habitCmd } from "./daily.js";
const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const st = (sql) => { let a = []; const s = db.prepare(sql); return { bind(...x) { a = x; return this; }, first: async () => s.get(...a) ?? null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: r.changes } }; } }; };
const env = { DB: { prepare: st } };
const sent = []; const tg = async (m, p) => { sent.push({ m, p }); return {}; };
const T = (d, h, m = 0) => Date.UTC(2026, 10, d, h - 3, m); // Москва UTC+3
db.prepare("INSERT INTO users (id, first_seen, last_seen, tz) VALUES (1, 0, 0, 'Europe/Moscow'), (2, 0, 0, 'Europe/Moscow')").run();
const put = (k, v) => db.prepare("INSERT INTO backups (user_id, key, at, v) VALUES (1, ?, 1, ?)").run(k, JSON.stringify(v));
put("events", [{ title: "Встреча", date: "2026-11-28", time: "15:00" }, { title: "Зал", date: "2026-11-28", time: "09:00" }, { title: "Завтра", date: "2026-11-29", time: "10:00" }]);
put("tasks", [{ title: "Купить продукты", bucket: "today", done: false }, { title: "Готово", bucket: "today", done: true }, { title: "Отчёт", due: "2026-11-27", done: false }]);
put("journal", { days: { "2026-11-27": { first: "Смонтировать ролик" } } });
// план
const t = await planText(env, 1, "2026-11-28");
assert.match(t, /суббота, 28 ноября/); assert.match(t, /Главное сегодня[\s\S]*Смонтировать ролик/); assert.match(t, /09:00 — Зал\n• 15:00 — Встреча/);
assert.match(t, /Купить продукты[\s\S]*Отчёт/); assert.ok(!t.includes("Готово") && !t.includes("Завтра"));
db.prepare("INSERT INTO prefs (user_id, plan_on, plan_h) VALUES (1, 1, 8)").run();
assert.equal(await sendMorning(env, tg, T(28, 7, 30)), 0); assert.equal(await sendMorning(env, tg, T(28, 8, 1)), 1); assert.equal(await sendMorning(env, tg, T(28, 8, 30)), 0, "один раз в день");
// привычки
assert.deepEqual(parseHabit("/habit Читать 20 минут 21:00"), { name: "Читать 20 минут", hh: 21, mm: 0 });
assert.deepEqual(parseHabit("напоминай зарядка в 7:30"), { name: "зарядка", hh: 7, mm: 30 });
assert.equal(parseHabit("/habit"), null);
await habitAdd(env, tg, 1, 1, { name: "Зарядка", hh: 7, mm: 30 }); assert.match(sent.at(-1).p.text, /каждый день в 07:30/);
assert.equal(await sendHabits(env, tg, T(28, 7, 0)), 0); assert.equal(await sendHabits(env, tg, T(28, 7, 31)), 1); assert.equal(await sendHabits(env, tg, T(28, 7, 40)), 0);
const hid = db.prepare("SELECT id FROM habit_rem").get().id;
await habitCallback(env, tg, { id: "q", data: `hb:done:${hid}`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 3 } });
assert.equal(db.prepare("SELECT cmd FROM inbox WHERE user_id = 1").get().cmd, habitCmd("Зарядка")); assert.match(sent.at(-1).p.text, /сделано/);
await habitCallback(env, tg, { id: "q", data: `hb:done:${hid}`, from: { id: 2 }, message: { chat: { id: 2 }, message_id: 3 } });
assert.equal(db.prepare("SELECT COUNT(*) c FROM inbox").get().c, 1, "чужое напоминание не трогаем");
// знакомство
await onboardStart(env, tg, 2); assert.match(sent.at(-1).p.text, /1\/3/);
const cb = (data) => onboardCallback(env, tg, { id: "q", data, from: { id: 2 }, message: { chat: { id: 2 }, message_id: 9 } }, "https://app");
await cb("ob:water:2500"); assert.match(sent.at(-1).p.text, /2\/3/); assert.equal(db.prepare("SELECT goal FROM water WHERE user_id = 2").get().goal, 2500);
await cb("ob:wake:7"); assert.equal(db.prepare("SELECT from_h FROM water WHERE user_id = 2").get().from_h, 7);
await cb("ob:plan:1"); assert.match(sent.at(-1).p.text, /вода 2,5 л[\s\S]*план дня — каждое утро в 7:00/); assert.equal(db.prepare("SELECT plan_on FROM prefs WHERE user_id = 2").get().plan_on, 1);
// приглашение: обоим неделя Plus, один раз, себя пригласить нельзя
const now = Date.UTC(2026, 10, 28);
db.prepare("INSERT INTO users (id, first_seen, last_seen) VALUES (3, ?, ?)").run(now, now);
assert.equal(await applyReferral(env, 3, 1, now), 1);
assert.equal(db.prepare("SELECT premium_until p FROM users WHERE id = 3").get().p, now + 7 * 86400000);
assert.equal(db.prepare("SELECT premium_until p FROM users WHERE id = 1").get().p, now + 7 * 86400000);
assert.equal(await applyReferral(env, 3, 2, now), null, "второй раз не засчитывается");
assert.equal(await applyReferral(env, 1, 1, now), null);
console.log("План, привычки, знакомство, приглашения: все проверки пройдены ✅");
