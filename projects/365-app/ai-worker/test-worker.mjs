// Проверка сервера без сети: node --experimental-sqlite test-worker.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import assert from "node:assert/strict";
import worker from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const stmt = (sql) => {
  let args = [];
  const st = db.prepare(sql);
  return { bind(...a) { args = a; return this; }, first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => st.run(...args) };
};
const DB = { prepare: stmt, batch: async (list) => { for (const s of list) await s.run(); } };
const kv = new Map();
const LIMITS = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) };

const TOKEN = "123:test";
const env = { DB, LIMITS, BOT_TOKEN: TOKEN, GEMINI_KEY: "g", GEMINI_MODEL: "m1", DAILY_LIMIT: "20", ALLOWED_ORIGIN: "*", APP_URL: "https://app", ADMIN_IDS: "1" };

const sent = [];
let geminiReply = "[]";
globalThis.fetch = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  if (String(url).includes("generativelanguage")) {
    sent.push({ method: "gemini", body });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: geminiReply }] } }] }));
  }
  const method = String(url).split("/").pop();
  sent.push({ method, body });
  if (method === "getWebhookInfo") return new Response(JSON.stringify({ ok: true, result: { url: "https://w/telegram", allowed_updates: ["message"] } }));
  return new Response(JSON.stringify({ ok: true }));
};

const secret = createHash("sha256").update(`webhook:${TOKEN}`).digest("hex").slice(0, 48);
async function tg(update) {
  const waits = [];
  const before = sent.length;
  const r = await worker.fetch(new Request("https://w/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update) }), env, { waitUntil: (p) => waits.push(p) });
  assert.equal(r.status, 200);
  await Promise.all(waits);
  return sent.slice(before);
}
let mid = 0;
const say = (from, text) => tg({ message: { message_id: ++mid, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private" }, from: { id: from, first_name: "U" + from }, text } });
const lastText = (o) => o.filter((m) => m.method === "sendMessage").at(-1)?.body.text || "";

function initData(userId) {
  const f = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: "U" + userId }) };
  const check = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  return new URLSearchParams({ ...f, hash: createHmac("sha256", key).update(check).digest("hex") }).toString();
}
const app = async (path, body) => {
  const r = await worker.fetch(new Request("https://w" + path, { method: "POST", body: JSON.stringify(body) }), env, { waitUntil: () => {} });
  return { status: r.status, json: await r.json() };
};

// чужой вебхук без секрета
assert.equal((await worker.fetch(new Request("https://w/telegram", { method: "POST", body: "{}" }), env, { waitUntil() {} })).status, 403);

let out = await say(42, "/start");
assert.match(lastText(out), /сам запишу в приложение/);

out = await say(42, "сегодня я сделал 14 000 шагов");
assert.match(lastText(out), /Записал ✅[\s\S]*Шаги: 14000/);
assert.ok(!out.some((m) => m.method === "gemini"), "простое сообщение разобрано без ИИ");

out = await say(42, "выпил 200 мл воды и 2 стакана воды вечером");
assert.match(lastText(out), /Вода: \+200 мл/);

// непонятная фраза с числом — помогает ИИ
geminiReply = JSON.stringify([{ type: "expense", value: 1200, category: "health" }]);
out = await say(42, "в аптеке оставил 1200");
assert.ok(out.some((m) => m.method === "gemini"));
assert.match(lastText(out), /Расход: 1200 ₽ · Здоровье/);

// вопрос без данных — обычный разговор
geminiReply = "Пей воду равномерно в течение дня.";
out = await say(42, "как пить больше воды?");
assert.equal(lastText(out), "Пей воду равномерно в течение дня.");

// приложение забирает записи
const pulled = await app("/inbox", { initData: initData(42) });
assert.equal(pulled.status, 200);
const cmds = pulled.json.items.map((i) => i.cmd);
assert.ok(cmds.includes("steps_14000") && cmds.includes("water_200") && cmds.includes("exp_1200_health"), cmds.join());
assert.equal((await app("/inbox", { initData: "user=%7B%22id%22%3A42%7D&hash=bad" })).status, 401);
await app("/inbox/ack", { initData: initData(42), ids: pulled.json.items.map((i) => i.id) });
assert.equal((await app("/inbox", { initData: initData(42) })).json.items.length, 0, "после подтверждения очередь пуста");
// чужой пользователь не видит и не закрывает чужие записи
await say(7, "5000 шагов");
await app("/inbox/ack", { initData: initData(42), ids: [999, 1, 2, 3, 4, 5, 6, 7] });
assert.equal((await app("/inbox", { initData: initData(7) })).json.items.length, 1);

// открытие приложения учитывается
await app("/sync", { initData: initData(42), context: "день" });

// человек заблокировал бота
await tg({ my_chat_member: { chat: { id: 7, type: "private" }, from: { id: 7 }, new_chat_member: { status: "kicked" } } });

// статистика: только для админа
out = await say(42, "/admin");
assert.match(lastText(out), /только для администратора/);
await say(1, "/start");
out = await say(1, "/admin");
const stats = lastText(out);
assert.match(stats, /Всего пользователей: 3 \(заблокировали бота: 1\)/);
assert.match(stats, /Ушли \(заблокировали\) за неделю: 1/);
assert.match(stats, /Открытий приложения за сутки: 1/);
assert.match(stats, /шаги 2/);
assert.ok(out.some((m) => m.method === "setWebhook" && m.body.allowed_updates.includes("my_chat_member")), "вебхук включает события блокировки");

console.log("Сервер: все проверки пройдены ✅\n\n" + stats);
