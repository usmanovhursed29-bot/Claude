// node --experimental-sqlite --loader ./html-loader.mjs test.mjs — проверки сервера без сети
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import assert from "node:assert/strict";
import worker, { apiRoute, onUpdate, spinPick, WHEEL } from "./worker.js";

const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const st = (sql) => { let a = []; const s = db.prepare(sql); return { bind(...x) { a = x; return this; }, first: async () => s.get(...a) ?? null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: r.changes } }; } }; };
const kv = new Map();
const env = { DB: { prepare: st, batch: async (l) => { for (const x of l) await x.run(); } }, KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) }, BOT_TOKEN: "1:T", GAME_URL: "https://g" };
const sent = [];
globalThis.fetch = async (u, o) => { const m = String(u).split("/").pop(); const b = o?.body ? JSON.parse(o.body) : {}; sent.push({ m, b }); return new Response(JSON.stringify(m === "createInvoiceLink" ? { ok: true, result: "https://t.me/$inv" } : { ok: true })); };
function init(id, t = Date.now()) {
  const f = { auth_date: String(Math.floor(t / 1000)), user: JSON.stringify({ id, first_name: "U" + id }) };
  const check = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...f, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
}
const call = async (path, body, now) => { const r = await apiRoute(path, { initData: init(7, now), ...body }, env, now); return { status: r.status, j: await r.json() }; };

let t0 = Date.UTC(2026, 10, 27, 10);
let r = await call("me", {}, t0);
assert.equal(r.j.runs, 5); assert.equal(r.j.coins, 30); assert.equal(r.j.freeSpin, true); assert.equal(r.j.daily, true);
assert.equal((await apiRoute("me", { initData: "user=x&hash=bad" }, env)).status, 401);
// полёт: очки ограничены временем
r = await call("run", { diff: 1 }, t0); const run = r.j.runId; assert.equal(r.j.runs, 4);
r = await call("finish", { runId: run, score: 9999 }, t0 + 20000); assert.equal(r.j.score, 170, "не больше 8 очков/с + 10"); assert.equal(r.j.best, 170); assert.equal(r.j.coins, 30 + 255, "средняя сложность ×1,5");
assert.equal((await call("finish", { runId: run, score: 5 }, t0 + 30000)).status, 400, "второй раз тот же полёт не засчитать");
// лимит запусков
for (let i = 0; i < 4; i++) await call("run", {}, t0);
assert.equal((await call("run", {}, t0)).status, 403);
// колесо: бесплатная прокрутка, потом за монеты
assert.equal(spinPick(0).id, "c10"); assert.equal(spinPick(0.9999).id, WHEEL.at(-1).id);
r = await call("spin", {}, t0); assert.equal(r.j.freeSpin, false); assert.ok(r.j.prize.label);
const coinsAfter = r.j.coins;
r = await call("spin", {}, t0); assert.ok(r.status === 200); assert.ok(r.j.coins <= coinsAfter - 50 + 200);
// новый день: снова 5 запусков и бонус
r = await call("me", {}, t0 + 86400000); assert.equal(r.j.freeSpin, true); assert.ok(r.j.runs >= 5);
// покупка звёздами: счёт, проверка, зачисление один раз
r = await call("buy", { item: "runs5" }, t0); assert.equal(r.j.link, "https://t.me/$inv");
const inv = sent.find((x) => x.m === "createInvoiceLink").b; assert.equal(inv.currency, "XTR"); assert.equal(inv.prices[0].amount, 5);
await onUpdate({ pre_checkout_query: { id: "q", from: { id: 7 }, currency: "XTR", total_amount: 5, invoice_payload: "runs5:7" } }, env);
assert.equal(sent.at(-1).b.ok, true);
await onUpdate({ pre_checkout_query: { id: "q2", from: { id: 7 }, currency: "XTR", total_amount: 1, invoice_payload: "runs5:7" } }, env);
assert.equal(sent.at(-1).b.ok, false, "неверная сумма — отказ");
const before = (await call("me", {}, t0 + 86400000)).j.runs;
const pay = { message: { chat: { id: 7 }, from: { id: 7, first_name: "U7" }, successful_payment: { telegram_payment_charge_id: "ch1", invoice_payload: "runs5:7", total_amount: 5, currency: "XTR" } } };
await onUpdate(pay, env); await onUpdate(pay, env);
assert.equal((await call("me", {}, t0 + 86400000)).j.runs, before + 5, "оплата зачислена ровно один раз");
await onUpdate({ message: { chat: { id: 7 }, from: { id: 7 }, successful_payment: { telegram_payment_charge_id: "ch2", invoice_payload: "skin_gold:7", total_amount: 50, currency: "XTR" } } }, env);
r = await call("me", {}, t0 + 86400000); assert.ok(r.j.skins.includes("gold")); assert.equal(r.j.skin, "gold");
assert.equal((await call("skin", { skin: "neon" }, t0 + 86400000)).status, 403, "нельзя выбрать не купленную ракету");
// рейтинг
r = await call("top", {}, t0); assert.equal(r.j.top[0].score, 170); assert.equal(r.j.top[0].me, true);
// игра отдаётся по GET /
const page = await worker.fetch(new Request("https://g/"), env, {}); assert.equal(page.status, 200); assert.match(await page.text(), /Звёздный рейс/);
// /setup без ключа закрыт
assert.equal((await worker.fetch(new Request("https://g/setup"), { ...env, SETUP_KEY: "k" }, {})).status, 403);
r = await call("run", { diff: 3 }, t0 + 86400000); const hr = r.j.runId;
r = await call("finish", { runId: hr, score: 10 }, t0 + 86400000 + 10000); assert.equal(r.j.earned, 30, "хардкор ×3");
console.log("Звёздный рейс: все проверки пройдены ✅");
