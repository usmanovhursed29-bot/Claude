// «Звёздный рейс» — мини-игра в Telegram. Cloudflare Worker: отдаёт игру, API, вебхук бота, оплату звёздами.
// Звёзды (XTR) покупают только запуски и скины. Монеты — бесплатная игровая валюта (за полёты и каждый день),
// их нельзя купить и вывести; на них крутится колесо удачи. Так в игре есть удача, но нет ставок на деньги.
// Токен бота хранится в KV (ставится один раз через /setup?key=SETUP_KEY), в коде и чате его нет.
import GAME from "./game.html";

const FREE_RUNS = 5;               // бесплатных запусков в день
const DAILY_COINS = 30;            // монет за первый вход дня
const SPIN_COST = 50;              // монет за прокрутку колеса
const SHOP = {
  runs5: { title: "+5 запусков", stars: 5, runs: 5 },
  runs20: { title: "+20 запусков", stars: 15, runs: 20 },
  skin_neon: { title: "Ракета «Неон»", stars: 25, skin: "neon" },
  skin_comet: { title: "Ракета «Комета»", stars: 35, skin: "comet" },
  skin_gold: { title: "Ракета «Золотая»", stars: 50, skin: "gold" },
};
// Колесо: только игровые призы. w — вес (вероятность = w / сумма).
export const WHEEL = [
  { id: "c10", label: "10 монет", coins: 10, w: 26 },
  { id: "c30", label: "30 монет", coins: 30, w: 22 },
  { id: "c80", label: "80 монет", coins: 80, w: 12 },
  { id: "c200", label: "200 монет", coins: 200, w: 3 },
  { id: "run1", label: "+1 запуск", runs: 1, w: 16 },
  { id: "run3", label: "+3 запуска", runs: 3, w: 6 },
  { id: "shield", label: "Щит на старт", shield: 1, w: 13 },
  { id: "lucky", label: "Ракета «Удача»", skin: "lucky", w: 2 },
];
const AUTH_MAX_AGE = 24 * 3600;

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
function week(t = Date.now()) { const d = new Date(t); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function token(env) { return env.BOT_TOKEN || (await env.KV.get("bot_token")); }
async function tg(env, method, payload) {
  const t = await token(env);
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json().catch(() => ({}));
}
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}
export async function telegramUser(initData, botToken, now = Date.now()) {
  if (typeof initData !== "string" || !initData || !botToken) return null;
  const p = new URLSearchParams(initData), hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const enc = new TextEncoder();
  const secret = await hmacHex(enc.encode("WebAppData"), enc.encode(botToken));
  const exp = [...(await hmacHex(secret, enc.encode(check)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (exp !== hash) return null;
  const ad = Number(p.get("auth_date"));
  if (!ad || now / 1000 - ad > AUTH_MAX_AGE) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}
async function webhookSecret(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hook:${t}`));
  return [...new Uint8Array(d)].slice(0, 24).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- игрок ----
async function player(env, u, now = Date.now()) {
  const name = String([u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Игрок").slice(0, 40);
  await env.DB.prepare("INSERT INTO players (id, name, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(u.id, name, now).run();
  const p = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
  const today = day(now), patch = {};
  if (p.free_day !== today) { patch.free_day = today; patch.free_used = 0; }
  if (p.coin_day !== today) { patch.coin_day = today; patch.coins = (p.coins || 0) + DAILY_COINS; patch.free_spin = 1; }
  if (p.week !== week(now)) { patch.week = week(now); patch.week_best = 0; }
  if (Object.keys(patch).length) {
    const ks = Object.keys(patch);
    await env.DB.prepare(`UPDATE players SET ${ks.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...ks.map((k) => patch[k]), u.id).run();
    Object.assign(p, patch, { daily: !!patch.coin_day });
  }
  return p;
}
const runsLeft = (p) => Math.max(0, FREE_RUNS - (p.free_used || 0)) + (p.runs_extra || 0);
const skinsOf = (p) => { try { return JSON.parse(p.skins || '["classic"]'); } catch { return ["classic"]; } };
const view = (p) => ({ runs: runsLeft(p), best: p.best || 0, weekBest: p.week_best || 0, coins: p.coins || 0, freeSpin: !!p.free_spin, shield: p.shield || 0,
  skins: skinsOf(p), skin: p.skin || "classic", daily: !!p.daily, dailyCoins: DAILY_COINS, spinCost: SPIN_COST,
  shop: Object.entries(SHOP).map(([id, s]) => ({ id, title: s.title, stars: s.stars, skin: s.skin })), wheel: WHEEL.map(({ id, label }) => ({ id, label })) });

export function spinPick(rand = Math.random()) {
  const total = WHEEL.reduce((s, x) => s + x.w, 0);
  let r = rand * total;
  for (const x of WHEEL) { if ((r -= x.w) < 0) return x; }
  return WHEEL[0];
}

async function apiRoute(path, body, env, now = Date.now()) {
  const u = await telegramUser(body.initData, await token(env), now);
  if (!u) return json(401, { error: "Откройте игру внутри Telegram" });
  const p = await player(env, u, now);

  if (path === "me") return json(200, view(p));

  if (path === "run") {
    if (runsLeft(p) <= 0) return json(403, { error: "Запуски на сегодня закончились" });
    const free = (p.free_used || 0) < FREE_RUNS;
    await env.DB.prepare(free ? "UPDATE players SET free_used = free_used + 1 WHERE id = ?" : "UPDATE players SET runs_extra = runs_extra - 1 WHERE id = ?").bind(u.id).run();
    const id = crypto.randomUUID(), shield = (p.shield || 0) > 0 ? 1 : 0;
    if (shield) await env.DB.prepare("UPDATE players SET shield = shield - 1 WHERE id = ?").bind(u.id).run();
    await env.DB.prepare("INSERT INTO runs (id, user_id, started, done) VALUES (?, ?, ?, 0)").bind(id, u.id, now).run();
    return json(200, { runId: id, runs: runsLeft(p) - 1, shield });
  }

  if (path === "finish") {
    const r = await env.DB.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").bind(String(body.runId || ""), u.id).first();
    if (!r || r.done) return json(400, { error: "Полёт не найден" });
    const secs = (now - r.started) / 1000;
    // защита от накрутки: не больше 6 очков в секунду полёта (+10 на старт)
    const score = Math.max(0, Math.min(Math.floor(Number(body.score) || 0), Math.floor(secs * 6) + 10));
    const coins = Math.min(score, 300);
    await env.DB.batch([
      env.DB.prepare("UPDATE runs SET done = 1, score = ? WHERE id = ?").bind(score, r.id),
      env.DB.prepare("UPDATE players SET best = MAX(best, ?), week_best = MAX(week_best, ?), coins = coins + ? WHERE id = ?").bind(score, score, coins, u.id),
    ]);
    const q = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
    return json(200, { ...view(q), score, earned: coins, record: score > (p.best || 0) });
  }

  if (path === "spin") {
    const free = !!p.free_spin;
    if (!free && (p.coins || 0) < SPIN_COST) return json(403, { error: `Нужно ${SPIN_COST} монет` });
    const prize = spinPick(body.__rand ?? Math.random());
    const sets = [], args = [];
    if (free) sets.push("free_spin = 0"); else { sets.push("coins = coins - ?"); args.push(SPIN_COST); }
    if (prize.coins) { sets.push("coins = coins + ?"); args.push(prize.coins); }
    if (prize.runs) { sets.push("runs_extra = runs_extra + ?"); args.push(prize.runs); }
    if (prize.shield) { sets.push("shield = shield + 1"); }
    let dup = false;
    if (prize.skin) { const s = skinsOf(p); if (s.includes(prize.skin)) { dup = true; sets.push("coins = coins + 150"); } else { s.push(prize.skin); sets.push("skins = ?"); args.push(JSON.stringify(s)); } }
    await env.DB.prepare(`UPDATE players SET ${sets.join(", ")} WHERE id = ?`).bind(...args, u.id).run();
    const q = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
    return json(200, { ...view(q), prize: { id: prize.id, label: dup ? "Ракета «Удача» уже есть: +150 монет" : prize.label }, index: WHEEL.indexOf(prize) });
  }

  if (path === "skin") {
    const s = String(body.skin || "");
    if (!skinsOf(p).includes(s)) return json(403, { error: "Эта ракета ещё не открыта" });
    await env.DB.prepare("UPDATE players SET skin = ? WHERE id = ?").bind(s, u.id).run();
    return json(200, { ok: true });
  }

  if (path === "buy") {
    const it = SHOP[body.item];
    if (!it) return json(400, { error: "Нет такого товара" });
    if (it.skin && skinsOf(p).includes(it.skin)) return json(400, { error: "Эта ракета уже ваша" });
    const r = await tg(env, "createInvoiceLink", { title: it.title, description: it.skin ? "Новый внешний вид ракеты в «Звёздном рейсе»" : "Дополнительные полёты в «Звёздном рейсе»", payload: `${body.item}:${u.id}`, currency: "XTR", prices: [{ label: it.title, amount: it.stars }] });
    if (!r.ok) return json(502, { error: "Оплата временно недоступна" });
    return json(200, { link: r.result });
  }

  if (path === "top") {
    const rows = (await env.DB.prepare("SELECT id, name, week_best FROM players WHERE week = ? AND week_best > 0 ORDER BY week_best DESC LIMIT 30").bind(week(now)).all()).results || [];
    return json(200, { top: rows.map((r) => ({ name: r.name, score: r.week_best, me: r.id === u.id })) });
  }
  return json(404, { error: "Not found" });
}

async function onUpdate(up, env) {
  if (up.pre_checkout_query) {
    const q = up.pre_checkout_query, [item, uid] = String(q.invoice_payload || "").split(":"), it = SHOP[item];
    const ok = !!it && Number(uid) === q.from.id && q.currency === "XTR" && q.total_amount === it.stars;
    return tg(env, "answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "Товар изменился, откройте магазин заново" });
  }
  const m = up.message;
  if (!m?.from) return;
  if (m.successful_payment) {
    const sp = m.successful_payment, [item] = String(sp.invoice_payload || "").split(":"), it = SHOP[item];
    if (!it) return;
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO payments (charge_id, user_id, item, stars, ts) VALUES (?, ?, ?, ?, ?)").bind(sp.telegram_payment_charge_id, m.from.id, item, sp.total_amount, Date.now()).run();
    if (!ins.meta?.changes) return; // повтор той же оплаты
    await player(env, m.from);
    if (it.runs) await env.DB.prepare("UPDATE players SET runs_extra = runs_extra + ? WHERE id = ?").bind(it.runs, m.from.id).run();
    if (it.skin) {
      const p = await env.DB.prepare("SELECT skins FROM players WHERE id = ?").bind(m.from.id).first();
      const s = skinsOf(p); if (!s.includes(it.skin)) s.push(it.skin);
      await env.DB.prepare("UPDATE players SET skins = ?, skin = ? WHERE id = ?").bind(JSON.stringify(s), it.skin, m.from.id).run();
    }
    return tg(env, "sendMessage", { chat_id: m.chat.id, text: `⭐ Спасибо! ${it.title} уже в игре.` });
  }
  if (m.text?.startsWith("/paysupport")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Вопросы по оплате звёздами: напишите сюда, что купили и когда. Ответим в течение дня." });
  if (m.text?.startsWith("/terms")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Звёзды тратятся на запуски и внешний вид ракет. Монеты и призы колеса — только игровые, их нельзя купить или вывести." });
  return tg(env, "sendMessage", { chat_id: m.chat.id, text: "🚀 «Звёздный рейс» — веди ракету, собирай звёзды и уворачивайся от астероидов.\n\n5 бесплатных полётов каждый день, колесо удачи и рейтинг недели.", reply_markup: { inline_keyboard: [[{ text: "🚀 Играть", web_app: { url: env.GAME_URL } }]] } });
}

const SETUP_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение бота</title>
<style>body{font:16px system-ui;background:#0b1226;color:#f5f1e6;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}form{display:grid;gap:12px;max-width:420px;width:100%}input,button{font:inherit;padding:14px;border-radius:12px;border:0}button{background:#ffc94a;font-weight:700}p{color:#a9b4cf}</style>
<form method="post"><h2>Подключить бота к игре</h2><p>Вставьте токен от @BotFather. Он сохранится только на сервере игры.</p><input name="token" placeholder="123456:ABC..." autocomplete="off" required><button>Подключить</button></form>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return new Response(GAME, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname === "/setup") {
      if (!env.SETUP_KEY || url.searchParams.get("key") !== env.SETUP_KEY) return new Response("Нет доступа", { status: 403 });
      if (request.method === "GET") return new Response(SETUP_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      const t = String((await request.formData()).get("token") || "").trim();
      const me = await (await fetch(`https://api.telegram.org/bot${t}/getMe`)).json().catch(() => ({}));
      if (!me.ok) return new Response("Токен не подошёл. Вернитесь назад и проверьте его.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      await env.KV.put("bot_token", t);
      const hook = `${url.origin}/telegram`;
      await fetch(`https://api.telegram.org/bot${t}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hook, secret_token: await webhookSecret(t), allowed_updates: ["message", "pre_checkout_query"] }) });
      await fetch(`https://api.telegram.org/bot${t}/setChatMenuButton`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ menu_button: { type: "web_app", text: "Играть", web_app: { url: env.GAME_URL } } }) });
      return new Response(`Готово! Бот @${me.result.username} подключён. Откройте его в Telegram и нажмите «Играть».`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (url.pathname === "/telegram") {
      const t = await token(env);
      if (!t || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(t))) return new Response("forbidden", { status: 403 });
      const up = await request.json();
      ctx.waitUntil(onUpdate(up, env));
      return new Response("ok");
    }
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      try { body = await request.json(); } catch {}
      delete body.__rand;
      return apiRoute(url.pathname.slice(5), body, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
export { apiRoute, onUpdate };
