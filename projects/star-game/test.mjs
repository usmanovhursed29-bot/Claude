// node --experimental-sqlite --loader ./html-loader.mjs test.mjs — проверки сервера без сети
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker, { apiRoute, onUpdate, spinPick, WHEEL, minesMult, placeMines, applyLuck, quickPlay, luckP, diceMult, crashPoint, crashAt } from "./worker.js";

const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
const st = (sql) => { let a = []; const s = db.prepare(sql); return { bind(...x) { a = x; return this; }, first: async () => s.get(...a) ?? null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: r.changes } }; } }; };
const kv = new Map();
const env = { ADMIN_IDS: "7", DB: { prepare: st, batch: async (l) => { for (const x of l) await x.run(); } }, KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) }, BOT_TOKEN: "1:T", GAME_URL: "https://g" };
const sent = [];
globalThis.fetch = async (u, o) => { const m = String(u).split("/").pop(); const b = o?.body ? JSON.parse(o.body) : {}; sent.push({ m, b }); return new Response(JSON.stringify(m === "createInvoiceLink" ? { ok: true, result: "https://t.me/$inv" } : { ok: true })); };
function init(id, t = Date.now(), uname) {
  const f = { auth_date: String(Math.floor(t / 1000)), user: JSON.stringify({ id, first_name: "U" + id, ...(uname ? { username: uname } : {}) }) };
  const check = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...f, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
}
const t0 = Date.UTC(2026, 10, 27, 10), t1 = t0 + 86400000;
const call = async (path, body = {}, now = t0, id = 7) => { const r = await apiRoute(path, { initData: init(id, now, id === 8 ? "friend" : undefined), ...body }, env, now); return { status: r.status, j: await r.json() }; };
const coins = (id = 7) => db.prepare("SELECT coins FROM players WHERE id = ?").get(id).coins;

// новичок: 500 + 100 за день, бесплатная прокрутка
let r = await call("me"); assert.equal(r.j.coins, 600); assert.equal(r.j.freeSpin, true); assert.equal(r.j.game, null);
assert.equal((await apiRoute("me", { initData: "user=x&hash=bad" }, env)).status, 401);

// множители «Мин»: 3 мины, 1 клетка = 0.97·25/22
assert.equal(minesMult(3, 1), 1.10); assert.equal(minesMult(24, 1), 24.25); assert.equal(minesMult(5, 0), 1);
const pm = placeMines(5); assert.equal(pm.length, 5); assert.equal(new Set(pm).size, 5);

// игра: ставка списывается, безопасная клетка, забрать выигрыш
r = await call("mines/start", { stake: 100, mines: 3 }); assert.equal(r.status, 200); assert.equal(r.j.coins, 500);
const gid = r.j.game.id;
assert.equal((await call("mines/start", { stake: 100, mines: 3 })).status, 400, "вторая игра параллельно нельзя");
let mines = JSON.parse(db.prepare("SELECT mines FROM mines_games WHERE id = ?").get(gid).mines);
const safe = [...Array(25).keys()].filter((c) => !mines.includes(c));
r = await call("mines/open", { gameId: gid, cell: safe[0] }); assert.equal(r.j.safe, true); assert.equal(r.j.game.mult, 1.10); assert.equal(r.j.mines, undefined, "мины не показываем до конца");
assert.equal((await call("mines/open", { gameId: gid, cell: safe[0] })).status, 400, "та же клетка второй раз");
r = await call("mines/open", { gameId: gid, cell: safe[1] });
r = await call("mines/cash", { gameId: gid }); assert.equal(r.j.win, Math.floor(100 * minesMult(3, 2))); assert.equal(r.j.coins, 500 + r.j.win);
assert.deepEqual(r.j.mines, mines, "после конца показываем расстановку");

// проигрыш: мина забирает ставку
const c1 = coins();
r = await call("mines/start", { stake: 50, mines: 24 }); const g2 = r.j.game.id;
mines = JSON.parse(db.prepare("SELECT mines FROM mines_games WHERE id = ?").get(g2).mines);
r = await call("mines/open", { gameId: g2, cell: mines[0] }); assert.equal(r.j.boom, true); assert.equal(r.j.coins, c1 - 50);
assert.equal((await call("mines/cash", { gameId: g2 })).status, 400);
assert.equal((await call("mines/start", { stake: 9, mines: 3 })).status, 400, "ставка не меньше 10");
assert.equal((await call("mines/start", { stake: 50, mines: 2 })).status, 400, "мин не меньше 3");
assert.equal((await call("mines/start", { stake: 50, mines: 25 })).status, 400, "мин не больше 24");
assert.ok(minesMult(7, 1) > minesMult(6, 1) && minesMult(13, 2) > minesMult(12, 2), "больше мин — больше множитель");
{ const cc = coins(); r = await call("mines/start", { stake: 50, mines: 13 }); assert.equal(r.status, 200); assert.equal(r.j.game.m, 13); assert.equal(r.j.game.next, minesMult(13, 1));
  const mx = JSON.parse(db.prepare("SELECT mines FROM mines_games WHERE id = ?").get(r.j.game.id).mines); assert.equal(mx.length, 13); await call("mines/open", { gameId: r.j.game.id, cell: mx[0] }); }
assert.equal((await call("mines/start", { stake: 12.5, mines: 3 })).status, 400, "ставка целым числом");
{ const cc = coins(); r = await call("mines/start", { stake: 37, mines: 3 }); assert.equal(r.status, 200); assert.equal(r.j.coins, cc - 37); const gx = r.j.game.id;
  const mx = JSON.parse(db.prepare("SELECT mines FROM mines_games WHERE id = ?").get(gx).mines); await call("mines/open", { gameId: gx, cell: mx[0] }); }

// везение в «Минах»: 100% — мина всегда уходит, 0% — мина всегда приходит
{ const ms = [0, 1, 2]; assert.ok(!applyLuck(ms, [], 0, 100).includes(0)); assert.ok(applyLuck(ms, [], 10, 0).includes(10)); assert.deepEqual(applyLuck(ms, [], 0, null), ms); }

// колесо 50/50 и бесплатная прокрутка
{ let w = 0; for (let i = 0; i < 2000; i++) { const x = spinPick(i / 2000, .3); w += x.win; assert.equal(WHEEL[x.index], x.win ? "×2" : "0"); } assert.equal(w, 1000); }
let c0 = coins();
r = await call("spin"); assert.equal(r.j.free, true); assert.equal(r.j.coins, c0 + (r.j.win ? 50 : 0));
c0 = r.j.coins; r = await call("spin", { stake: 100, paid: 1 }); assert.equal(r.j.coins, c0 + (r.j.win ? 100 : -100));

// /luck: только админ; по нику друга; 100% — всегда выигрыш в колесе и в «Минах»
const say = async (from, text) => { await onUpdate({ message: { chat: { id: from }, from: { id: from, first_name: "A" }, text } }, env); return sent.at(-1).b.text; };
await call("me", {}, t0, 8);
assert.match(await say(9, "/luck me 90"), /только для администратора/);
assert.match(await say(7, "/luck @friend 100"), /U8: везение 100%/);
db.prepare("UPDATE players SET coins = 5000 WHERE id = 8").run();
for (let i = 0; i < 5; i++) assert.equal((await call("spin", { stake: 50, paid: 1 }, t0, 8)).j.win, true);
r = await call("mines/start", { stake: 100, mines: 24 }, t0, 8); r = await call("mines/open", { gameId: r.j.game.id, cell: 12 }, t0, 8);
assert.equal(r.j.win, Math.floor(100 * 24.25), "с везением 100% единственная безопасная клетка находится сразу");
assert.match(await say(7, "/luck"), /U8 @friend \(8\) — 100%/);
assert.match(await say(7, "/luck @friend reset"), /50%/);
assert.match(await say(9, "/coins me 1000"), /только для администратора/);
const cf = coins(8); assert.match(await say(7, "/coins @friend 1000"), /\+1000 SC/); assert.equal(coins(8), cf + 1000);
assert.match(await say(7, "/coins @friend -99999999"), /Пример/); assert.match(await say(7, "/coins @friend -500"), /-500/); assert.equal(coins(8), cf + 500);

// магазин: звёзды только за оформление, монеты — за «Удачу»
r = await call("buy", { item: "theme_neon" }); assert.equal(r.j.link, "https://t.me/$inv");
await onUpdate({ pre_checkout_query: { id: "q", from: { id: 7 }, currency: "XTR", total_amount: 25, invoice_payload: "theme_neon:7" } }, env); assert.equal(sent.at(-1).b.ok, true);
await onUpdate({ pre_checkout_query: { id: "q2", from: { id: 7 }, currency: "XTR", total_amount: 1, invoice_payload: "theme_neon:7" } }, env); assert.equal(sent.at(-1).b.ok, false);
const pay = { message: { chat: { id: 7 }, from: { id: 7, first_name: "U7" }, successful_payment: { telegram_payment_charge_id: "ch1", invoice_payload: "theme_neon:7", total_amount: 25, currency: "XTR" } } };
const cBefore = coins(); await onUpdate(pay, env); await onUpdate(pay, env);
r = await call("me"); assert.ok(r.j.themes.includes("neon")); assert.equal(r.j.theme, "neon"); assert.equal(coins(), cBefore, "звёзды не дают монет");
assert.equal(db.prepare("SELECT COUNT(*) c FROM payments").get().c, 1);
db.prepare("UPDATE players SET coins = 2500 WHERE id = 7").run();
r = await call("coinbuy", { item: "theme_lucky" }); assert.equal(r.j.coins, 500); assert.ok(r.j.themes.includes("lucky"));
assert.equal((await call("theme", { theme: "gold" })).status, 403);

// быстрые игры: честные шансы, везение, расчёт выигрыша
assert.equal(luckP(.5, 100), 1); assert.equal(luckP(.5, 0), 0); assert.equal(luckP(.3, null), .3); assert.equal(luckP(.5, 75), .75);
{ let w = 0, N = 30000; for (let i = 0; i < N; i++) w += quickPlay("coin", { side: "heads" }, null).win; assert.ok(Math.abs(w / N - .5) < .02, "монетка ~50%"); }
{ let w = 0, N = 30000; for (let i = 0; i < N; i++) { const r2 = quickPlay("dice", { target: 51 }, null); w += r2.win; assert.equal(r2.win, r2.result < 51); } assert.ok(Math.abs(w / N - .5) < .02, "кубик <51 ~50%"); }
{ let w = 0, N = 30000; for (let i = 0; i < N; i++) { const r2 = quickPlay("chest", { pick: 1 }, null); w += r2.win; assert.equal(r2.win, r2.result === 1); } assert.ok(Math.abs(w / N - 1 / 3) < .02, "сундук ~1/3"); }
assert.equal(diceMult(51), 1.94); assert.equal(quickPlay("dice", { target: 2 }, null), null);
for (let i = 0; i < 50; i++) { assert.equal(quickPlay("coin", { side: "tails" }, 100).win, true); assert.equal(quickPlay("chest", { pick: 0 }, 0).win, false); }
{ let surv = 0, N = 40000; for (let i = 0; i < N; i++) surv += crashPoint(null) >= 2; assert.ok(Math.abs(surv / N - .485) < .02, "Ракетка: до ×2 долетает ~48,5%"); }
assert.equal(crashPoint(100), 1000); assert.equal(crashAt(0), 1); assert.equal(crashAt(10000), 2.22);
db.prepare("UPDATE players SET coins = 1000, luck = NULL WHERE id = 7").run();
r = await call("play", { game: "coin", stake: 100, params: { side: "heads" } }); assert.equal(r.j.coins, 900 + r.j.win); assert.equal(r.j.win, r.j.win ? 194 : 0);
assert.equal((await call("play", { game: "dice", stake: 100, params: { target: 1 } })).status, 400);
assert.equal((await call("play", { game: "slots", stake: 100 })).status, 400);
db.prepare("UPDATE players SET coins = 1000 WHERE id = 7").run();
r = await call("play", { game: "coin", stake: 777, params: { side: "tails" } }); assert.equal(r.j.coins, 1000 - 777 + r.j.win); assert.equal(r.j.win, r.j.win ? Math.floor(777 * 1.94) : 0);
assert.equal((await call("play", { game: "coin", stake: 5, params: { side: "tails" } })).status, 400);
// «Ракетка»: забрать до взрыва = ставка × множитель по серверному времени; после взрыва — проигрыш
db.prepare("UPDATE players SET coins = 1000, luck = 100 WHERE id = 7").run();
r = await call("crash/start", { stake: 100 }, t0); const cid = r.j.id; assert.equal(r.j.coins, 900);
r = await call("crash/tick", { id: cid }, t0 + 5000); assert.equal(r.j.flying, true); assert.equal(r.j.mult, crashAt(5000));
r = await call("crash/cash", { id: cid }, t0 + 5000); assert.equal(r.j.win, Math.floor(100 * crashAt(5000))); assert.equal(r.j.coins, 900 + r.j.win);
assert.equal((await call("crash/cash", { id: cid }, t0 + 6000)).j.crashed, true, "второй раз не забрать");
db.prepare("UPDATE players SET luck = 0 WHERE id = 7").run();
r = await call("crash/start", { stake: 100 }, t0); const cid2 = r.j.id;
r = await call("crash/cash", { id: cid2 }, t0 + 60000); assert.equal(r.j.crashed, true); assert.equal(r.j.status, "lost");
db.prepare("UPDATE players SET luck = NULL WHERE id = 7").run();

// «Ракета»: 3 бесплатных полёта в день, очки ограничены временем, SC не меняются; полёты покупаются звёздами
{ const c0 = coins(); r = await call("me", {}, t0); assert.equal(r.j.runs, 3);
  r = await call("race/start", {}, t0); const rid = r.j.runId; assert.equal(r.j.runs, 2);
  r = await call("race/finish", { runId: rid, score: 9999 }, t0 + 10000); assert.equal(r.j.score, 90); assert.equal(r.j.raceBest, 90); assert.equal(coins(), c0, "за Ракету SC не дают");
  assert.equal((await call("race/finish", { runId: rid, score: 5 }, t0 + 11000)).status, 400);
  await call("race/start", {}, t0); await call("race/start", {}, t0); assert.equal((await call("race/start", {}, t0)).status, 403);
  r = await call("buy", { item: "runs10" }); assert.equal(r.j.link, "https://t.me/$inv");
  await onUpdate({ message: { chat: { id: 7 }, from: { id: 7, first_name: "U7" }, successful_payment: { telegram_payment_charge_id: "chR", invoice_payload: "runs10:7", total_amount: 10, currency: "XTR" } } }, env);
  r = await call("me", {}, t0); assert.equal(r.j.runs, 10); assert.equal(coins(), c0, "звёзды не дают SC");
  r = await call("race/top", {}, t0); assert.equal(r.j.top[0].score, 90); }

// профиль: игры и победы считаются
r = await call("me"); assert.ok(r.j.played >= 5); assert.ok(r.j.wins >= 1 && r.j.wins <= r.j.played); assert.equal(r.j.id, 7); assert.equal(r.j.name, "U7");

// новый день — +100 и снова бесплатная прокрутка; рейтинг по лучшему выигрышу недели
r = await call("me", {}, t1); assert.equal(r.j.freeSpin, true);
r = await call("top", {}, t0); assert.ok(r.j.top.length >= 1); assert.ok(r.j.top[0].score > 0);
const page = await worker.fetch(new Request("https://g/"), env, {}); assert.equal(page.status, 200);
assert.equal((await worker.fetch(new Request("https://g/setup"), { ...env, SETUP_KEY: "k" }, {})).status, 403);
console.log("StarRace: все проверки пройдены ✅");
