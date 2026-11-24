// Сайт Javob на Cloudflare Workers.
// Полка «Настройки → Постоянные ссылки»: адреса без слэша на конце; /about/ → /about (301).
// Полка «Плагины → Карта сайта и robots»: строятся сами из content/pages.js.
import { brand } from "./brand.js";
import { pages } from "../content/pages.js";
import { redirects } from "./redirects.js";
import { renderDocument, render404 } from "./template.js";

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// Вопрос с сайта → сообщение владельцу в Telegram через бота Javob.
// Секреты Worker: BOT_TOKEN (тот же бот) и OWNER_CHAT_ID (чат владельца, узнать командой /myid у бота).
async function handleAsk(request, env) {
  let d;
  try { d = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
  const clip = (v, n) => String(v ?? "").trim().slice(0, n);
  const name = clip(d.name, 80), contact = clip(d.contact, 80), question = clip(d.question, 1500);
  if (d.site) return new Response("ok"); // ловушка для спам-ботов: молча принимаем и не пересылаем
  if (!contact || !question) return new Response("contact and question required", { status: 400 });
  if (!env.BOT_TOKEN || !env.OWNER_CHAT_ID) return new Response("not configured", { status: 503 });
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.OWNER_CHAT_ID, text: `❓ Вопрос с сайта Javob\nИмя: ${name || "—"}\nКонтакт: ${contact}\n\n${question}` }),
  });
  return r.ok ? new Response("ok") : new Response("send failed", { status: 502 });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === "/ask") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return handleAsk(request, env);
    }

    if (path.length > 1 && path.endsWith("/")) {
      return Response.redirect(url.origin + path.replace(/\/+$/, "") + url.search, 301);
    }
    if (redirects[path]) return Response.redirect(url.origin + redirects[path], 301);

    if (path === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${brand.siteUrl}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    }
    if (path === "/sitemap.xml") {
      const urls = pages.map((p) => `<url><loc>${brand.siteUrl}${p.path === "/" ? "/" : p.path}</loc></url>`).join("");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
        headers: { "content-type": "application/xml" },
      });
    }

    const page = pages.find((p) => p.path === path);
    if (!page) return html(render404(), 404);
    return html(renderDocument(page, { canonical: brand.siteUrl + (path === "/" ? "/" : path) }));
  },
};
