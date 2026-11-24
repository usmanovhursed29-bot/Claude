// Локальный прогон: имитирует Telegram и D1 (на встроенном SQLite Node), без сети.
// Запуск: node --experimental-sqlite test/run.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

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
    };
  },
};

const sent = [];
globalThis.fetch = async (url, opts) => {
  sent.push({ method: url.split("/").pop(), body: JSON.parse(opts.body) });
  return new Response(JSON.stringify({ ok: true }));
};

const env = { DB: D1, BOT_TOKEN: "test", WEBHOOK_SECRET: "s3cret", OWNER_CHAT_ID: "999" };
let uid = 0;
async function say(text, extra = {}) {
  const req = new Request("https://x/telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
    body: JSON.stringify({ update_id: ++uid, message: { chat: { id: 42 }, from: { first_name: "Алишер" }, text, ...extra } }),
  });
  const before = sent.length;
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  return sent.slice(before);
}
const last = (out) => out.at(-1).body.text;

// чужой запрос без секрета отклоняется
const bad = await worker.fetch(new Request("https://x/telegram", { method: "POST", body: "{}" }), env);
assert.equal(bad.status, 403);

let out = await say("/start");
assert.match(last(out), /Я — бот, а не человек/);

out = await say("📋 Меню");
assert.match(last(out), /Плов чайханский — 450 ₽/);
assert.match(last(out), /Цены примерные/);

out = await say("📍 Адреса");
assert.match(last(out), /Советская, 1Б/);
assert.match(last(out), /Союзная, 1Б/);

out = await say("🕒 Часы и телефон");
assert.match(last(out), /до 03:00/);

// бронь целиком
out = await say("🪑 Забронировать стол");
assert.match(last(out), /Какой адрес/);
out = await say("Союзная, 1Б");
assert.match(last(out), /день и время/);
out = await say("завтра 19:00");
out = await say("много");
assert.match(last(out), /цифрой/);
out = await say("4");
assert.match(last(out), /телефон/);
out = await say("", { contact: { phone_number: "+79990001122" } });
assert.match(last(out), /Заявка принята/);
const owner = out.find((m) => m.body.chat_id === "999");
assert.ok(owner, "владелец получил уведомление");
assert.match(owner.body.text, /Союзная, 1Б[\s\S]*Гостей: 4[\s\S]*\+79990001122/);
const row = db.prepare("SELECT * FROM bookings").get();
assert.equal(row.guests, 4);
assert.equal(row.branch, "soyuznaya");

// живой человек
out = await say("позови человека");
assert.ok(out.some((m) => m.body.chat_id === "999"));

// без ИИ на неизвестный вопрос бот не выдумывает
out = await say("есть ли у вас караоке?");
assert.match(last(out), /не знаю/);

console.log("Все проверки пройдены ✅");
console.log("\nПример ответа «Меню»:\n" + (await say("меню")).at(-1).body.text.replace(/<[^>]+>/g, ""));
