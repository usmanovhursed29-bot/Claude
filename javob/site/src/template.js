// Полка «Внешний вид → Тема и меню»: ОДИН шаблон на все страницы.
// Бренд и заголовки берутся только из brand.js, тексты только из content/pages.js.
import { brand } from "./brand.js";
import { pages } from "../content/pages.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@700;800&display=swap";

export const STYLE = `
/* Макет: светлая страница в цветах Telegram; первый экран — текст слева, живая переписка справа. */
:root {
  --bg: #ffffff; --soft: #f1f6fb; --fg: #0f1b2a; --muted: #5a6b7d; --line: #e1e9f1;
  --brand: #1a82c4; --brand-ink: #ffffff; --brand-soft: #e3f2fc; --tg: #2aabee;
  --in: #ffffff; --out: #e1f7cf; --chatbg: #d9e8f2; --ok: #1f9d5c; --err: #d64545;
  --head: "Manrope", "Segoe UI", system-ui, sans-serif;
  --body: "Inter", "Segoe UI", system-ui, sans-serif;
  --gutter-l: max(16px, env(safe-area-inset-left, 0px));
  --gutter-r: max(16px, env(safe-area-inset-right, 0px));
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e1621; --soft: #17212b; --fg: #e8eef4; --muted: #8b9bab; --line: #243240;
  --brand: #3ea6e6; --brand-ink: #071019; --brand-soft: #1a2c3c; --tg: #3ea6e6;
  --in: #182533; --out: #2b5278; --chatbg: #0f1a24; --ok: #4cc488; --err: #ff7a7a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e1621; --soft: #17212b; --fg: #e8eef4; --muted: #8b9bab; --line: #243240;
  --brand: #3ea6e6; --brand-ink: #071019; --brand-soft: #1a2c3c; --tg: #3ea6e6;
  --in: #182533; --out: #2b5278; --chatbg: #0f1a24; --ok: #4cc488; --err: #ff7a7a; color-scheme: dark; }

html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--fg); font: 400 17px/1.6 var(--body); }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: var(--gutter-l); padding-right: var(--gutter-r); }
a { color: var(--brand); }
:focus-visible { outline: 3px solid var(--tg); outline-offset: 2px; }
h1, h2, h3 { font-family: var(--head); line-height: 1.15; text-wrap: balance; margin: 0; letter-spacing: -0.015em; }
h1 { font-size: clamp(32px, 5.2vw, 56px); font-weight: 800; }
h2 { font-size: clamp(26px, 3.4vw, 38px); font-weight: 800; }
h3 { font-size: 19px; font-weight: 700; }
p { margin: 0; }
.muted { color: var(--muted); }

.top .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-block: 18px; }
.logo { display: inline-flex; align-items: center; gap: 10px; font-family: var(--head); font-weight: 800; font-size: 22px; color: var(--fg); text-decoration: none; }
.logo i { width: 34px; height: 34px; border-radius: 50%; background: var(--tg); color: #fff; display: grid; place-items: center; }
.logo i svg { width: 18px; height: 18px; }
.top nav { display: flex; gap: 26px; align-items: center; flex-wrap: wrap; font-size: 15px; font-weight: 500; }
.top nav a { color: var(--muted); text-decoration: none; transition: color .2s; }
.top nav a:hover { color: var(--fg); }
.top nav a.cta { color: var(--brand-ink); background: var(--brand); padding: 9px 18px; border-radius: 999px; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 26px; border-radius: 999px; font-weight: 600; font-size: 16px; text-decoration: none; border: 0; cursor: pointer; font-family: var(--body);
  transition: transform .2s ease, box-shadow .2s ease; }
.btn.primary { background: var(--brand); color: var(--brand-ink); box-shadow: 0 8px 20px -10px var(--brand); }
.btn.ghost { background: var(--brand-soft); color: var(--brand); }
.btn:hover { transform: translateY(-2px); }
.btn.primary:hover { box-shadow: 0 14px 28px -12px var(--brand); }

.hero .wrap { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; padding-block: 40px 80px; }
.hero .text { display: grid; gap: 22px; min-width: 0; }
.pill { justify-self: start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: var(--brand-soft); color: var(--brand); font-size: 14px; font-weight: 600; }
.pill b { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: blink 2s ease-in-out infinite; }
.lead { font-size: 19px; color: var(--muted); max-width: 32em; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.hero h1 em { font-style: normal; color: var(--brand); }

.phone { justify-self: center; width: min(380px, 100%); border-radius: 34px; padding: 10px; background: var(--fg); box-shadow: 0 30px 60px -30px rgba(15, 27, 42, .45); animation: float 6s ease-in-out infinite; }
.screen { border-radius: 26px; overflow: hidden; background: var(--chatbg); }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--bg); }
.ava { border-radius: 50%; background: linear-gradient(135deg, #f6a04d, #e0603a); color: #fff; display: grid; place-items: center; font-weight: 800; font-family: var(--head); }
.chat-head .ava { width: 38px; height: 38px; }
.chat-head b { display: block; font-size: 15px; }
.chat-head small { color: var(--brand); font-size: 13px; }
.log { display: grid; gap: 8px; padding: 14px 12px 16px; }
.msg { max-width: 82%; padding: 8px 12px 6px; border-radius: 16px; font-size: 15px; line-height: 1.4; box-shadow: 0 1px 1px rgba(0, 0, 0, .06);
  animation: pop .5s cubic-bezier(.2, .8, .2, 1) both; }
.msg time { display: block; text-align: right; font-size: 11px; color: var(--muted); margin-top: 2px; }
.msg.guest { justify-self: end; background: var(--out); border-bottom-right-radius: 4px; }
.msg.bot { justify-self: start; background: var(--in); border-bottom-left-radius: 4px; }
.msg:nth-child(2) { animation-delay: .35s; } .msg:nth-child(3) { animation-delay: .7s; } .msg:nth-child(4) { animation-delay: 1.05s; }
.typing { justify-self: start; display: inline-flex; gap: 4px; padding: 12px 14px; border-radius: 16px; border-bottom-left-radius: 4px; background: var(--in); }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: dot 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: .15s; } .typing span:nth-child(3) { animation-delay: .3s; }
.note { text-align: center; font-size: 12px; color: var(--muted); padding: 0 0 12px; }

section.block .wrap { display: grid; gap: 28px; padding-block: 72px; }
section.soft { background: var(--soft); }
.head { display: grid; gap: 10px; max-width: 40em; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; list-style: none; padding: 0; margin: 0; }
.cards.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.card { display: grid; gap: 10px; align-content: start; padding: 26px; border-radius: 22px; background: var(--bg); border: 1px solid var(--line); transition: transform .25s ease, box-shadow .25s ease; }
.card:hover { transform: translateY(-4px); box-shadow: 0 18px 34px -24px rgba(15, 27, 42, .35); }
.num { width: 40px; height: 40px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-family: var(--head); font-weight: 800; }
.ico { width: 44px; height: 44px; border-radius: 14px; background: var(--brand-soft); color: var(--brand); display: grid; place-items: center; }
.ico svg { width: 22px; height: 22px; }
.tags { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; padding: 0; margin: 0; }
.tags li { padding: 12px 20px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); font-weight: 500; }
.pilot { display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: center; padding: 28px; border-radius: 22px; background: var(--brand-soft); max-width: 820px; }
.pilot .ava { width: 64px; height: 64px; font-size: 24px; }
.pilot div { display: grid; gap: 6px; min-width: 0; }

.plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.plan { position: relative; display: grid; gap: 14px; align-content: start; padding: 30px 26px; border-radius: 24px; background: var(--bg); border: 1px solid var(--line); transition: transform .25s ease, box-shadow .25s ease; }
.plan:hover { transform: translateY(-4px); box-shadow: 0 18px 34px -24px rgba(15, 27, 42, .35); }
.plan.featured { border: 2px solid var(--brand); }
.plan .badge { position: absolute; top: -13px; left: 26px; padding: 3px 12px; border-radius: 999px; background: var(--brand); color: var(--brand-ink); font-size: 13px; font-weight: 600; }
.plan .price { font-family: var(--head); font-size: 38px; font-weight: 800; font-variant-numeric: tabular-nums; }
.plan .price small { font-family: var(--body); font-size: 15px; font-weight: 400; color: var(--muted); }
.plan ul, .rules { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.plan li, .rules li { display: grid; grid-template-columns: 22px 1fr; gap: 8px; }
.plan li::before, .rules li::before { content: "✓"; color: var(--ok); font-weight: 700; }
.faq { display: grid; gap: 12px; max-width: 820px; }
.faq details { border-radius: 18px; background: var(--bg); border: 1px solid var(--line); padding: 18px 22px; }
.faq summary { cursor: pointer; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; color: var(--brand); font-size: 22px; line-height: 1; transition: transform .25s; }
.faq details[open] summary::after { transform: rotate(45deg); }
.faq details p { margin-top: 10px; color: var(--muted); }
.faq details[open] p { animation: pop .35s ease both; }

.ask { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 40px; align-items: start; }
.ask .side { display: grid; gap: 16px; min-width: 0; }
.ask .side p.contact { font-weight: 500; }
form.qa { position: relative; display: grid; gap: 12px; padding: 26px; border-radius: 24px; background: var(--bg); border: 1px solid var(--line); min-width: 0; }
form.qa label { display: grid; gap: 6px; font-size: 14px; font-weight: 500; color: var(--muted); }
form.qa input, form.qa textarea { font: inherit; color: var(--fg); background: var(--soft); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; transition: border-color .2s; min-width: 0; }
form.qa input:focus, form.qa textarea:focus { border-color: var(--brand); outline: none; }
form.qa textarea { min-height: 110px; resize: vertical; }
form.qa .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.status { font-size: 15px; font-weight: 500; min-height: 1.5em; }
.status.ok { color: var(--ok); }
.status.err { color: var(--err); }

.fab { position: fixed; right: calc(20px + env(safe-area-inset-right, 0px)); bottom: calc(20px + env(safe-area-inset-bottom, 0px)); z-index: 20; display: inline-flex; align-items: center; gap: 8px;
  padding: 14px 20px; border-radius: 999px; background: var(--tg); color: #fff; font-weight: 600; text-decoration: none; box-shadow: 0 12px 28px -10px rgba(42, 171, 238, .7);
  transition: transform .2s; animation: nudge 1s ease 2s 2; }
.fab:hover { transform: scale(1.05); }
.fab svg { width: 20px; height: 20px; }

.textpage .wrap { display: grid; gap: 16px; padding-block: 56px; max-width: 760px; }
footer { border-top: 1px solid var(--line); }
footer .wrap { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding-block: 28px 96px; color: var(--muted); font-size: 14px; }
footer a { color: var(--muted); font-weight: 500; }
footer a:hover { color: var(--fg); }

@keyframes pop { from { transform: translateY(10px) scale(.98); opacity: .2; } to { transform: none; opacity: 1; } }
@keyframes dot { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes nudge { 0%, 100% { transform: none; } 30% { transform: translateY(-6px); } 60% { transform: translateY(0); } }

@media (max-width: 900px) {
  .hero .wrap, .ask { grid-template-columns: 1fr; }
  .hero .wrap { gap: 40px; padding-block: 24px 56px; }
  .cards, .cards.four, .plans { grid-template-columns: 1fr; }
  .top nav a:not(.cta) { display: none; }
  section.block .wrap { padding-block: 52px; }
}
@media (min-width: 560px) and (max-width: 900px) { .cards.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .fab span { display: none; } .fab { padding: 14px; } .pilot { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } html { scroll-behavior: auto; } }
`;

const PLANE = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 3.6 2.9 10.8c-1.3.5-1.3 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.5-1.5ZM8.4 13.5l9.9-6.2c.5-.3.9-.1.5.2l-8.4 7.6-.3 3.6-1.7-5.2Z"/></svg>`;
const ICONS = [
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
];

const tgLink = () => (brand.telegram ? `https://t.me/${esc(brand.telegram)}` : "#ask");

const header = () =>
  `<header class="top"><div class="wrap"><a class="logo" href="/"><i>${PLANE}</i>${esc(brand.name)}</a>
<nav aria-label="Меню"><a href="/#how">Как работает</a><a href="/#pricing">Тарифы</a><a href="/#faq">Вопросы</a><a class="cta" href="/#ask">Задать вопрос</a></nav></div></header>`;

const footer = () => {
  const extra = pages.filter((p) => p.inMenu).map((p) => `<a href="${p.path}">${esc(p.title)}</a>`).join(" · ");
  return `<footer><div class="wrap"><span>© 2026 ${esc(brand.name)}. ${esc(brand.tagline)}</span><span>${extra}</span></div></footer>
<a class="fab" href="${tgLink()}" target="_blank" rel="noopener">${PLANE}<span>Задать вопрос</span></a>`;
};

function askBlock() {
  const contacts = [
    brand.telegram ? `<p class="contact">Telegram: <a href="${tgLink()}" target="_blank" rel="noopener">@${esc(brand.telegram)}</a></p>` : "",
    brand.phone ? `<p class="contact">Телефон: <span>${esc(brand.phone)}</span></p>` : "",
    brand.email ? `<p class="contact">Почта: <span>${esc(brand.email)}</span></p>` : "",
  ].join("");
  return `<section class="block soft" id="ask"><div class="wrap"><div class="ask">
  <div class="side"><h2>Задайте вопрос</h2><p class="muted">Напишите, чем занимается ваш бизнес и что чаще всего спрашивают клиенты. Ответим в течение дня и покажем агента на ваших данных.</p>${contacts}
  <div class="actions"><a class="btn primary" href="${tgLink()}" target="_blank" rel="noopener">Написать в Telegram</a></div></div>
  <form class="qa" id="qa" novalidate>
    <label for="qa-name">Как вас зовут<input id="qa-name" name="name" maxlength="80" autocomplete="name"></label>
    <label for="qa-contact">Телефон или @telegram для ответа<input id="qa-contact" name="contact" maxlength="80" required></label>
    <label for="qa-question">Ваш вопрос<textarea id="qa-question" name="question" maxlength="1500" required></textarea></label>
    <input class="hp" id="qa-site" name="site" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn primary" type="submit">Отправить вопрос</button>
    <p class="status" id="qa-status" role="status"></p>
  </form></div></div></section>
<script>
(function () {
  var f = document.getElementById("qa"), st = document.getElementById("qa-status");
  if (!f) return;
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = { name: f.elements.name.value.trim(), contact: f.elements.contact.value.trim(), question: f.elements.question.value.trim(), site: f.elements.site.value };
    if (!d.contact || !d.question) { st.className = "status err"; st.textContent = "Заполните контакт и вопрос."; return; }
    st.className = "status"; st.textContent = "Отправляем…";
    fetch("/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) })
      .then(function (r) { if (!r.ok) throw 0; f.reset(); st.className = "status ok"; st.textContent = "Вопрос отправлен. Ответим в течение дня."; })
      .catch(function () { st.className = "status err"; st.textContent = "Не получилось отправить. Напишите нам в Telegram по кнопке слева."; });
  });
})();
</script>`;
}

function landing(p) {
  const h = p.hero;
  const title = h.mark ? esc(h.title).replace(esc(h.mark), `<em>${esc(h.mark)}</em>`) : esc(h.title);
  const chat = h.chat.map((m) => `<div class="msg ${m.from}">${esc(m.text)}<time>${esc(m.time)}</time></div>`).join("");
  return `
<section class="hero"><div class="wrap">
  <div class="text">
    <span class="pill"><b></b>${esc(h.eyebrow)}</span>
    <h1>${title}</h1>
    <p class="lead">${esc(h.lead)}</p>
    <div class="actions"><a class="btn primary" href="#ask">Задать вопрос</a><a class="btn ghost" href="#pricing">Посмотреть тарифы</a></div>
  </div>
  <div class="phone" aria-label="Пример переписки"><div class="screen">
    <div class="chat-head"><span class="ava">М</span><div><b>${esc(h.chatName)}</b><small>бот · онлайн</small></div></div>
    <div class="log">${chat}<div class="typing" aria-hidden="true"><span></span><span></span><span></span></div></div>
    <p class="note">${esc(h.chatNote)}</p>
  </div></div>
</div></section>
<section class="block soft" id="how"><div class="wrap"><div class="head"><h2>${esc(p.how.title)}</h2></div>
<ol class="cards">${p.how.steps.map((s, i) => `<li class="card"><span class="num">${i + 1}</span><h3>${esc(s.title)}</h3><p class="muted">${esc(s.text)}</p></li>`).join("")}</ol></div></section>
<section class="block"><div class="wrap"><div class="head"><h2>${esc(p.features.title)}</h2></div>
<div class="cards four">${p.features.items.map((f, i) => `<div class="card"><span class="ico">${ICONS[i % ICONS.length]}</span><h3>${esc(f.title)}</h3><p class="muted">${esc(f.text)}</p></div>`).join("")}</div></div></section>
<section class="block soft"><div class="wrap"><div class="head"><h2>${esc(p.audience.title)}</h2></div><ul class="tags">${p.audience.items.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div></section>
<section class="block"><div class="wrap"><div class="head"><h2>${esc(p.pilot.title)}</h2></div><div class="pilot"><span class="ava">М</span><div><h3>${esc(p.pilot.name)}</h3><p class="muted">${esc(p.pilot.text)}</p></div></div></div></section>
<section class="block soft" id="pricing"><div class="wrap"><div class="head"><h2>${esc(p.pricing.title)}</h2><p class="muted">${esc(p.pricing.note)}</p></div><div class="plans">${p.pricing.plans
    .map(
      (pl) => `<div class="plan${pl.featured ? " featured" : ""}">${pl.featured ? '<span class="badge">Чаще выбирают</span>' : ""}<h3>${esc(pl.name)}</h3><div class="price">${esc(pl.monthly)} <small>в месяц</small></div><p class="muted">Настройка: ${esc(pl.setup)}</p><ul>${pl.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul><a class="btn ${pl.featured ? "primary" : "ghost"}" href="#ask">Попробовать 14 дней</a></div>`
    )
    .join("")}</div></div></section>
<section class="block"><div class="wrap"><div class="head"><h2>${esc(p.principles.title)}</h2></div><ul class="rules">${p.principles.items.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div></section>
<section class="block soft" id="faq"><div class="wrap"><div class="head"><h2>${esc(p.faq.title)}</h2></div><div class="faq">${p.faq.items.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></div></section>
${askBlock()}`;
}

export const textSection = (p) =>
  `<section class="textpage" id="privacy"><div class="wrap"><h1>${esc(p.title)}</h1>${p.body.map((t) => `<p>${esc(t)}</p>`).join("")}<p><a class="btn ghost" href="/">На главную</a></p></div></section>`;

// Возвращает части страницы; worker.js собирает из них полный документ.
export function renderParts(p) {
  const title = p.path === "/" ? `${brand.name} — ${brand.tagline}` : `${p.title} — ${brand.name}`;
  const main = p.type === "landing" ? landing(p) : textSection(p);
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
  renderDocument({ path: "/404", title: "Страница не найдена", type: "text", body: ["Такой страницы нет."] }, { canonical: brand.siteUrl + "/" });
