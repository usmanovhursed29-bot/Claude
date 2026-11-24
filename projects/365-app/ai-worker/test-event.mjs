import assert from "node:assert/strict";
import { parseEvent, zonedToUtc } from "./parse.js";
// «сейчас» = 24.11.2026 10:00 по Москве (вторник)
const now = Date.UTC(2026, 10, 24, 7, 0);
const tz = "Europe/Moscow";
const ev = (t) => { const e = parseEvent(t, tz, now); return e && `${e.date} ${e.time} ${e.title}`; };
assert.equal(ev("завтра в 12:00 поликлиника"), "2026-11-25 12:00 Поликлиника");
assert.equal(ev("Завтра я должен пойти в 12:00 в поликлинику"), "2026-11-25 12:00 В поликлинику");
assert.equal(ev("напомни сегодня в 18:30 позвонить маме"), "2026-11-24 18:30 Позвонить маме");
assert.equal(ev("в пятницу в 9 стоматолог"), "2026-11-27 09:00 Стоматолог");
assert.equal(ev("30.11 в 15:00 встреча с клиентом"), "2026-11-30 15:00 Встреча с клиентом");
assert.equal(ev("5 декабря в 3 дня собеседование"), "2026-12-05 15:00 Собеседование");
assert.equal(ev("в 8 утра спортзал"), "2026-11-25 08:00 Спортзал"); // 8:00 уже прошло → завтра
assert.equal(ev("выпил 200 мл воды"), null);
assert.equal(ev("спал 7 часов"), null);
// часовые пояса: 12:00 в Душанбе = 07:00 UTC, в Москве = 09:00 UTC
assert.equal(new Date(zonedToUtc("2026-11-25", "12:00", "Asia/Dushanbe")).toISOString(), "2026-11-25T07:00:00.000Z");
assert.equal(new Date(zonedToUtc("2026-11-25", "12:00", "Europe/Moscow")).toISOString(), "2026-11-25T09:00:00.000Z");
assert.equal(new Date(zonedToUtc("2026-07-01", "12:00", "Europe/Berlin")).toISOString(), "2026-07-01T10:00:00.000Z");
console.log("События: все проверки пройдены ✅");
