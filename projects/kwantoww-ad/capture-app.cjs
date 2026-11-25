// Снимает настоящее приложение Kwantoww по шагам сценария ролика.
// Приложение: projects/365-app/index.html, тёмная тема, акцент «Графит», примерные данные (не личные).
// Размер области приложения как в Telegram на iPhone: 390×707 CSS px, ×2.
// node capture-app.cjs <outDir>  → PNG по шагам + steps.json (кадр, точка нажатия)
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
(async () => {
  const out = process.argv[2] || path.join(__dirname, "app-steps");
  fs.mkdirSync(out, { recursive: true });
  let src = fs.readFileSync(path.join(__dirname, "../365-app/index.html"), "utf8").replace('const AI_URL="";', 'const AI_URL="https://ai.test";');
  const tg = `<script>window.Telegram={WebApp:{initData:"auth_date=1&user=%7B%22id%22%3A42%7D&hash=x",initDataUnsafe:{user:{first_name:"Тимур"}},ready(){},expand(){},onEvent(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){},selectionChanged(){},notificationOccurred(){}},colorScheme:"dark",setHeaderColor(){},setBackgroundColor(){}}};</script>`;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 707 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await p.route("https://ai.test/**", (r) => r.fulfill({ json: { ok: true, items: [] } }));
  await p.route("http://app.test/", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + tg + "</head><body>" + src + "</body></html>" }));
  await p.goto("http://app.test/"); await p.waitForTimeout(1000);
  await p.evaluate(() => {
    const { S } = window.KW;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = (n) => iso(new Date(Date.now() + n * 864e5));
    let k = 0; const id = () => "demo" + k++;
    S.settings.name = "Тимур"; S.settings.theme = "dark"; S.settings.accent = "graphite";
    document.documentElement.setAttribute("data-theme", "dark"); document.documentElement.setAttribute("data-accent", "graphite");
    const sleep = [450, 420, 480, 390, 465, 440, 465], water = [2300, 2600, 1800, 2500, 2700, 2200, 1250], steps = [8400, 11200, 6300, 9800, 12400, 7100, 6800], mood = [4, 5, 3, 4, 5, 4, 4];
    for (let i = 0; i < 7; i++) S.health.log[day(i - 6)] = { sleep: sleep[i], water: water[i], steps: steps[i], mood: mood[i], energy: mood[i] };
    S.tasks.push(
      { id: id(), title: "Позвонить маме", tag: "personal", bucket: "today", due: day(0), done: true },
      { id: id(), title: "Тренировка в зале", tag: "personal", bucket: "today", due: day(0), done: false },
      { id: id(), title: "Сдать отчёт по проекту", tag: "work", bucket: "week", due: day(2), done: false },
      { id: id(), title: "Записаться к стоматологу", tag: "personal", bucket: "week", due: day(3), done: false });
    S.events.push(
      { id: id(), title: "Поликлиника", date: day(0), time: "12:00", dur: 60, tag: "personal" },
      { id: id(), title: "Тренировка", date: day(0), time: "18:00", dur: 90, tag: "personal" },
      { id: id(), title: "Встреча с клиентом", date: day(1), time: "10:00", dur: 60, tag: "work" },
      { id: id(), title: "Футбол с друзьями", date: day(3), time: "20:00", dur: 120, tag: "personal" });
    const hab = (name, days, color) => { const log = {}; for (const n of days) log[day(-n)] = true; S.habits.push({ id: id(), name, color, log, created: day(-30) }); };
    hab("Прогулка 30 минут", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1);
    hab("Пить 2 литра воды", [1, 2, 3, 4, 5, 6, 7, 8], 0);
    hab("Читать 20 минут", [1, 2, 4, 5, 7], 2);
    S.money.accounts.push({ id: "acc1", name: "Карта", balance: 38450 });
    const tx = (n, type, amount, cat, note) => S.money.tx.push({ id: id(), date: day(n), type, amount, cat, note, acc: "acc1" });
    tx(-6, "inc", 45000, "other", "Зарплата"); tx(-5, "exp", 1250, "food", "Продукты"); tx(-4, "exp", 450, "cafe", "Кофе и обед");
    tx(-3, "exp", 300, "transport", "Такси"); tx(-2, "exp", 2100, "food", "Продукты"); tx(-1, "exp", 890, "cafe", "Пицца"); tx(0, "exp", 560, "cafe", "Обед");
    S.workouts.push({ id: id(), type: "gym", min: 60, date: day(-1), note: "" });
    window.KW.render();
  });
  await p.waitForTimeout(700);

  const steps = [];
  let n = 0;
  const box = async (sel) => { const r = await p.locator(sel).first().boundingBox(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; };
  const shot = async (name, tap = null, extra = {}) => {
    const file = `${String(n++).padStart(2, "0")}_${name}.png`;
    await p.screenshot({ path: path.join(out, file) });
    steps.push({ file, name, tap, scroll: await p.evaluate(() => window.scrollY), ...extra });
  };
  const settle = (ms = 650) => p.waitForTimeout(ms);

  // 1. главный экран
  await p.evaluate(() => window.scrollTo(0, 0)); await settle();
  await shot("overview");
  // длинный главный экран — для плавной прокрутки в ролике
  await p.screenshot({ path: path.join(out, "overview_long.png"), fullPage: true });
  // 2. «Задача» → печать → сохранить
  let t = await box('[data-a="qs"][data-v="task"]');
  await p.click('[data-a="qs"][data-v="task"]'); await settle();
  await shot("task_open", t);
  const text = "Купить продукты";
  for (let i = 1; i <= text.length; i++) { await p.keyboard.type(text[i - 1]); await p.waitForTimeout(40); await shot(`type_${String(i).padStart(2, "0")}`, null, { typing: true }); }
  t = await box('#qsPanel button:has-text("Сохранить")');
  await p.click('#qsPanel button:has-text("Сохранить")'); await settle(500);
  await shot("task_saved", t);
  await p.evaluate(() => { document.querySelector("#toast")?.classList.remove("show"); window.scrollTo(0, 0); }); await settle(300);
  await p.screenshot({ path: path.join(out, "long_overview.png"), fullPage: true });
  // 3. вода: прокрутка к карточке, нажатие, «Стакан 250 мл»
  await p.evaluate(() => { const el = document.querySelector('[data-a="qs"][data-v="water"]'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160); }); await settle(400);
  await shot("water_view");
  t = await box('[data-a="qs"][data-v="water"]');
  await p.click('[data-a="qs"][data-v="water"]'); await settle();
  await shot("water_open", t);
  t = await box('#qsPanel [data-a="qs-chip"][data-v="250"]');
  await p.click('#qsPanel [data-a="qs-chip"][data-v="250"]'); await settle(300);
  const stillOpen = await p.evaluate(() => document.querySelector("#qs")?.classList.contains("open"));
  if (stillOpen) { await shot("water_chip", t); t = await box('#qsPanel button:has-text("Сохранить")'); await p.click('#qsPanel button:has-text("Сохранить")'); await settle(500); }
  await shot("water_saved", t);
  // 4. вкладка «Привычки» → отметить «Пить 2 литра воды»
  const nav = async (v, name) => {
    // всплывающее сообщение прошлого шага убираем, кнопку вкладки прокручиваем в видимую часть полосы
    await p.evaluate(() => document.querySelector("#toast")?.classList.remove("show"));
    const sel = `[data-a="nav"][data-v="${v}"] >> nth=-1`;
    await p.locator(sel).scrollIntoViewIfNeeded(); await p.waitForTimeout(150);
    await shot(name + "_before");
    const tt = await box(sel); await p.click(sel); await p.evaluate(() => window.scrollTo(0, 0)); await settle(); await shot(name, tt);
  };
  await nav("habits", "habits");
  await p.evaluate(() => document.querySelector("#toast")?.classList.remove("show"));
  await p.screenshot({ path: path.join(out, "long_habits.png"), fullPage: true });
  const habBtn = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-a="hab"]')].find((x) => x.getAttribute("aria-pressed") === "false"); if (!b) return null; b.scrollIntoView({ block: "center" }); return true; });
  await settle(300);
  if (habBtn) { await shot("habits_scrolled"); const sel = '[data-a="hab"][aria-pressed="false"]'; t = await box(sel); await p.click(sel); await settle(); await shot("habit_done", t); }
  // 5. «Календарь»: прокрутить сетку к событиям дня
  await nav("calendar", "calendar");
  await p.evaluate(() => { const g = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== "visible" && e !== document.documentElement && e !== document.body); if (g) g.scrollTop = g.scrollHeight * 0.38; });
  await settle(300); await shot("calendar_events");
  // 6. «Здоровье»
  await nav("health", "health");
  // 7. «Задачи» — новая задача в списке
  await nav("tasks", "tasks");
  await p.screenshot({ path: path.join(out, "long_tasks.png"), fullPage: true });
  await p.evaluate(() => window.scrollTo(0, 520)); await settle(400); await shot("tasks_list");

  // высота закреплённой шапки и верх нижней полосы вкладок (CSS px)
  const bars = await p.evaluate(() => {
    const fixedOf = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e !== document.body) { const ps = getComputedStyle(e).position; if (ps === "fixed" || ps === "sticky") return e.getBoundingClientRect(); e = e.parentElement; } return null; };
    const top = fixedOf(195, 8), bot = fixedOf(195, 700);
    return { top: top ? top.bottom : 0, bottom: bot ? bot.top : 707 };
  });
  fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify({ viewport: [390, 707], scale: 2, bars, steps }, null, 1));
  console.log("bars", JSON.stringify(bars));
  console.log(steps.map((s) => s.name + (s.tap ? `@${Math.round(s.tap.x)},${Math.round(s.tap.y)}` : "")).join(" | "));
  await b.close();
})();
