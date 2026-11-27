// Виджет Kwantoww для iPhone (приложение Scriptable).
// Как поставить — пришёл в боте по команде /widget. Короче:
// 1) Scriptable → «+» → вставь весь этот код. 2) В строку KEY ниже вставь свой ключ из бота.
// 3) На экране «Домой» добавь виджет Scriptable и выбери скрипт «Kwantoww».

// ↓↓↓ ВСТАВЬ СЮДА СВОЙ КЛЮЧ ИЗ БОТА (команда /widget) ↓↓↓
const KEY = "ВСТАВЬ_КЛЮЧ";
// ↑↑↑ например "a1b2c3..." ↑↑↑

const API = "https://kwantoww-ai.usmanovhursed747.workers.dev/widget";
const BG1 = new Color("#1d1b17"), BG2 = new Color("#2a2722");
const FG = new Color("#f6f5f2"), MUT = new Color("#a8a29a"), ACC = new Color("#6c8cf0"), OK = new Color("#5bbd7a");

async function getData() {
  const r = new Request(API);
  r.method = "POST";
  r.headers = { "Content-Type": "application/json" };
  r.body = JSON.stringify({ initData: "key:" + KEY });
  r.timeoutInterval = 15;
  return await r.loadJSON();
}

function bg(w) {
  const g = new LinearGradient();
  g.colors = [BG1, BG2]; g.locations = [0, 1];
  w.backgroundGradient = g;
}
function row(stack, text, color, size, bold) {
  const t = stack.addText(text);
  t.textColor = color; t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.lineLimit = 1; return t;
}

let w = new ListWidget();
bg(w);
w.setPadding(14, 15, 14, 15);

try {
  const d = await getData();
  // заголовок
  const head = w.addStack(); head.centerAlignContent();
  row(head, "Kwantoww", FG, 13, true);
  head.addSpacer();
  const h = d.habits || { done: 0, total: 0, left: [] };
  row(head, h.total ? `Привычки ${h.done}/${h.total}` : "Привычки —", h.done >= h.total && h.total ? OK : MUT, 12, true);
  w.addSpacer(8);

  const fam = config.widgetFamily || "medium";
  const big = fam === "large";

  // невыполненные привычки
  if (h.left && h.left.length) {
    for (const name of h.left.slice(0, big ? 5 : 2)) {
      const s = w.addStack(); s.centerAlignContent();
      row(s, "○ ", MUT, 13);
      row(s, name, FG, 13);
    }
  } else if (h.total) {
    row(w, "✓ Все привычки на сегодня", OK, 13);
  }
  w.addSpacer(8);

  // план дня: события, задачи, главное
  const line = (icon, text, color) => { const s = w.addStack(); s.centerAlignContent(); row(s, icon + " ", color, 12); const t = s.addText(text); t.textColor = FG; t.font = Font.systemFont(12); t.lineLimit = 1; };
  let shown = 0, cap = big ? 6 : 3;
  for (const e of (d.events || [])) { if (shown >= cap) break; line(e.time || "•", e.title, ACC); shown++; }
  for (const t of (d.tasks || [])) { if (shown >= cap) break; line("☐", t, MUT); shown++; }
  if (!shown && d.main) { line("★", d.main, OK); shown++; }
  if (!shown) row(w, "На сегодня планов нет", MUT, 12);

  w.addSpacer();
  // нижняя строка: намаз
  if (d.namaz) {
    const f = w.addStack(); f.centerAlignContent();
    const inTxt = d.namaz.tomorrow ? "завтра" : (d.namaz.in != null ? `через ${Math.floor(d.namaz.in / 60)}ч ${d.namaz.in % 60}м` : "");
    row(f, `🕌 ${d.namaz.name} ${d.namaz.at}`, FG, 12, true);
    f.addSpacer();
    row(f, inTxt, MUT, 11);
  }
} catch (e) {
  row(w, "Kwantoww", FG, 14, true);
  w.addSpacer(6);
  row(w, KEY === "ВСТАВЬ_КЛЮЧ" ? "Вставь ключ из бота /widget" : "Нет связи. Проверь ключ и интернет", MUT, 12);
}

w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
