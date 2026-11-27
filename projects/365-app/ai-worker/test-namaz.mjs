// node --experimental-sqlite test-namaz.mjs — время намаза и уведомления
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { prayerTimes, hm } from "./prayer.js";
import { namazCommand, sendNamaz, timesText, namazCallback } from "./namaz.js";
// сверка с расписанием для Одинцово на 29.10.2026 (vremyanamaz.ru): 05:25 / 07:30 / 12:15 / 15:05 / 16:58 / 18:56
const t = prayerTimes(2026, 10, 29, 55.6789, 37.2639, 3);
assert.deepEqual(["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map((k) => hm(t[k])), ["05:25", "07:30", "12:15", "15:05", "16:58", "18:56"]);
// летом на широте 55° Иша/Фаджр всё равно считаются (правило доли ночи), без NaN
const j = prayerTimes(2026, 6, 21, 55.6789, 37.2639, 3); for (const k in j) assert.ok(Number.isFinite(j[k]), k);
const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const st = (sql) => { let a = []; const s = db.prepare(sql); return { bind(...x) { a = x; return this; }, first: async () => s.get(...a) ?? null, all: async () => ({ results: s.all(...a) }), run: async () => s.run(...a) }; };
const env = { DB: { prepare: st } }; const sent = []; const tg = async (m, p) => { sent.push({ m, p }); return {}; };
await namazCommand(env, tg, 1, 1); assert.match(sent.at(-1).p.text, /Одинцово[\s\S]*Фаджр[\s\S]*Иша[\s\S]*Уведомления включены/);
const MSK = (h, m) => Date.UTC(2026, 9, 29, h - 3, m);
assert.equal(await sendNamaz(env, tg, MSK(12, 10)), 0, "до Зухра рано");
assert.equal(await sendNamaz(env, tg, MSK(12, 15)), 1); assert.match(sent.at(-1).p.text, /Зухр — 12:15 \(Одинцово\)\n\n«|Зухр — 12:15 \(Одинцово\)\n\nПророк/);
assert.equal(await sendNamaz(env, tg, MSK(12, 16)), 0, "второй раз не шлём");
assert.equal(await sendNamaz(env, tg, MSK(15, 6)), 1); assert.match(sent.at(-1).p.text, /Аср — 15:05/);
assert.equal(await sendNamaz(env, tg, MSK(14, 0)), 0);
await namazCallback(env, tg, { id: "q", data: "nz:off", from: { id: 1 }, message: { chat: { id: 1 }, message_id: 2 } });
assert.equal(await sendNamaz(env, tg, MSK(16, 58)), 0, "выключено");
console.log(timesText("odintsovo", MSK(9, 0)));
console.log("Намаз: все проверки пройдены ✅");
