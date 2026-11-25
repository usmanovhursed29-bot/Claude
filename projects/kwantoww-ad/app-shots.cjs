// Реальные экраны приложения Kwantoww (projects/365-app/index.html) с примерными данными за неделю.
// node app-shots.cjs <outDir>
const { chromium } = require("playwright"); const fs = require("fs"); const path = require("path");
(async () => {
  const out = process.argv[2] || path.join(__dirname, "app-shots");
  fs.mkdirSync(out, { recursive: true });
  let src = fs.readFileSync(path.join(__dirname, "../365-app/index.html"), "utf8").replace('const AI_URL="";', 'const AI_URL="https://ai.test";');
  const tg = `<script>window.Telegram={WebApp:{initData:"auth_date=1&user=%7B%22id%22%3A42%7D&hash=x",initDataUnsafe:{user:{first_name:"Тимур"}},ready(){},expand(){},onEvent(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){},selectionChanged(){},notificationOccurred(){}},colorScheme:"light",setHeaderColor(){},setBackgroundColor(){}}};</script>`;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.route("https://ai.test/**", (r) => r.fulfill({ json: { ok: true, items: [] } }));
  await p.route("http://app.test/", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + tg + "</head><body>" + src + "</body></html>" }));
  await p.goto("http://app.test/"); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const { S } = window.KW;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = (n) => iso(new Date(Date.now() + n * 864e5));
    let k = 0; const id = () => "demo" + k++;
    S.settings.name = "Тимур";
    const sleep = [450, 420, 480, 390, 465, 440, 480], water = [2300, 2600, 1800, 2500, 2700, 2200, 1500], steps = [8400, 11200, 6300, 9800, 12400, 7100, 9000], mood = [4, 5, 3, 4, 5, 4, 4];
    for (let i = 0; i < 7; i++) { const d = day(i - 6); S.health.log[d] = { sleep: sleep[i], water: water[i], steps: steps[i], mood: mood[i], energy: mood[i] }; }
    S.tasks.push(
      { id: id(), title: "Позвонить маме", tag: "personal", bucket: "today", due: day(0), done: true },
      { id: id(), title: "Купить продукты", tag: "personal", bucket: "today", due: day(0), done: false },
      { id: id(), title: "Тренировка в зале", tag: "personal", bucket: "today", due: day(0), done: false },
      { id: id(), title: "Сдать отчёт по проекту", tag: "work", bucket: "week", due: day(2), done: false },
      { id: id(), title: "Записаться к стоматологу", tag: "personal", bucket: "week", due: day(3), done: false },
      { id: id(), title: "Прочитать 50 страниц", tag: "personal", bucket: "later", due: null, done: false });
    S.events.push(
      { id: id(), title: "Ужин с семьёй", date: day(0), time: "19:00", dur: 90, tag: "personal" },
      { id: id(), title: "Поликлиника", date: day(1), time: "12:00", dur: 60, tag: "personal" },
      { id: id(), title: "Встреча с клиентом", date: day(2), time: "10:00", dur: 60, tag: "work" },
      { id: id(), title: "Футбол с друзьями", date: day(3), time: "20:00", dur: 120, tag: "personal" });
    const hab = (name, days, color) => { const log = {}; for (const n of days) log[day(-n)] = true; S.habits.push({ id: id(), name, color, log, created: day(-30) }); };
    hab("Пить 2 литра воды", [0, 1, 2, 3, 4, 5, 6, 7, 8], 0);
    hab("Прогулка 30 минут", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1);
    hab("Читать 20 минут", [1, 2, 4, 5, 7], 2);
    hab("Без сладкого", [0, 1, 2, 3, 4], 3);
    const acc = S.money.accounts[0];
    const tx = (n, type, amount, cat, note) => S.money.tx.push({ id: id(), date: day(n), type, amount, cat, note, acc: acc?.id || "" });
    tx(-6, "inc", 50000, "other", "Зарплата");
    tx(-5, "exp", 1250, "food", "Продукты"); tx(-4, "exp", 450, "cafe", "Кофе и обед"); tx(-3, "exp", 300, "transport", "Такси");
    tx(-2, "exp", 2100, "food", "Продукты на неделю"); tx(-1, "exp", 890, "cafe", "Пицца"); tx(0, "exp", 450, "cafe", "Обед"); tx(0, "exp", 600, "health", "Аптека");
    if (acc) acc.balance = 50000 - 6040;
    S.workouts.push({ id: id(), type: "gym", min: 60, date: day(-1), note: "" }, { id: id(), type: "run", min: 30, date: day(-3), note: "" });
    window.KW.render();
  });
  await p.waitForTimeout(600);
  for (const v of ["overview", "tasks", "calendar", "habits", "health", "money"]) {
    await p.evaluate((v) => { window.KW.go(v); }, v);
    await p.waitForTimeout(700);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: path.join(out, `${v}.png`) });
  }
  // длинный главный экран для прокрутки в ролике
  await p.evaluate(() => window.KW.go("overview")); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, "overview_full.png"), fullPage: true });
  await b.close();
  console.log("ok", fs.readdirSync(out).join(", "));
})();
