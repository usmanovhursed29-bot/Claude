// Локальный прогон: Telegram и D1 имитируются, сеть не нужна.
// Запуск: npm test
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { computeTimes, timesText } from "../src/prayer.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const D1 = {
  prepare(sql) {
    let args = [];
    const st = db.prepare(sql);
    return {
      bind(...a) { args = a; return this; },
      first() { return st.get(...args) ?? null; },
      run() { return st.run(...args); },
      all() { return { results: st.all(...args) }; },
    };
  },
};
const store = {};
const R2 = { put: async (k, v) => { store[k] = v; } };

const sent = [];
globalThis.fetch = async (url, opts) => {
  sent.push({ method: url.split("/").pop(), body: JSON.parse(opts.body) });
  return new Response(JSON.stringify({ ok: true }));
};
const env = { DB: D1, BACKUP: R2, BOT_TOKEN: "t", WEBHOOK_SECRET: "s", ADMIN_CHAT_IDS: "1" };

let uid = 0;
async function upd(update) {
  const before = sent.length;
  const r = await worker.fetch(new Request("https://x/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: ++uid, ...update }) }), env);
  assert.equal(r.status, 200);
  return sent.slice(before);
}
const say = (chat, text, extra = {}, lang = "ru") => upd({ message: { chat: { id: chat }, from: { first_name: "Тест", language_code: lang }, text, ...extra } });
const tap = (chat, data, message_id = 10) => upd({ callback_query: { id: "q" + uid, from: { first_name: "Тест" }, data, message: { chat: { id: chat }, message_id } } });
const last = (o) => o.filter((m) => m.body.text).at(-1).body.text;

assert.equal((await worker.fetch(new Request("https://x/telegram", { method: "POST", body: "{}" }), env)).status, 403);

let out = await say(42, "/start");
assert.match(last(out), /Ассаляму алейкум/);
out = await say(42, "🕌 Время намаза");
assert.match(last(out), /отправьте местоположение/);

// Душанбе
out = await say(42, "", { location: { latitude: 38.5598, longitude: 68.787 } });
assert.match(last(out), /Фаджр — <b>\d\d:\d\d<\/b>/);
assert.match(last(out), /Asia\/Dushanbe/);
assert.equal(db.prepare("SELECT tz FROM users WHERE chat_id = 42").get().tz, "Asia/Dushanbe");

out = await say(42, "🧭 Кибла");
assert.match(last(out), /Кибла: 244°/);

// зикр: 33 нажатия
await say(42, "📿 Зикр");
await tap(42, "z:open:subhan");
for (let i = 0; i < 33; i++) out = await tap(42, "z:inc:subhan");
assert.match(out.find((m) => m.method === "answerCallbackQuery").body.text, /Цель достигнута/);
assert.match(last(out), /Сейчас: <b>33<\/b> \/ 33 ✅/);
out = await tap(42, "z:reset:subhan");
assert.match(last(out), /Сейчас: <b>0<\/b>[\s\S]*Всего: 33/);

// настройки
out = await tap(42, "s:madhab:shafi");
assert.equal(db.prepare("SELECT madhab FROM users WHERE chat_id = 42").get().madhab, "shafi");
out = await tap(42, "s:method:turkey");
const kb = JSON.stringify(out.find((m) => m.method === "editMessageText").body.reply_markup);
assert.match(kb, /✅ Турция/);

// язык
out = await tap(42, "s:lang:en");
assert.match(last(out), /Settings/);
out = await say(42, "🕌 Prayer times");
assert.match(last(out), /Prayer times for/);
out = await say(42, "🕌 Время намаза"); // старая русская клавиатура тоже работает
assert.match(last(out), /Fajr/);
const eng = await say(7, "/start", {});
assert.match(last(eng), /Ассаляму/);

// статистика
out = await say(42, "/stats");
assert.match(last(out), /administrator only/);
await say(1, "/start");
out = await say(1, "/stats");
assert.match(last(out), /Всего пользователей: <b>3<\/b>/);
const en = await say(99, "/start", {}, "en-US");
assert.match(last(en), /Assalamu alaikum/);
assert.match(last(out), /zikr: 33/);

// резервная копия
await worker.scheduled({}, env);
const key = Object.keys(store)[0];
assert.ok(key.startsWith("backup/"));
assert.equal(JSON.parse(store[key]).users.length, 4);

// северные широты: Москва в июне, все времена должны быть
const t = computeTimes({ lat: 55.75, lon: 37.62 }, new Date("2026-06-21T12:00:00Z"));
for (const k of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]) assert.ok(!isNaN(t[k]), `Москва: ${k}`);

// Mini App: страница и подпись Telegram
const page = await worker.fetch(new Request("https://x/app"), env);
assert.equal(page.status, 200);
assert.match(await page.text(), /telegram-web-app\.js[\s\S]*adhan\.umd\.min\.js/);
assert.equal((await worker.fetch(new Request("https://x/api/event", { method: "POST", body: JSON.stringify({ initData: "user=%7B%22id%22%3A5%7D&hash=bad", type: "app_open" }) }), env)).status, 403);
// правильно подписанные данные
const { createHmac } = await import("node:crypto");
const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 555, first_name: "App", language_code: "en" }) };
const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
const secret = createHmac("sha256", "WebAppData").update("t").digest();
const hash = createHmac("sha256", secret).update(check).digest("hex");
const initData = new URLSearchParams({ ...fields, hash }).toString();
assert.equal((await worker.fetch(new Request("https://x/api/event", { method: "POST", body: JSON.stringify({ initData, type: "app_open" }) }), env)).status, 200);
assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE chat_id = 555 AND type = 'app_open'").get().c, 1);

console.log("Все проверки пройдены ✅\n");
console.log(timesText({ lat: 38.5598, lon: 68.787, tz: "Asia/Dushanbe", method: "mwl", madhab: "hanafi", lang: "ru" }, new Date("2026-11-24T03:00:00Z")).replace(/<[^>]+>/g, ""));
