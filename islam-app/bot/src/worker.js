// Исламский Telegram-бот + Mini App. Cloudflare Workers + D1 (данные) + R2 (ежедневная резервная копия).
// Секреты Worker (в коде их нет):
//   BOT_TOKEN       — токен бота от @BotFather
//   WEBHOOK_SECRET  — случайная строка, Telegram присылает её в заголовке
//   ADMIN_CHAT_IDS  — через запятую: кто видит /stats (номер чата узнаётся командой /myid)
// Привязки: DB (D1), BACKUP (R2, необязательно).
import { timesText, qiblaText, timezoneFor, METHODS } from "./prayer.js";
import { t, langFor, LANGS } from "./i18n.js";
import APP_BODY from "./app-body.js"; // собирается из ../app/index.html командой npm run build:app

const ZIKR_AR = { subhan: "سُبْحَانَ اللَّهِ", hamd: "الْحَمْدُ لِلَّهِ", akbar: "اللَّهُ أَكْبَرُ", tahlil: "لَا إِلَٰهَ إِلَّا اللَّهُ", istighfar: "أَسْتَغْفِرُ اللَّهَ" };
const ZIKR_GOAL = { subhan: 33, hamd: 33, akbar: 33, tahlil: 100, istighfar: 100 };

const mainKb = (L, appUrl) => ({
  keyboard: [
    ...(appUrl ? [[{ text: L.btnApp, web_app: { url: appUrl } }]] : []),
    [{ text: L.btnTimes }, { text: L.btnQibla }],
    [{ text: L.btnZikr }, { text: L.btnQuran }],
    [{ text: L.btnAyah }, { text: L.btnHalal }],
    [{ text: L.btnLocation, request_location: true }, { text: L.btnSettings }],
  ],
  resize_keyboard: true,
});

const nowIso = () => new Date().toISOString();

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ---- пользователи и события ----
async function touchUser(env, from, chatId) {
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (chat_id, first_name, lang, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET last_seen = excluded.last_seen, first_name = excluded.first_name`
  ).bind(chatId, from?.first_name || null, langFor(from?.language_code), ts, ts).run();
  return env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
}
const logEvent = (env, chatId, type) => env.DB.prepare("INSERT INTO events (chat_id, type, ts) VALUES (?, ?, ?)").bind(chatId, type, nowIso()).run();

// ---- зикр ----
const zikrMenu = (L) => ({ inline_keyboard: Object.keys(ZIKR_AR).map((k) => [{ text: `${L.zikrs[k][0]} — ${L.zikrs[k][1]}`, callback_data: `z:open:${k}` }]) });
function zikrView(L, k, row) {
  const s = row?.session || 0, goal = ZIKR_GOAL[k];
  return {
    text: `📿 <b>${L.zikrs[k][0]}</b>\n${ZIKR_AR[k]}\n<i>${L.zikrs[k][1]}</i>\n\n${L.zikrNow}: <b>${s}</b> / ${goal}${s >= goal ? " ✅" : ""}\n${L.zikrTotal}: ${row?.total || 0}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: L.zikrTap, callback_data: `z:inc:${k}` }],
        [{ text: L.zikrReset, callback_data: `z:reset:${k}` }, { text: L.zikrBack, callback_data: "z:menu" }],
      ],
    },
  };
}

// ---- статистика для администратора ----
export async function statsText(env) {
  const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const D = 86400000;
  const total = (await one("SELECT COUNT(*) c FROM users")).c;
  const withLoc = (await one("SELECT COUNT(*) c FROM users WHERE lat IS NOT NULL")).c;
  const newToday = (await one("SELECT COUNT(*) c FROM users WHERE first_seen >= ?", since(D))).c;
  const dau = (await one("SELECT COUNT(DISTINCT chat_id) c FROM events WHERE ts >= ?", since(D))).c;
  const wau = (await one("SELECT COUNT(DISTINCT chat_id) c FROM events WHERE ts >= ?", since(7 * D))).c;
  const mau = (await one("SELECT COUNT(DISTINCT chat_id) c FROM events WHERE ts >= ?", since(30 * D))).c;
  const ev7 = (await one("SELECT COUNT(*) c FROM events WHERE ts >= ?", since(7 * D))).c;
  const top = await env.DB.prepare("SELECT type, COUNT(*) c FROM events WHERE ts >= ? GROUP BY type ORDER BY c DESC LIMIT 10").bind(since(7 * D)).all();
  const langs = await env.DB.prepare("SELECT lang, COUNT(*) c FROM users GROUP BY lang ORDER BY c DESC").all();
  return [
    "📊 <b>Статистика</b>",
    "",
    `Всего пользователей: <b>${total}</b> (с местоположением: ${withLoc})`,
    `Новых за сутки: <b>${newToday}</b>`,
    `Активных за сутки: <b>${dau}</b>`,
    `Активных за 7 дней: <b>${wau}</b>`,
    `Активных за 30 дней: <b>${mau}</b>`,
    `Действий на активного за 7 дней: <b>${wau ? (ev7 / wau).toFixed(1) : "0"}</b>`,
    `Языки: ${(langs.results || []).map((r) => `${r.lang || "?"} ${r.c}`).join(", ")}`,
    "",
    "<b>Чем пользуются (7 дней)</b>",
    ...(top.results || []).map((r) => `• ${r.type}: ${r.c}`),
  ].join("\n");
}
const isAdmin = (env, chatId) => String(env.ADMIN_CHAT_IDS || "").split(",").map((s) => s.trim()).includes(String(chatId));

// ---- сообщения ----
export async function handleUpdate(env, update, appUrl) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const user = await touchUser(env, msg.from, chatId);
  const L = t(user.lang);
  const send = (text, extra = {}) => tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: mainKb(L, appUrl), ...extra });
  const text = (msg.text || "").trim();

  if (msg.location) {
    const { latitude: lat, longitude: lon } = msg.location;
    const tz = timezoneFor(lat, lon);
    await env.DB.prepare("UPDATE users SET lat = ?, lon = ?, tz = ? WHERE chat_id = ?").bind(lat, lon, tz, chatId).run();
    await logEvent(env, chatId, "location");
    return send(timesText({ ...user, lat, lon, tz }));
  }
  if (text === "/myid") return send(`${L.chatId} <code>${chatId}</code>`);
  if (text === "/stats") return send(isAdmin(env, chatId) ? await statsText(env) : L.adminOnly);
  if (text.startsWith("/start")) { await logEvent(env, chatId, "start"); return send(L.hello); }

  const needLoc = () => send(L.needLocation);
  if (matches(text, "btnTimes") || text === "/times") { await logEvent(env, chatId, "times"); return user.lat == null ? needLoc() : send(timesText(user)); }
  if (matches(text, "btnQibla") || text === "/qibla") { await logEvent(env, chatId, "qibla"); return user.lat == null ? needLoc() : send(qiblaText(user)); }
  if (matches(text, "btnZikr") || text === "/zikr") { await logEvent(env, chatId, "zikr_menu"); return send(L.zikrPick, { reply_markup: zikrMenu(L) }); }
  if (matches(text, "btnSettings") || text === "/settings") { await logEvent(env, chatId, "settings"); return send(settingsText(L, user), { reply_markup: settingsKb(L, user) }); }
  for (const [k, ev] of [["btnQuran", "quran_soon"], ["btnAyah", "ayah_soon"], ["btnHalal", "halal_soon"]]) {
    if (matches(text, k)) { await logEvent(env, chatId, ev); return send(L.soon); }
  }
  await logEvent(env, chatId, "other");
  return send(L.pickSection);
}
// Кнопка может прийти на любом языке (пользователь сменил язык, а старая клавиатура осталась).
const matches = (text, key) => Object.keys(LANGS).some((l) => t(l)[key] === text);

const settingsText = (L, u) =>
  `${L.settingsTitle}\n\n${L.setMethod}: ${L.methods[u.method] || L.methods.mwl}\n${L.setAsr}: ${u.madhab === "shafi" ? L.shafi : L.hanafi}\n${L.setLang}: ${LANGS[u.lang] || LANGS.ru}\n\n${L.settingsHint}`;
const settingsKb = (L, u) => ({
  inline_keyboard: [
    Object.entries(LANGS).map(([k, n]) => ({ text: `${u.lang === k ? "✅ " : ""}${n}`, callback_data: `s:lang:${k}` })),
    ...Object.keys(METHODS).map((k) => [{ text: `${u.method === k ? "✅ " : ""}${L.methods[k]}`, callback_data: `s:method:${k}` }]),
    [
      { text: `${u.madhab !== "shafi" ? "✅ " : ""}${L.asrH}`, callback_data: "s:madhab:hanafi" },
      { text: `${u.madhab === "shafi" ? "✅ " : ""}${L.asrS}`, callback_data: "s:madhab:shafi" },
    ],
  ],
});

async function handleCallback(env, q) {
  const chatId = q.message.chat.id;
  const user = await touchUser(env, q.from, chatId);
  let L = t(user.lang);
  const [kind, action, key] = String(q.data || "").split(":");
  const edit = (view) => tg(env, "editMessageText", { chat_id: chatId, message_id: q.message.message_id, parse_mode: "HTML", ...view });
  const answer = (text) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });

  if (kind === "z") {
    if (action === "menu") { await answer(); return edit({ text: L.zikrPick, reply_markup: zikrMenu(L) }); }
    if (!ZIKR_AR[key]) return answer();
    if (action === "inc") {
      await env.DB.prepare(
        `INSERT INTO zikr (chat_id, zikr, session, total) VALUES (?, ?, 1, 1)
         ON CONFLICT(chat_id, zikr) DO UPDATE SET session = session + 1, total = total + 1`
      ).bind(chatId, key).run();
      await logEvent(env, chatId, "zikr");
    } else if (action === "reset") {
      await env.DB.prepare("UPDATE zikr SET session = 0 WHERE chat_id = ? AND zikr = ?").bind(chatId, key).run();
    } else await logEvent(env, chatId, "zikr_open");
    const row = await env.DB.prepare("SELECT session, total FROM zikr WHERE chat_id = ? AND zikr = ?").bind(chatId, key).first();
    await answer(action === "inc" && row.session === ZIKR_GOAL[key] ? L.zikrDone : null);
    return edit(zikrView(L, key, row));
  }

  if (kind === "s") {
    if (action === "lang" && LANGS[key]) await env.DB.prepare("UPDATE users SET lang = ? WHERE chat_id = ?").bind(key, chatId).run();
    if (action === "method" && METHODS[key]) await env.DB.prepare("UPDATE users SET method = ? WHERE chat_id = ?").bind(key, chatId).run();
    if (action === "madhab" && (key === "hanafi" || key === "shafi")) await env.DB.prepare("UPDATE users SET madhab = ? WHERE chat_id = ?").bind(key, chatId).run();
    await logEvent(env, chatId, "settings_change");
    const u = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first();
    L = t(u.lang);
    await answer(L.saved);
    if (action === "lang") await tg(env, "sendMessage", { chat_id: chatId, text: L.pickSection, reply_markup: mainKb(L, env.APP_URL) });
    return edit({ text: settingsText(L, u), reply_markup: settingsKb(L, u) });
  }
  return answer();
}

// ---- Mini App: проверка подписи Telegram и учёт посещений ----
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}
export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  const p = new URLSearchParams(initData || "");
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > maxAgeSec) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

const appDocument = () =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script></head><body style="margin:0">${APP_BODY}</body></html>`;

// ---- резервная копия: раз в сутки все таблицы в R2 (отдельное хранилище) ----
export async function backup(env) {
  if (!env.BACKUP) return null;
  const dump = {};
  for (const tb of ["users", "zikr", "events"]) dump[tb] = (await env.DB.prepare(`SELECT * FROM ${tb}`).all()).results;
  const key = `backup/${new Date().toISOString().slice(0, 10)}.json`;
  await env.BACKUP.put(key, JSON.stringify(dump));
  return key;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const appUrl = env.APP_URL || `${url.origin}/app`;
    const secretOk = (v) => env.WEBHOOK_SECRET && v === env.WEBHOOK_SECRET;
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!secretOk(request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) return new Response("forbidden", { status: 403 });
      await handleUpdate({ ...env, APP_URL: appUrl }, await request.json(), appUrl);
      return new Response("ok");
    }
    if (url.pathname === "/app") return new Response(appDocument(), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/api/event" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const u = await verifyInitData(body.initData, env.BOT_TOKEN);
      if (!u) return new Response("forbidden", { status: 403 });
      const type = String(body.type || "app").replace(/[^a-z_]/g, "").slice(0, 32) || "app";
      await touchUser(env, u, u.id);
      await logEvent(env, u.id, type);
      return new Response("ok");
    }
    if (url.pathname === "/setup") {
      if (!secretOk(url.searchParams.get("key"))) return new Response("forbidden", { status: 403 });
      const res = await tg(env, "setWebhook", { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] });
      await tg(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "Открыть", web_app: { url: appUrl } } });
      return Response.json({ ok: res.ok, description: res.description });
    }
    return new Response("bot is running");
  },
  async scheduled(_event, env) {
    await backup(env);
  },
};
