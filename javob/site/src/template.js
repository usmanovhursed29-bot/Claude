// Полка «Внешний вид → Тема и меню»: ОДИН шаблон на все страницы.
// Бренд и заголовки берутся только из brand.js, тексты только из content/pages.js.
import { brand } from "./brand.js";
import { pages } from "../content/pages.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const FONTS =
  "https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&family=Unbounded:wght@500;700&display=swap";

export const STYLE = `
/* Макет: узкая колонка чтения; в шапке слева тезис, справа ночная переписка с агентом. */
:root {
  --bg: #f4f7f6; --surface: #ffffff; --fg: #0d1f1c; --muted: #4f625d; --line: #d9e3e0;
  --accent: #0f766e; --accent-ink: #ffffff; --guest: #e3ecea; --bot: #d3eeea;
  --display: "Unbounded", "Segoe UI", system-ui, sans-serif;
  --body: "Onest", "Segoe UI", system-ui, sans-serif;
  --gutter-l: max(16px, env(safe-area-inset-left, 0px));
  --gutter-r: max(16px, env(safe-area-inset-right, 0px));
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0b1513; --surface: #11201d; --fg: #e4efec; --muted: #94aaa4; --line: #213631;
  --accent: #35cdb4; --accent-ink: #042019; --guest: #18302b; --bot: #0f3d35; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0b1513; --surface: #11201d; --fg: #e4efec; --muted: #94aaa4; --line: #213631;
  --accent: #35cdb4; --accent-ink: #042019; --guest: #18302b; --bot: #0f3d35; color-scheme: dark; }

body { background: var(--bg); color: var(--fg); font: 400 17px/1.6 var(--body); }
.wrap { max-width: 1080px; margin: 0 auto; padding-left: var(--gutter-l); padding-right: var(--gutter-r); }
a { color: var(--accent); }
a:focus-visible, .btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
h1, h2, h3 { font-family: var(--display); line-height: 1.15; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(30px, 5vw, 50px); font-weight: 700; letter-spacing: -0.01em; }
h2 { font-size: clamp(22px, 3vw, 30px); font-weight: 700; }
h3 { font-size: 17px; font-weight: 500; }
p { margin: 0; }
.muted { color: var(--muted); }

.top { border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-block: 14px; }
.logo { font-family: var(--display); font-weight: 700; font-size: 20px; color: var(--fg); text-decoration: none; }
.logo span { color: var(--accent); }
.top nav { display: flex; gap: 18px; flex-wrap: wrap; font-size: 15px; }
.top nav a { color: var(--muted); text-decoration: none; }
.top nav a:hover { color: var(--fg); }

.hero .wrap { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center; padding-block: 56px 64px; }
.hero .text { display: grid; gap: 20px; min-width: 0; }
.eyebrow { font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.lead { font-size: 19px; color: var(--muted); max-width: 34em; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.btn { display: inline-block; padding: 12px 20px; border-radius: 10px; font-weight: 600; text-decoration: none; border: 1px solid var(--line); color: var(--fg); background: var(--surface); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }

.phone { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 16px; display: grid; gap: 10px; min-width: 0; box-shadow: 0 18px 40px -24px rgba(6, 40, 34, 0.35); }
.phone header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.phone header b { font-weight: 600; }
.phone header small { color: var(--muted); font-size: 12px; }
.msg { max-width: 85%; padding: 9px 12px 6px; border-radius: 14px; font-size: 15px; line-height: 1.45; }
.msg time { display: block; text-align: right; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; margin-top: 2px; }
.msg.guest { justify-self: end; background: var(--guest); border-bottom-right-radius: 4px; }
.msg.bot { justify-self: start; background: var(--bot); border-bottom-left-radius: 4px; }
.msg.bot::before { content: "бот"; display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }

section.block .wrap { display: grid; gap: 24px; padding-block: 48px; }
section.block + section.block .wrap { border-top: 1px solid var(--line); }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; counter-reset: step; list-style: none; padding: 0; margin: 0; }
.steps li { display: grid; gap: 8px; counter-increment: step; }
.steps li::before { content: counter(step); font-family: var(--display); font-size: 28px; font-weight: 700; color: var(--accent); }
.grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; }
.grid4 div { display: grid; gap: 6px; align-content: start; }
.tags { display: flex; flex-wrap: wrap; gap: 10px; list-style: none; padding: 0; margin: 0; }
.tags li { padding: 8px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 15px; }
.pilot { display: grid; gap: 8px; max-width: 40em; }
.pilot b { font-family: var(--display); font-weight: 500; }

.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.plan { display: grid; gap: 12px; align-content: start; padding: 22px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.plan.featured { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.plan .price { font-family: var(--display); font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.plan .price small { font-family: var(--body); font-size: 15px; font-weight: 400; color: var(--muted); }
.plan ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.rules { margin: 0; padding-left: 20px; display: grid; gap: 6px; max-width: 40em; }
.faq { display: grid; gap: 4px; max-width: 46em; }
.faq details { border-bottom: 1px solid var(--line); padding-block: 14px; }
.faq summary { cursor: pointer; font-weight: 600; }
.faq details p { margin-top: 8px; color: var(--muted); }
.contact { display: grid; gap: 12px; max-width: 40em; }
.textpage .wrap { display: grid; gap: 16px; padding-block: 48px; max-width: 760px; }

footer { border-top: 1px solid var(--line); }
footer .wrap { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-block: 24px; color: var(--muted); font-size: 14px; }
footer a { color: var(--muted); }

@media (max-width: 860px) {
  .hero .wrap { grid-template-columns: 1fr; padding-block: 36px 44px; gap: 32px; }
  .steps, .plans { grid-template-columns: 1fr; }
  .grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) { .grid4 { grid-template-columns: 1fr; } .top nav a:not(.keep) { display: none; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

const nav = () =>
  `<nav aria-label="Меню"><a href="/#how">Как работает</a><a class="keep" href="/#pricing">Тарифы</a><a href="/#faq">Вопросы</a><a class="keep" href="/#contact">Связаться</a></nav>`;

const header = () =>
  `<header class="top"><div class="wrap"><a class="logo" href="/">${esc(brand.name)}<span>.</span></a>${nav()}</div></header>`;

const footer = () => {
  const extra = pages.filter((p) => p.inMenu).map((p) => `<a href="${p.path}">${esc(p.title)}</a>`).join(" · ");
  return `<footer><div class="wrap"><span>© 2026 ${esc(brand.name)} — ${esc(brand.tagline)}</span><span>${extra}</span></div></footer>`;
};

function contactBlock() {
  const tg = brand.telegram
    ? `<p>Telegram: <a href="https://t.me/${esc(brand.telegram)}">@${esc(brand.telegram)}</a></p>`
    : `<p class="muted">Адрес в Telegram появится после запуска бота.</p>`;
  const mail = brand.email ? `<p>Почта: <span>${esc(brand.email)}</span></p>` : "";
  return `<section class="block" id="contact"><div class="wrap"><h2>Связаться</h2><div class="contact"><p>Напишите, чем занимается ваш бизнес и что чаще всего спрашивают клиенты. Покажем агента на ваших данных.</p>${tg}${mail}</div></div></section>`;
}

function landing(p) {
  const h = p.hero;
  const chat = h.chat
    .map((m) => `<div class="msg ${m.from}">${esc(m.text)}<time>${esc(m.time)}</time></div>`)
    .join("");
  return `
<section class="hero"><div class="wrap">
  <div class="text">
    <span class="eyebrow">${esc(h.eyebrow)}</span>
    <h1>${esc(h.title)}</h1>
    <p class="lead">${esc(h.lead)}</p>
    <div class="actions"><a class="btn primary" href="${h.primary.href}">${esc(h.primary.label)}</a><a class="btn" href="${h.secondary.href}">${esc(h.secondary.label)}</a></div>
  </div>
  <div class="phone" aria-label="Пример переписки"><header><b>${esc(h.chatName)}</b><small>${esc(h.chatNote)}</small></header>${chat}</div>
</div></section>
<section class="block" id="how"><div class="wrap"><h2>${esc(p.how.title)}</h2><ol class="steps">${p.how.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p class="muted">${esc(s.text)}</p></li>`).join("")}</ol></div></section>
<section class="block"><div class="wrap"><h2>${esc(p.features.title)}</h2><div class="grid4">${p.features.items.map((f) => `<div><h3>${esc(f.title)}</h3><p class="muted">${esc(f.text)}</p></div>`).join("")}</div></div></section>
<section class="block"><div class="wrap"><h2>${esc(p.audience.title)}</h2><ul class="tags">${p.audience.items.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div></section>
<section class="block"><div class="wrap"><h2>${esc(p.pilot.title)}</h2><div class="pilot"><b>${esc(p.pilot.name)}</b><p class="muted">${esc(p.pilot.text)}</p></div></div></section>
<section class="block" id="pricing"><div class="wrap"><h2>${esc(p.pricing.title)}</h2><p class="muted">${esc(p.pricing.note)}</p><div class="plans">${p.pricing.plans
    .map(
      (pl) => `<div class="plan${pl.featured ? " featured" : ""}"><h3>${esc(pl.name)}</h3><div class="price">${esc(pl.monthly)} <small>в месяц</small></div><p class="muted">Настройка: ${esc(pl.setup)}</p><ul>${pl.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
    )
    .join("")}</div></div></section>
<section class="block"><div class="wrap"><h2>${esc(p.principles.title)}</h2><ul class="rules">${p.principles.items.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div></section>
<section class="block" id="faq"><div class="wrap"><h2>${esc(p.faq.title)}</h2><div class="faq">${p.faq.items.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></div></section>
${contactBlock()}`;
}

const textPage = (p) =>
  `<section class="textpage"><div class="wrap"><h1>${esc(p.title)}</h1>${p.body.map((t) => `<p>${esc(t)}</p>`).join("")}</div></section>`;

// Возвращает части страницы; worker.js собирает из них полный документ.
export function renderParts(p) {
  const title = p.path === "/" ? `${brand.name} — ${brand.tagline}` : `${p.title} — ${brand.name}`;
  const main = p.type === "landing" ? landing(p) : textPage(p);
  return { title, description: p.description || brand.description, body: `${header()}<main>${main}</main>${footer()}` };
}

export function renderDocument(p, { canonical }) {
  const { title, description, body } = renderParts(p);
  const analytics = brand.analyticsToken
    ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${esc(brand.analyticsToken)}"}'></script>`
    : "";
  return `<!doctype html><html lang="${brand.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:site_name" content="${esc(brand.name)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="${FONTS}"><style>${STYLE}</style></head><body>${body}${analytics}</body></html>`;
}

export const render404 = () =>
  renderDocument({ path: "/404", title: "Страница не найдена", type: "text", body: ["Такой страницы нет. Перейдите на главную."] }, { canonical: brand.siteUrl + "/" });
