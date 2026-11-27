// «Звёздный рейс» — мини-игра в Telegram. Cloudflare Worker: отдаёт игру, API, вебхук бота, оплату звёздами.
// Звёзды (XTR) покупают только запуски и скины. Монеты — бесплатная игровая валюта (за полёты и каждый день),
// их нельзя купить и вывести; на них крутится колесо 50/50. Так в игре есть удача, но нет ставок на деньги.
// Токен бота хранится в KV (ставится один раз через /setup?key=SETUP_KEY), в коде и чате его нет.
import GAME from "./game.html";

const FREE_RUNS = 5;               // бесплатных запусков в день
const DAILY_COINS = 30;            // монет за первый вход дня
const SPIN_COST = 50;              // минимальная ставка в колесе
const DIFF_MULT = [1, 1.5, 2, 3];   // сложность: Лёгкая, Средняя, Тяжёлая, Хардкор — множитель монет
const SHOP = {
  runs5: { title: "+5 запусков", stars: 5, runs: 5 },
  runs20: { title: "+20 запусков", stars: 15, runs: 20 },
  skin_neon: { title: "Ракета «Неон»", stars: 25, skin: "neon" },
  skin_comet: { title: "Ракета «Комета»", stars: 35, skin: "comet" },
  skin_gold: { title: "Ракета «Золотая»", stars: 50, skin: "gold" },
};
// Колесо 50 на 50 на монетах: половина секторов ×2 (ставка возвращается вдвойне), половина 0 (ставка сгорает).
// Монеты нельзя купить за звёзды и нельзя вывести — это игровая валюта, на кону нет денег.
export const STAKES = [50, 100, 250, 500];
export const WHEEL = ["×2", "0", "×2", "0", "×2", "0", "×2", "0"];
// Что раньше выпадало в колесе, теперь покупается за монеты.
const COIN_SHOP = { shield: { title: "Щит на старт", coins: 100 }, skin_lucky: { title: "Ракета «Удача»", coins: 1000, skin: "lucky" } };
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
  const uname = u.username ? String(u.username).toLowerCase() : null;
  await env.DB.prepare("INSERT INTO players (id, name, username, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = COALESCE(excluded.username, players.username)").bind(u.id, name, uname, now).run();
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
  skins: skinsOf(p), skin: p.skin || "classic", daily: !!p.daily, dailyCoins: DAILY_COINS, spinCost: SPIN_COST, stakes: STAKES, coinShop: Object.entries(COIN_SHOP).map(([id, c]) => ({ id, ...c })),
  shop: Object.entries(SHOP).map(([id, s]) => ({ id, title: s.title, stars: s.stars, skin: s.skin })), wheel: WHEEL });

// Результат прокрутки: выигрыш с вероятностью ровно 1/2 и номер сектора, на котором остановится колесо.
export function spinPick(rand = Math.random(), rand2 = Math.random(), chance = 50) {
  const win = rand < chance / 100, idx = WHEEL.map((x, i) => i).filter((i) => (WHEEL[i] === "×2") === win);
  return { win, index: idx[Math.min(idx.length - 1, Math.floor(rand2 * idx.length))] };
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
    const diff = [0, 1, 2, 3].includes(Number(body.diff)) ? Number(body.diff) : 1;
    await env.DB.prepare("INSERT INTO runs (id, user_id, started, done, diff) VALUES (?, ?, ?, 0, ?)").bind(id, u.id, now, diff).run();
    return json(200, { runId: id, runs: runsLeft(p) - 1, shield });
  }

  if (path === "finish") {
    const r = await env.DB.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").bind(String(body.runId || ""), u.id).first();
    if (!r || r.done) return json(400, { error: "Полёт не найден" });
    const secs = (now - r.started) / 1000;
    // защита от накрутки: не больше 8 очков в секунду полёта (+10 на старт)
    const score = Math.max(0, Math.min(Math.floor(Number(body.score) || 0), Math.floor(secs * 8) + 10));
    const coins = Math.min(Math.round(score * (DIFF_MULT[r.diff ?? 1] ?? 1.5)), 900);
    await env.DB.batch([
      env.DB.prepare("UPDATE runs SET done = 1, score = ? WHERE id = ?").bind(score, r.id),
      env.DB.prepare("UPDATE players SET best = MAX(best, ?), week_best = MAX(week_best, ?), coins = coins + ? WHERE id = ?").bind(score, score, coins, u.id),
    ]);
    const q = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
    return json(200, { ...view(q), score, earned: coins, record: score > (p.best || 0) });
  }

  if (path === "spin") {
    // бесплатная прокрутка дня: ставка 50 монет за счёт игры (проигрыш ничего не отнимает)
    const free = !!p.free_spin && !body.paid;
    const stake = free ? STAKES[0] : Number(body.stake);
    if (!STAKES.includes(stake)) return json(400, { error: "Выберите ставку" });
    if (!free && (p.coins || 0) < stake) return json(403, { error: `Нужно ${stake} монет` });
    const r = spinPick(Math.random(), Math.random(), p.luck ?? 50);
    const delta = free ? (r.win ? stake : 0) : (r.win ? stake : -stake);
    await env.DB.prepare(`UPDATE players SET coins = MAX(0, coins + ?)${free ? ", free_spin = 0" : ""} WHERE id = ?`).bind(delta, u.id).run();
    const q = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
    return json(200, { ...view(q), win: r.win, delta, stake, free, index: r.index, prize: { label: r.win ? `Выигрыш +${stake} монет` : free ? "Не повезло, бесплатная прокрутка" : `Не повезло: −${stake} монет` } });
  }

  if (path === "coinbuy") {
    const it = COIN_SHOP[body.item];
    if (!it) return json(400, { error: "Нет такого товара" });
    if (it.skin && skinsOf(p).includes(it.skin)) return json(400, { error: "Эта ракета уже ваша" });
    if ((p.coins || 0) < it.coins) return json(403, { error: `Нужно ${it.coins} монет` });
    if (it.skin) { const sk = skinsOf(p); sk.push(it.skin); await env.DB.prepare("UPDATE players SET coins = coins - ?, skins = ?, skin = ? WHERE id = ?").bind(it.coins, JSON.stringify(sk), it.skin, u.id).run(); }
    else await env.DB.prepare("UPDATE players SET coins = coins - ?, shield = shield + 1 WHERE id = ?").bind(it.coins, u.id).run();
    const q = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
    return json(200, view(q));
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
  if (m.text?.startsWith("/luck")) return luckCommand(env, m);
  if (m.text?.startsWith("/paysupport")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Вопросы по оплате звёздами: напишите сюда, что купили и когда. Ответим в течение дня." });
  if (m.text?.startsWith("/terms")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Звёзды тратятся на запуски и внешний вид ракет. Монеты — только игровые: их дают за полёты и каждый день, купить или вывести их нельзя. Колесо 50/50 крутится только на монеты." });
  return tg(env, "sendMessage", { chat_id: m.chat.id, text: "🚀 «Звёздный рейс» — веди ракету, собирай звёзды и уворачивайся от астероидов.\n\n5 бесплатных полётов каждый день, колесо удачи и рейтинг недели.", reply_markup: { inline_keyboard: [[{ text: "🚀 Играть", web_app: { url: env.GAME_URL } }]] } });
}

// ---- «Везение» (только админы из ADMIN_IDS): шанс выигрыша в колесе для себя и выбранных игроков ----
// /luck — список; /luck @ник 80 или /luck 123456 80 — шанс 80%; /luck me 70 — себе; /luck @ник reset — обратно 50%.
const isAdmin = (env, id) => String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(String(id));
export async function luckCommand(env, m) {
  const say = (text) => tg(env, "sendMessage", { chat_id: m.chat.id, text });
  if (!isAdmin(env, m.from.id)) return say("Эта команда только для администратора.");
  const [, who, val] = m.text.trim().split(/\s+/);
  if (!who) {
    const rows = (await env.DB.prepare("SELECT id, name, username, luck FROM players WHERE luck IS NOT NULL ORDER BY luck DESC LIMIT 50").all()).results || [];
    return say(rows.length ? "🍀 Везение:\n" + rows.map((r) => `${r.name}${r.username ? " @" + r.username : ""} (${r.id}) — ${r.luck}%`).join("\n") + "\n\nИзменить: /luck @ник 80 · /luck me 70 · /luck @ник reset" : "Везение ни у кого не изменено, у всех 50%.\n\nПример: /luck me 70 или /luck @ник 80");
  }
  let p;
  if (who === "me") p = await env.DB.prepare("SELECT id, name FROM players WHERE id = ?").bind(m.from.id).first();
  else if (/^\d+$/.test(who)) p = await env.DB.prepare("SELECT id, name FROM players WHERE id = ?").bind(Number(who)).first();
  else p = await env.DB.prepare("SELECT id, name FROM players WHERE username = ?").bind(who.replace(/^@/, "").toLowerCase()).first();
  if (!p) return say("Игрок не найден. Он должен хотя бы раз открыть игру. Можно указать его Telegram ID числом.");
  if (val === "reset") { await env.DB.prepare("UPDATE players SET luck = NULL WHERE id = ?").bind(p.id).run(); return say(`${p.name}: везение снова обычное, 50%.`); }
  const n = Math.round(Number(val));
  if (!(n >= 0 && n <= 100)) return say("Укажите шанс от 0 до 100, например: /luck " + who + " 75");
  await env.DB.prepare("UPDATE players SET luck = ? WHERE id = ?").bind(n, p.id).run();
  return say(`🍀 ${p.name}: шанс выигрыша в колесе теперь ${n}%.`);
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
