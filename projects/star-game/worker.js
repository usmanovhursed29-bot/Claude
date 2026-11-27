// «StarRace» — мини-игры в Telegram: «Мины», колесо 50/50, монетка, кубик, сундуки, «Ракетка». Cloudflare Worker: отдаёт игру, API, вебхук бота, оплату звёздами.
// Играют только на монеты: их дают каждый день, их нельзя купить за звёзды и нельзя вывести.
// Звёзды (XTR) покупают только оформление (темы поля). Поэтому ставок на деньги в игре нет.
// Токен бота хранится в KV (ставится один раз через /setup?key=SETUP_KEY).
import GAME from "./game.html";

const DAILY_COINS = 100;           // монет за первый вход дня
const START_COINS = 500;           // монет новичку
export const STAKES = [50, 100, 250, 500];
export const MINES = [3, 5, 10, 24];
const EDGE = 0.97;                 // множитель «Мин» = 0.97 × честный шанс
export const WHEEL = ["×2", "0", "×2", "0", "×2", "0", "×2", "0"];
const THEMES = ["classic", "neon", "gold", "cosmos", "lucky"];
const SHOP = {                     // за звёзды — только внешний вид
  theme_neon: { title: "Поле «Неон»", stars: 25, theme: "neon" },
  theme_cosmos: { title: "Поле «Космос»", stars: 35, theme: "cosmos" },
  theme_gold: { title: "Поле «Золото»", stars: 50, theme: "gold" },
};
const COIN_SHOP = { theme_lucky: { title: "Поле «Удача»", coins: 2000, theme: "lucky" } };
const AUTH_MAX_AGE = 24 * 3600;

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
function week(t = Date.now()) { const d = new Date(t); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function token(env) { return env.BOT_TOKEN || (await env.KV.get("bot_token")); }
async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${await token(env)}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json().catch(() => ({}));
}
async function hmac(key, msg) { const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg)); }
export async function telegramUser(initData, botToken, now = Date.now()) {
  if (typeof initData !== "string" || !initData || !botToken) return null;
  const p = new URLSearchParams(initData), hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const enc = new TextEncoder(), check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const exp = [...(await hmac(await hmac(enc.encode("WebAppData"), enc.encode(botToken)), enc.encode(check)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (exp !== hash) return null;
  const ad = Number(p.get("auth_date"));
  if (!ad || now / 1000 - ad > AUTH_MAX_AGE) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}
async function webhookSecret(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hook:${t}`)); return [...new Uint8Array(d)].slice(0, 24).map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ---- игрок ----
async function player(env, u, now = Date.now()) {
  const name = String([u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Игрок").slice(0, 40);
  const uname = u.username ? String(u.username).toLowerCase() : null;
  await env.DB.prepare("INSERT INTO players (id, name, username, created, coins) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = COALESCE(excluded.username, players.username)").bind(u.id, name, uname, now, START_COINS).run();
  const p = await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(u.id).first();
  const patch = {};
  if (p.coin_day !== day(now)) { patch.coin_day = day(now); patch.coins = (p.coins || 0) + DAILY_COINS; patch.free_spin = 1; }
  if (p.week !== week(now)) { patch.week = week(now); patch.week_best = 0; }
  if (Object.keys(patch).length) {
    const ks = Object.keys(patch);
    await env.DB.prepare(`UPDATE players SET ${ks.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...ks.map((k) => patch[k]), u.id).run();
    Object.assign(p, patch, { daily: !!patch.coin_day });
  }
  return p;
}
const themesOf = (p) => { try { const t = JSON.parse(p.skins || "[]").filter((x) => THEMES.includes(x)); return t.includes("classic") ? t : ["classic", ...t]; } catch { return ["classic"]; } };
const view = (p) => ({ coins: p.coins || 0, best: p.best || 0, weekBest: p.week_best || 0, freeSpin: !!p.free_spin, daily: !!p.daily, dailyCoins: DAILY_COINS,
  themes: themesOf(p), theme: THEMES.includes(p.skin) ? p.skin : "classic", stakes: STAKES, mines: MINES, wheel: WHEEL,
  shop: Object.entries(SHOP).map(([id, s]) => ({ id, ...s })), coinShop: Object.entries(COIN_SHOP).map(([id, c]) => ({ id, ...c })) });
const fresh = async (env, id) => view(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(id).first());
async function addWin(env, id, win) { await env.DB.prepare("UPDATE players SET best = MAX(best, ?), week_best = MAX(week_best, ?) WHERE id = ?").bind(win, win, id).run(); }

// ---- «Мины» ----
function comb(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (k - i); return r; }
export const minesMult = (m, k) => (k <= 0 ? 1 : Math.floor(EDGE * comb(25, k) / comb(25 - m, k) * 100) / 100);
export function placeMines(m, rand = Math.random) { const a = [...Array(25).keys()]; for (let i = 24; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, m).sort((x, y) => x - y); }
// Везение: выше 50% мина иногда «переезжает» в другую закрытую клетку, ниже 50% — мина переезжает сюда.
export function applyLuck(mines, opened, cell, luck, rand = Math.random) {
  if (luck == null || luck === 50) return mines;
  const isMine = mines.includes(cell), free = [...Array(25).keys()].filter((c) => c !== cell && !opened.includes(c) && !mines.includes(c));
  if (isMine && luck > 50 && free.length && rand() < (luck - 50) / 50) return mines.map((x) => (x === cell ? free[Math.floor(rand() * free.length)] : x)).sort((a, b) => a - b);
  if (!isMine && luck < 50 && rand() < (50 - luck) / 50) { const mv = mines.filter((x) => !opened.includes(x)); if (mv.length) { const out = mv[Math.floor(rand() * mv.length)]; return mines.map((x) => (x === out ? cell : x)).sort((a, b) => a - b); } }
  return mines;
}


// ---- быстрые игры на удачу: монетка, кубик, сундуки; и «Ракетка» (краш) ----
// Везение L (0–100): 50 — честный шанс p; 100 — всегда выигрыш; 0 — всегда проигрыш.
export const luckP = (p, L) => (L == null || L === 50 ? p : L > 50 ? p + (1 - p) * (L - 50) / 50 : p * L / 50);
const m2 = (x) => Math.floor(x * 100) / 100;
export const COIN_MULT = 1.94, CHEST_MULT = 2.91;
export const diceMult = (target) => m2(EDGE * 100 / (target - 1));   // выигрыш, если выпало меньше target (1–100)
export function quickPlay(game, params, L, rand = Math.random) {
  if (game === "coin") {
    const side = params.side === "tails" ? "tails" : "heads", win = rand() < luckP(0.5, L);
    return { win, mult: COIN_MULT, result: win ? side : side === "heads" ? "tails" : "heads" };
  }
  if (game === "dice") {
    const target = Math.round(Number(params.target));
    if (!(target >= 3 && target <= 96)) return null;
    const win = rand() < luckP((target - 1) / 100, L);
    const roll = win ? 1 + Math.floor(rand() * (target - 1)) : target + Math.floor(rand() * (101 - target));
    return { win, mult: diceMult(target), result: roll };
  }
  if (game === "chest") {
    const pick = Number(params.pick);
    if (![0, 1, 2].includes(pick)) return null;
    const win = rand() < luckP(1 / 3, L), others = [0, 1, 2].filter((x) => x !== pick);
    return { win, mult: CHEST_MULT, result: win ? pick : others[Math.floor(rand() * 2)] };
  }
  return null;
}
// «Ракетка»: точка взрыва выбирается при старте; P(взрыв не раньше x) = 0.97 / x. Множитель растёт как e^(0.08·сек).
export const CRASH_K = 0.08;
export const crashAt = (ms) => m2(Math.exp(CRASH_K * ms / 1000));
export function crashPoint(L, rand = Math.random) {
  let u = rand();
  if (L != null && L !== 50) u = L > 50 ? u + (1 - u) * (L - 50) / 50 : u * L / 50;
  if (u >= 0.999) return 1000;
  return Math.max(1, m2(EDGE / (1 - u)));
}

async function apiRoute(path, body, env, now = Date.now()) {
  const u = await telegramUser(body.initData, await token(env), now);
  if (!u) return json(401, { error: "Откройте игру внутри Telegram" });
  const p = await player(env, u, now);
  const game = async () => env.DB.prepare("SELECT * FROM mines_games WHERE user_id = ? AND status = 'play' ORDER BY created DESC LIMIT 1").bind(u.id).first();
  const gview = (g, opened) => ({ id: g.id, stake: g.stake, m: g.m, opened, mult: minesMult(g.m, opened.length), next: minesMult(g.m, opened.length + 1) });

  if (path === "me") { const g = await game(); return json(200, { ...view(p), game: g ? gview(g, JSON.parse(g.opened)) : null }); }

  if (path === "mines/start") {
    const stake = Number(body.stake), m = Number(body.mines);
    if (!STAKES.includes(stake) || !MINES.includes(m)) return json(400, { error: "Выберите ставку и число мин" });
    if (await game()) return json(400, { error: "Сначала закончите текущую игру" });
    if ((p.coins || 0) < stake) return json(403, { error: `Нужно ${stake} монет` });
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE players SET coins = coins - ? WHERE id = ?").bind(stake, u.id),
      env.DB.prepare("INSERT INTO mines_games (id, user_id, stake, m, mines, opened, status, created) VALUES (?, ?, ?, ?, ?, '[]', 'play', ?)").bind(id, u.id, stake, m, JSON.stringify(placeMines(m)), now),
    ]);
    return json(200, { ...(await fresh(env, u.id)), game: { id, stake, m, opened: [], mult: 1, next: minesMult(m, 1) } });
  }

  if (path === "mines/open") {
    const g = await game(), cell = Number(body.cell);
    if (!g || g.id !== body.gameId) return json(400, { error: "Игра не найдена" });
    const opened = JSON.parse(g.opened);
    if (!(Number.isInteger(cell) && cell >= 0 && cell < 25) || opened.includes(cell)) return json(400, { error: "Эта клетка уже открыта" });
    const mines = applyLuck(JSON.parse(g.mines), opened, cell, p.luck);
    if (mines.includes(cell)) {
      await env.DB.prepare("UPDATE mines_games SET status = 'lost', mines = ? WHERE id = ?").bind(JSON.stringify(mines), g.id).run();
      return json(200, { ...(await fresh(env, u.id)), boom: true, cell, mines, lost: g.stake, game: null });
    }
    opened.push(cell);
    const mult = minesMult(g.m, opened.length);
    if (opened.length === 25 - g.m) { // все безопасные клетки открыты — выигрыш забирается сам
      const win = Math.floor(g.stake * mult);
      await env.DB.batch([env.DB.prepare("UPDATE mines_games SET status = 'won', opened = ?, mines = ? WHERE id = ?").bind(JSON.stringify(opened), JSON.stringify(mines), g.id), env.DB.prepare("UPDATE players SET coins = coins + ? WHERE id = ?").bind(win, u.id)]);
      await addWin(env, u.id, win - g.stake);
      return json(200, { ...(await fresh(env, u.id)), cell, mines, win, mult, game: null });
    }
    await env.DB.prepare("UPDATE mines_games SET opened = ?, mines = ? WHERE id = ?").bind(JSON.stringify(opened), JSON.stringify(mines), g.id).run();
    return json(200, { cell, safe: true, game: gview(g, opened) });
  }

  if (path === "mines/cash") {
    const g = await game();
    if (!g || g.id !== body.gameId) return json(400, { error: "Игра не найдена" });
    const opened = JSON.parse(g.opened);
    if (!opened.length) return json(400, { error: "Откройте хотя бы одну клетку" });
    const mult = minesMult(g.m, opened.length), win = Math.floor(g.stake * mult);
    await env.DB.batch([env.DB.prepare("UPDATE mines_games SET status = 'won' WHERE id = ?").bind(g.id), env.DB.prepare("UPDATE players SET coins = coins + ? WHERE id = ?").bind(win, u.id)]);
    await addWin(env, u.id, win - g.stake);
    return json(200, { ...(await fresh(env, u.id)), win, mult, mines: JSON.parse(g.mines), game: null });
  }

  // ---- колесо 50/50 ----
  if (path === "spin") {
    const free = !!p.free_spin && !body.paid, stake = free ? STAKES[0] : Number(body.stake);
    if (!STAKES.includes(stake)) return json(400, { error: "Выберите ставку" });
    if (!free && (p.coins || 0) < stake) return json(403, { error: `Нужно ${stake} монет` });
    const r = spinPick(Math.random(), Math.random(), p.luck ?? 50), delta = free ? (r.win ? stake : 0) : (r.win ? stake : -stake);
    await env.DB.prepare(`UPDATE players SET coins = MAX(0, coins + ?)${free ? ", free_spin = 0" : ""} WHERE id = ?`).bind(delta, u.id).run();
    if (r.win) await addWin(env, u.id, stake);
    return json(200, { ...(await fresh(env, u.id)), win: r.win, delta, stake, free, index: r.index });
  }

  if (path === "play") {
    const stake = Number(body.stake), r = STAKES.includes(stake) ? quickPlay(String(body.game), body.params || {}, p.luck) : null;
    if (!r) return json(400, { error: "Выберите ставку и вариант" });
    if ((p.coins || 0) < stake) return json(403, { error: `Нужно ${stake} монет` });
    const win = r.win ? Math.floor(stake * r.mult) : 0;
    await env.DB.prepare("UPDATE players SET coins = coins - ? + ? WHERE id = ?").bind(stake, win, u.id).run();
    if (win) await addWin(env, u.id, win - stake);
    return json(200, { ...(await fresh(env, u.id)), ...r, win, stake });
  }
  if (path === "crash/start") {
    const stake = Number(body.stake);
    if (!STAKES.includes(stake)) return json(400, { error: "Выберите ставку" });
    if (await env.DB.prepare("SELECT id FROM crash_games WHERE user_id = ? AND status = 'fly'").bind(u.id).first()) await env.DB.prepare("UPDATE crash_games SET status = 'lost' WHERE user_id = ? AND status = 'fly'").bind(u.id).run();
    if ((p.coins || 0) < stake) return json(403, { error: `Нужно ${stake} монет` });
    const id = crypto.randomUUID();
    await env.DB.batch([env.DB.prepare("UPDATE players SET coins = coins - ? WHERE id = ?").bind(stake, u.id), env.DB.prepare("INSERT INTO crash_games (id, user_id, stake, crash, start, status) VALUES (?, ?, ?, ?, ?, 'fly')").bind(id, u.id, stake, crashPoint(p.luck), now)]);
    return json(200, { ...(await fresh(env, u.id)), id, k: CRASH_K });
  }
  if (path === "crash/tick" || path === "crash/cash") {
    const g = await env.DB.prepare("SELECT * FROM crash_games WHERE id = ? AND user_id = ?").bind(String(body.id || ""), u.id).first();
    if (!g) return json(400, { error: "Полёт не найден" });
    const cur = crashAt(now - g.start);
    if (g.status !== "fly" || cur >= g.crash) {
      if (g.status === "fly") await env.DB.prepare("UPDATE crash_games SET status = 'lost' WHERE id = ?").bind(g.id).run();
      return json(200, { ...(await fresh(env, u.id)), crashed: true, crash: g.crash, status: g.status === "won" ? "won" : "lost" });
    }
    if (path === "crash/tick") return json(200, { flying: true, mult: cur });
    const win = Math.floor(g.stake * cur);
    const upd = await env.DB.prepare("UPDATE crash_games SET status = 'won' WHERE id = ? AND status = 'fly'").bind(g.id).run();
    if (!upd.meta?.changes) return json(400, { error: "Уже забрано" });
    await env.DB.prepare("UPDATE players SET coins = coins + ? WHERE id = ?").bind(win, u.id).run();
    await addWin(env, u.id, win - g.stake);
    return json(200, { ...(await fresh(env, u.id)), win, mult: cur, crash: g.crash });
  }

  if (path === "theme") {
    const t = String(body.theme || "");
    if (!themesOf(p).includes(t)) return json(403, { error: "Это оформление ещё не открыто" });
    await env.DB.prepare("UPDATE players SET skin = ? WHERE id = ?").bind(t, u.id).run();
    return json(200, { ok: true });
  }
  if (path === "coinbuy") {
    const it = COIN_SHOP[body.item];
    if (!it) return json(400, { error: "Нет такого товара" });
    if (themesOf(p).includes(it.theme)) return json(400, { error: "Уже ваше" });
    if ((p.coins || 0) < it.coins) return json(403, { error: `Нужно ${it.coins} монет` });
    await env.DB.prepare("UPDATE players SET coins = coins - ?, skins = ?, skin = ? WHERE id = ?").bind(it.coins, JSON.stringify([...themesOf(p), it.theme]), it.theme, u.id).run();
    return json(200, await fresh(env, u.id));
  }
  if (path === "buy") {
    const it = SHOP[body.item];
    if (!it) return json(400, { error: "Нет такого товара" });
    if (themesOf(p).includes(it.theme)) return json(400, { error: "Уже ваше" });
    const r = await tg(env, "createInvoiceLink", { title: it.title, description: "Оформление игрового поля в StarRace. На выигрыш не влияет.", payload: `${body.item}:${u.id}`, currency: "XTR", prices: [{ label: it.title, amount: it.stars }] });
    return r.ok ? json(200, { link: r.result }) : json(502, { error: "Оплата временно недоступна" });
  }
  if (path === "top") {
    const rows = (await env.DB.prepare("SELECT id, name, week_best FROM players WHERE week = ? AND week_best > 0 ORDER BY week_best DESC LIMIT 30").bind(week(now)).all()).results || [];
    return json(200, { top: rows.map((r) => ({ name: r.name, score: r.week_best, me: r.id === u.id })) });
  }
  return json(404, { error: "Not found" });
}

export function spinPick(rand = Math.random(), rand2 = Math.random(), chance = 50) {
  const win = rand < chance / 100, idx = WHEEL.map((x, i) => i).filter((i) => (WHEEL[i] === "×2") === win);
  return { win, index: idx[Math.min(idx.length - 1, Math.floor(rand2 * idx.length))] };
}

// ---- «Везение» для админов: /luck ----
const isAdmin = (env, id) => String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(String(id));
export async function luckCommand(env, m) {
  const say = (text) => tg(env, "sendMessage", { chat_id: m.chat.id, text });
  if (!isAdmin(env, m.from.id)) return say("Эта команда только для администратора.");
  const [, who, val] = m.text.trim().split(/\s+/);
  if (!who) {
    const rows = (await env.DB.prepare("SELECT id, name, username, luck FROM players WHERE luck IS NOT NULL ORDER BY luck DESC LIMIT 50").all()).results || [];
    return say(rows.length ? "🍀 Везение (во всех играх):\n" + rows.map((r) => `${r.name}${r.username ? " @" + r.username : ""} (${r.id}) — ${r.luck}%`).join("\n") + "\n\nИзменить: /luck @ник 80 · /luck me 70 · /luck @ник reset" : "Везение ни у кого не изменено, у всех 50%.\n\nПример: /luck me 70 или /luck @ник 80");
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
  return say(`🍀 ${p.name}: везение ${n}% (во всех играх).`);
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
    if (!ins.meta?.changes) return;
    const p = await player(env, m.from);
    const t = themesOf(p); if (!t.includes(it.theme)) t.push(it.theme);
    await env.DB.prepare("UPDATE players SET skins = ?, skin = ? WHERE id = ?").bind(JSON.stringify(t), it.theme, m.from.id).run();
    return tg(env, "sendMessage", { chat_id: m.chat.id, text: `⭐ Спасибо! ${it.title} уже в игре.` });
  }
  if (m.text?.startsWith("/luck")) return luckCommand(env, m);
  if (m.text?.startsWith("/paysupport")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Вопросы по оплате звёздами: напишите сюда, что купили и когда. Ответим в течение дня." });
  if (m.text?.startsWith("/terms")) return tg(env, "sendMessage", { chat_id: m.chat.id, text: "Играем только на игровые монеты: их дают каждый день, купить или вывести их нельзя. Звёзды тратятся только на оформление." });
  return tg(env, "sendMessage", { chat_id: m.chat.id, text: "💎 StarRace — Мины, Ракетка, Монетка, Кубик, Сундуки и колесо 50/50 на игровые монеты.\n\n500 монет на старт и 100 каждый день, рейтинг недели.", reply_markup: { inline_keyboard: [[{ text: "🎮 Играть", web_app: { url: env.GAME_URL } }]] } });
}

const SETUP_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение бота</title>
<style>body{font:16px system-ui;background:#181c2e;color:#f2f3fa;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}form{display:grid;gap:12px;max-width:420px;width:100%}input,button{font:inherit;padding:14px;border-radius:12px;border:0}button{background:#5a6bff;color:#fff;font-weight:700}p{color:#8e96b8}</style>
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
      const call = (m, b) => fetch(`https://api.telegram.org/bot${t}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      await call("setWebhook", { url: `${url.origin}/telegram`, secret_token: await webhookSecret(t), allowed_updates: ["message", "pre_checkout_query"] });
      await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Играть", web_app: { url: env.GAME_URL } } });
      return new Response(`Готово! Бот @${me.result.username} подключён. Откройте его в Telegram и нажмите «Играть».`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (url.pathname === "/telegram") {
      const t = await token(env);
      if (!t || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(t))) return new Response("forbidden", { status: 403 });
      ctx.waitUntil(onUpdate(await request.json(), env));
      return new Response("ok");
    }
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      try { body = await request.json(); } catch {}
      return apiRoute(url.pathname.slice(5), body, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
export { apiRoute, onUpdate };
