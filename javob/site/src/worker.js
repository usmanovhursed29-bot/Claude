// Сайт Javob на Cloudflare Workers.
// Полка «Настройки → Постоянные ссылки»: адреса без слэша на конце; /about/ → /about (301).
// Полка «Плагины → Карта сайта и robots»: строятся сами из content/pages.js.
import { brand } from "./brand.js";
import { pages } from "../content/pages.js";
import { redirects } from "./redirects.js";
import { renderDocument, render404 } from "./template.js";

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;

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
