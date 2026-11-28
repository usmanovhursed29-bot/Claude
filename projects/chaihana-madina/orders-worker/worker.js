// Приём заказов с сайта «Чайхана Мадина» и отправка их в Telegram владельцу.
// Токен бота хранится в KV (вводится на /setup), чат владельца определяется по /start.
const esc = (s) => String(s == null ? "" : s).replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const cors = (env) => ({ "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
const json = (env, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(env) } });

async function tg(env, method, payload) {
  const token = await env.KV.get("bot_token");
  if (!token) return { ok: false, error: "no token" };
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json();
}

function orderText(o) {
  const lines = (o.items || []).map((x) => `• ${esc(x.n)} × ${x.q} = ${x.p * x.q} ₽`).join("\n");
  const how = o.type === "delivery" ? `🚗 Доставка: ${esc(o.addr)}` : "🚶 Навынос (самовывоз)";
  return `🆕 <b>Новый заказ — Чайхана Мадина</b>\n\n${lines}\n\n<b>Итого: ${o.total} ₽</b>\n${how}\n💳 Оплата: ${esc(o.pay)}\n\n👤 ${esc(o.name)}\n📞 ${esc(o.phone)}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });

    // Приём заказа с сайта
    if (path === "/order" && request.method === "POST") {
      let o;
      try { o = await request.json(); } catch { return json(env, { error: "bad json" }, 400); }
      if (!o || !Array.isArray(o.items) || !o.items.length || !o.name || !o.phone) return json(env, { error: "empty" }, 400);
      const chat = await env.KV.get("order_chat");
      if (!chat) return json(env, { error: "bot not set up" }, 503);
      const res = await tg(env, "sendMessage", { chat_id: chat, text: orderText(o), parse_mode: "HTML" });
      if (!res.ok) return json(env, { error: "send failed" }, 502);
      return json(env, { ok: true });
    }

    // Вебхук Telegram: владелец пишет /start — запоминаем его чат как получателя заказов
    if (path === "/telegram" && request.method === "POST") {
      const u = await request.json().catch(() => null);
      const m = u?.message;
      if (m?.text && /^\/start/.test(m.text)) {
        await env.KV.put("order_chat", String(m.chat.id));
        await tg(env, "sendMessage", { chat_id: m.chat.id, text: "✅ Готово! Сюда будут приходить заказы с сайта «Чайхана Мадина».\n\nКогда придёт заказ — перезвоните клиенту по указанному номеру и подтвердите." });
      }
      return new Response("ok");
    }

    // Страница настройки: вставить токен бота (один раз)
    if (path === "/setup") {
      if (url.searchParams.get("key") !== env.SETUP_KEY) return new Response("Неверный ключ", { status: 403 });
      if (request.method === "POST") {
        const form = await request.formData();
        const token = String(form.get("token") || "").trim();
        if (!/^\d{6,}:[\w-]{20,}$/.test(token)) return new Response(page("❌ Токен выглядит неверно. Формат: 1234567890:AA...", true), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        await env.KV.put("bot_token", token);
        const wh = await tg(env, "setWebhook", { url: `${url.origin}/telegram`, allowed_updates: ["message"] });
        const me = await tg(env, "getMe", {});
        const uname = me?.result?.username;
        return new Response(page(`✅ Токен сохранён${wh.ok ? ", вебхук подключён" : ""}.<br><br><b>Последний шаг:</b> откройте бота <a href="https://t.me/${uname}">@${uname}</a> и нажмите <b>Start</b> — тогда заказы начнут приходить вам.`, false, uname), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (path === "/") return new Response("Madina orders worker", { status: 200 });
    return new Response("Not found", { status: 404 });
  },
};

function page(msg, err, uname) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Настройка бота — Мадина</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6efe2;color:#241f19;margin:0;padding:24px;line-height:1.5}
.c{max-width:460px;margin:0 auto;background:#fff;border:1px solid #e7ddc8;border-radius:16px;padding:22px}
h1{font-size:20px;margin:0 0 4px}.m{font-size:13px;color:#6a6155;margin:0 0 16px}
input{width:100%;box-sizing:border-box;border:1px solid #e7ddc8;border-radius:11px;padding:12px;font-size:15px;margin:8px 0}
button{width:100%;background:#1f3d2b;color:#fff;border:0;border-radius:12px;padding:13px;font-size:16px;font-weight:700;cursor:pointer}
.ok{background:#e7f2e9;border:1px solid #bcdcc4;border-radius:11px;padding:12px;font-size:14px;margin-bottom:14px}
.err{background:#fde8e4;border:1px solid #f0b6ab;border-radius:11px;padding:12px;font-size:14px;margin-bottom:14px}
ol{font-size:13px;color:#6a6155;padding-left:18px}a{color:#1f3d2b}</style></head>
<body><div class="c"><h1>🫖 Настройка заказов</h1><p class="m">Чайхана Мадина — Telegram-бот для заказов</p>
${msg ? `<div class="${err ? "err" : "ok"}">${msg}</div>` : ""}
${uname ? "" : `<ol>
<li>В Telegram откройте <a href="https://t.me/BotFather">@BotFather</a>, отправьте <b>/newbot</b>, придумайте имя и адрес бота.</li>
<li>BotFather пришлёт <b>токен</b> вида <code>1234567890:AA...</code> — скопируйте его.</li>
<li>Вставьте токен ниже и нажмите «Сохранить».</li>
</ol>
<form method="POST"><input name="token" placeholder="Токен бота от BotFather" autocomplete="off" required><button>Сохранить</button></form>`}
</div></body></html>`;
}
