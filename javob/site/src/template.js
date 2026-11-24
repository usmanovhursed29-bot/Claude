// Полка «Внешний вид → Тема и меню»: ОДИН шаблон на все страницы.
// Бренд и заголовки берутся только из brand.js, тексты только из content/pages.js.
import { brand } from "./brand.js";
import { pages } from "../content/pages.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const FONTS =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap";

export const STYLE = `
/* Макет: страница как файл в редакторе кода; шапка — сплошная индиговая полоса с шафрановым маркером. */
/* Палитра: ночной индиго, гранат и шафран — цвета базара и сюзане, а не стандартный «тех»-набор. */
:root {
  --bg: #ffffff; --surface: #f4f3fb; --fg: #16143f; --muted: #5d5b7a; --line: #e3e1f0;
  --kw: #d7263d; --str: #0b8a57; --fn: #3346d3; --num: #d7263d; --accent-ink: #ffffff;
  --band: #1d1a63; --band-fg: #f3f1ff; --band-muted: #b9b5ea; --mark: #ffb703; --mark-ink: #16143f;
  --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --gutter-l: max(16px, env(safe-area-inset-left, 0px));
  --gutter-r: max(16px, env(safe-area-inset-right, 0px));
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f0d2b; --surface: #1a1842; --fg: #edebff; --muted: #a6a3cc; --line: #2c2963;
  --kw: #ff5a6e; --str: #4fd39a; --fn: #8c9bff; --num: #ff5a6e; --accent-ink: #0f0d2b;
  --band: #26227a; --band-fg: #f3f1ff; --band-muted: #c3bff0; --mark: #ffb703; --mark-ink: #16143f; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0f0d2b; --surface: #1a1842; --fg: #edebff; --muted: #a6a3cc; --line: #2c2963;
  --kw: #ff5a6e; --str: #4fd39a; --fn: #8c9bff; --num: #ff5a6e; --accent-ink: #0f0d2b;
  --band: #26227a; --band-fg: #f3f1ff; --band-muted: #c3bff0; --mark: #ffb703; --mark-ink: #16143f; color-scheme: dark; }

body { background: var(--bg); color: var(--fg); font: 400 15px/1.7 var(--mono); }
.wrap { max-width: 980px; margin: 0 auto; padding-left: var(--gutter-l); padding-right: var(--gutter-r); }
a { color: var(--fn); }
a:focus-visible, .btn:focus-visible, summary:focus-visible { outline: 2px dashed var(--fn); outline-offset: 3px; }
h1, h2, h3 { font-family: var(--mono); line-height: 1.25; text-wrap: balance; margin: 0; font-weight: 700; }
h1 { font-size: clamp(26px, 4.2vw, 40px); letter-spacing: -0.02em; }
h2 { font-size: 20px; }
h2::before { content: "## "; color: var(--muted); font-weight: 400; }
h3 { font-size: 15px; color: var(--fn); }
p { margin: 0; }
.muted { color: var(--muted); }

.top { background: var(--band); margin-top: calc(-1 * env(safe-area-inset-top, 0px)); padding-top: env(safe-area-inset-top, 0px); }
.top .logo { color: var(--band-fg); } .top nav a { color: var(--band-muted) !important; } .top nav a:hover { color: var(--band-fg) !important; }
.top .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-block: 12px; }
.logo { font-weight: 700; font-size: 16px; color: var(--fg); text-decoration: none; }
.logo::before { content: "~/"; color: var(--muted); font-weight: 400; }
.top nav { display: flex; gap: 18px; flex-wrap: wrap; font-size: 14px; }
.top nav a { color: var(--muted); text-decoration: none; }
.top nav a::before { content: "./"; }
.top nav a:hover { color: var(--fg); }

.hero { background: var(--band); color: var(--band-fg); }
.hero .eyebrow, .hero .lead { color: var(--band-muted); }
.hero mark { background: var(--mark); color: var(--mark-ink); padding: 0 0.15em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.hero .btn { background: transparent; color: var(--band-fg); border-color: var(--band-muted); }
.hero .btn.primary { background: var(--mark); border-color: var(--mark); color: var(--mark-ink); }
.hero .btn.primary::before { color: var(--kw); }
.hero .wrap { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 40px; align-items: start; padding-block: 48px 56px; }
.hero .text { display: grid; gap: 18px; min-width: 0; }
.eyebrow { color: var(--muted); font-size: 14px; }
.eyebrow::before { content: "// "; }
.lead { color: var(--muted); max-width: 38em; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.btn { display: inline-block; padding: 9px 16px; font-weight: 500; text-decoration: none; border: 1px solid var(--line); border-radius: 4px; color: var(--fg); background: var(--surface); }
.btn.primary { background: var(--fg); border-color: var(--fg); color: var(--bg); }
.logo span { color: var(--mark) !important; }
.btn.primary::before { content: "$ "; color: var(--str); }

.phone { background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: 8px 8px 0 var(--mark); border-radius: 6px; display: grid; min-width: 0; font-size: 13px; }
.phone header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.phone header b { font-weight: 500; }
.phone header b::before { content: "● "; color: var(--str); }
.phone header small { color: var(--muted); font-size: 12px; }
.phone .log { display: grid; gap: 2px; padding: 10px 12px 12px; counter-reset: ln; }
.msg { display: grid; grid-template-columns: 3ch 5.5ch 6ch 1fr; gap: 8px; line-height: 1.55; counter-increment: ln; }
.msg::before { content: counter(ln); color: var(--muted); opacity: 0.6; text-align: right; }
.msg time { color: var(--muted); font-variant-numeric: tabular-nums; }
.msg .who { font-weight: 500; }
.msg.guest .who { color: var(--kw); }
.msg.bot .who { color: var(--str); }
.msg .t { min-width: 0; overflow-wrap: anywhere; }

section.block .wrap { display: grid; gap: 20px; padding-block: 40px; }
section.block + section.block .wrap { border-top: 1px dashed var(--line); }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; counter-reset: step; list-style: none; padding: 0; margin: 0; }
.steps li { display: grid; gap: 6px; counter-increment: step; align-content: start; }
.steps li::before { content: "step(" counter(step) ")"; color: var(--num); }
.grid4 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 32px; }
.grid4 div { display: grid; gap: 4px; align-content: start; }
.grid4 h3::after { content: "()"; color: var(--muted); }
.tags { display: flex; flex-wrap: wrap; gap: 8px 10px; list-style: none; padding: 0; margin: 0; }
.tags li { color: var(--str); }
.tags li::before { content: '"'; } .tags li::after { content: '",'; color: var(--muted); }
.tags li:last-child::after { content: '"'; }
.pilot { display: grid; gap: 6px; max-width: 46em; }
.pilot b { color: var(--fn); font-weight: 500; }

.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.plan { display: grid; gap: 10px; align-content: start; padding: 16px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
.plan.featured { border-color: var(--fg); box-shadow: 6px 6px 0 var(--mark); }
.plan h3 { color: var(--kw); }
.plan h3::before { content: "plan "; color: var(--muted); font-weight: 400; }
.plan .price { font-size: 22px; font-weight: 700; color: var(--num); font-variant-numeric: tabular-nums; }
.plan .price small { font-size: 13px; font-weight: 400; color: var(--muted); }
.plan ul, .rules { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.plan li::before, .rules li::before { content: "- "; color: var(--muted); }
.rules { max-width: 46em; }
.faq { display: grid; max-width: 52em; }
.faq details { border-bottom: 1px dashed var(--line); padding-block: 12px; }
.faq summary { cursor: pointer; font-weight: 500; list-style: none; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::before { content: "> "; color: var(--kw); }
.faq details[open] summary::before { content: "v "; }
.faq details p { margin-top: 6px; color: var(--muted); padding-left: 2ch; }
.contact { display: grid; gap: 8px; max-width: 46em; }
.contact .k { color: var(--kw); }
.textpage .wrap { display: grid; gap: 14px; padding-block: 40px; max-width: 760px; }

footer { border-top: 1px solid var(--line); }
footer .wrap { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-block: 20px; color: var(--muted); font-size: 13px; }
footer a { color: var(--muted); }

@media (max-width: 860px) {
  .hero .wrap { grid-template-columns: 1fr; padding-block: 32px 40px; gap: 28px; }
  .steps, .plans, .grid4 { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .top nav a:not(.keep) { display: none; }
  .msg { grid-template-columns: 5ch 5ch 1fr; }
  .msg::before { display: none; }
}
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
    ? `<p><span class="k">telegram:</span> <a href="https://t.me/${esc(brand.telegram)}">@${esc(brand.telegram)}</a></p>`
    : `<p class="muted">Адрес в Telegram появится после запуска бота.</p>`;
  const phone = brand.phone ? `<p><span class="k">телефон:</span> <span>${esc(brand.phone)}</span></p>` : "";
  const mail = brand.email ? `<p><span class="k">почта:</span> <span>${esc(brand.email)}</span></p>` : "";
  return `<section class="block" id="contact"><div class="wrap"><h2>Связаться</h2><div class="contact"><p>Напишите, чем занимается ваш бизнес и что чаще всего спрашивают клиенты. Покажем агента на ваших данных.</p>${tg}${phone}${mail}</div></div></section>`;
}

function landing(p) {
  const h = p.hero;
  const chat = h.chat
    .map((m) => `<div class="msg ${m.from}"><time>${esc(m.time)}</time><span class="who">${m.from === "bot" ? "бот" : "гость"}</span><span class="t">${esc(m.text)}</span></div>`)
    .join("");
  return `
<section class="hero"><div class="wrap">
  <div class="text">
    <span class="eyebrow">${esc(h.eyebrow)}</span>
    <h1>${h.mark ? esc(h.title).replace(esc(h.mark), `<mark>${esc(h.mark)}</mark>`) : esc(h.title)}</h1>
    <p class="lead">${esc(h.lead)}</p>
    <div class="actions"><a class="btn primary" href="${h.primary.href}">${esc(h.primary.label)}</a><a class="btn" href="${h.secondary.href}">${esc(h.secondary.label)}</a></div>
  </div>
  <div class="phone" aria-label="Пример переписки"><header><b>${esc(h.chatName)}</b><small>${esc(h.chatNote)}</small></header><div class="log">${chat}</div></div>
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
