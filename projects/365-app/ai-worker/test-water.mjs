// node --experimental-sqlite test-water.mjs — напоминания пить воду
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { plan, waterCommand, waterCallback, sendWater, waterAdd } from "./water.js";
const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const st = (sql) => { let a = []; const s = db.prepare(sql); return { bind(...x) { a = x; return this; }, first: async () => s.get(...a) ?? null, all: async () => ({ results: s.all(...a) }), run: async () => s.run(...a) }; };
const env = { DB: { prepare: st } };
const sent = []; const tg = async (m, p) => { sent.push({ m, p }); return {}; };
db.prepare("INSERT INTO users (id, first_seen, last_seen, tz) VALUES (1, 0, 0, 'Asia/Dushanbe')").run();
// 2,5 л с 8 до 22 каждый час: 15 напоминаний по 170 мл
assert.deepEqual(plan({ goal: 2500, from: 8, to: 22, every: 60 }), { n: 15, portion: 170 });
assert.deepEqual(plan({ goal: 2500, from: 8, to: 22, every: 30 }), { n: 29, portion: 90 });
await waterCommand(env, tg, 1, 1);
assert.match(sent.at(-1).p.text, /2,5 л.*включены[\s\S]*15 напоминаний по ~170 мл/);
// Душанбе UTC+5: 08:00 местного = 03:00 UTC
const T = (h, m = 0) => Date.UTC(2026, 10, 28, h - 5, m);
assert.equal(await sendWater(env, tg, T(7, 30)), 0, "до 8:00 молчит");
assert.equal(await sendWater(env, tg, T(8, 0)), 1); assert.match(sent.at(-1).p.text, /~170 мл[\s\S]*0 мл из 2,5 л/);
assert.equal(await sendWater(env, tg, T(8, 30)), 0, "раньше часа не повторяет");
assert.equal(await sendWater(env, tg, T(9, 0)), 1);
// кнопка «+250 мл»: считается и уходит в приложение
await waterCallback(env, tg, { id: "q", data: "wt:add:250", from: { id: 1 }, message: { chat: { id: 1 }, message_id: 5 } });
assert.match(sent.at(-1).p.text, /\+250 мл\. Сегодня 250 мл из 2,5 л/);
assert.equal(db.prepare("SELECT cmd FROM inbox WHERE user_id = 1").get().cmd, "water_250");
// сообщение «выпил 2 л» — цель почти выполнена; после цели не напоминает
await waterAdd(env, 1, 2300, T(10, 0));
assert.equal(await sendWater(env, tg, T(11, 0)), 0, "цель выполнена — тишина");
// новый день — счёт с нуля
assert.equal(await sendWater(env, tg, Date.UTC(2026, 10, 29, 3, 0)), 1); assert.match(sent.at(-1).p.text, /0 мл из 2,5 л/);
// настройки: каждые 30 мин и выключение
await waterCallback(env, tg, { id: "q", data: "wt:every:30", from: { id: 1 }, message: { chat: { id: 1 }, message_id: 6 } });
assert.equal(db.prepare("SELECT every_min FROM water WHERE user_id = 1").get().every_min, 30);
await waterCallback(env, tg, { id: "q", data: "wt:off", from: { id: 1 }, message: { chat: { id: 1 }, message_id: 6 } });
assert.equal(await sendWater(env, tg, Date.UTC(2026, 10, 29, 6, 0)), 0, "выключено");
console.log("Вода: все проверки пройдены ✅");
