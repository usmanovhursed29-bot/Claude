// Разбор сообщений в чате бота в команды приложения (те же, что понимает runCommand в index.html):
// exp_<₽>[_<cat>] · inc_<₽> · water_<ml> · steps_<n> · sleep_<h>[-<tenths>] · weight_<kg>[-<tenths>]
// mood_<1-5> · energy_<1-5> · meal_<kcal> · task_<base64url text>
// Обычный код, без ИИ: работает мгновенно и бесплатно. Непонятное отдаётся ИИ (см. worker.js).

export const CATS = { food: "Продукты", cafe: "Кафе", home: "Дом и связь", transport: "Транспорт", subs: "Подписки", health: "Здоровье", other: "Другое" };

const CAT_WORDS = [
  ["cafe", /кафе|ресторан|кофе|чайхан|шаурм|фастфуд|макдон|бургер|обед в|пицц|доставк[аеу] еды/],
  ["food", /продукт|магазин|супермаркет|еда|хлеб|молоко|мясо|овощ|фрукт/],
  ["transport", /такси|бензин|метро|автобус|проезд|транспорт|парковк|заправк/],
  ["home", /квартир|аренд|коммунал|свет|интернет|связь|телефон|дом/],
  ["subs", /подписк|netflix|spotify|youtube|музык/],
  ["health", /аптек|лекарств|врач|клиник|стоматолог|спортзал|зал|анализ/],
];

const num = (s) => parseFloat(String(s).replace(/\s+/g, "").replace(",", "."));
const tenths = (x) => { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? String(r) : String(r).replace(".", "-"); };
export const b64url = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Одно сообщение может содержать несколько записей: «выпил 500 мл воды, прошёл 8000 шагов».
export function parseEntries(text) {
  const out = [];
  const raw = String(text || "").trim();
  if (!raw) return out;

  // Задачи: «план: …», «задача: …», «сделать: …» — каждая строка отдельно.
  const taskHead = /^(план|планы|задач[аи]|сделать|todo|напомни)\s*[:\-—]\s*/i;
  if (taskHead.test(raw)) {
    raw.replace(taskHead, "").split(/\n|;/).map((s) => s.replace(/^[\s\-•*\d.)]+/, "").trim()).filter(Boolean)
      .forEach((t) => out.push({ cmd: "task_" + b64url(t.slice(0, 200)), label: `Задача: ${t.slice(0, 200)}` }));
    return out;
  }

  const parts = raw.toLowerCase().replace(/ё/g, "е").split(/[\n;]|,(?!\d)|\sи\s(?=[а-я]*\s*\d)/);
  for (const p of parts) {
    let m;
    if ((m = p.match(/(\d[\d\s]*)\s*(шаг|step)/))) {
      const n = Math.round(num(m[1]));
      if (n >= 0 && n <= 200000) out.push({ cmd: `steps_${n}`, label: `Шаги: ${n}` });
    } else if ((m = p.match(/(\d+[.,]?\d*)\s*(мл|ml)(?![а-яa-z])/)) && !/кофе|чай|сок|молок|пиво/.test(p)) {
      const ml = Math.round(num(m[1]));
      if (ml > 0 && ml <= 5000) out.push({ cmd: `water_${ml}`, label: `Вода: +${ml} мл` });
    } else if ((m = p.match(/(\d+[.,]?\d*)\s*(л|литр)(?![а-я]*\s*\d)/)) && /вод|выпил/.test(p)) {
      const ml = Math.round(num(m[1]) * 1000);
      if (ml > 0 && ml <= 5000) out.push({ cmd: `water_${ml}`, label: `Вода: +${ml} мл` });
    } else if ((m = p.match(/(\d+)\s*стакан/)) && /вод/.test(p)) {
      const ml = Number(m[1]) * 250;
      if (ml > 0 && ml <= 5000) out.push({ cmd: `water_${ml}`, label: `Вода: +${ml} мл (стакан = 250 мл)` });
    } else if (/спал|сон|поспал|выспал/.test(p) && (m = p.match(/(\d+[.,]?\d*)\s*(ч|час)(?:[^\d]*(\d+)\s*мин)?/))) {
      const h = num(m[1]) + (m[3] ? Number(m[3]) / 60 : 0);
      if (h > 0 && h <= 16) out.push({ cmd: `sleep_${tenths(h)}`, label: `Сон: ${tenths(h).replace("-", ",")} ч` });
    } else if (/вес|вешу|взвесил/.test(p) && (m = p.match(/(\d+[.,]?\d*)/))) {
      const kg = num(m[1]);
      if (kg >= 30 && kg <= 300) out.push({ cmd: `weight_${tenths(kg)}`, label: `Вес: ${tenths(kg).replace("-", ",")} кг` });
    } else if (/настроени/.test(p) && (m = p.match(/\b([1-5])\b/))) {
      out.push({ cmd: `mood_${m[1]}`, label: `Настроение: ${m[1]} из 5` });
    } else if (/энерги/.test(p) && (m = p.match(/\b([1-5])\b/))) {
      out.push({ cmd: `energy_${m[1]}`, label: `Энергия: ${m[1]} из 5` });
    } else if ((m = p.match(/(\d+)\s*(ккал|калори)/))) {
      const k = Number(m[1]);
      if (k > 0 && k <= 5000) out.push({ cmd: `meal_${k}`, label: `Еда: ${k} ккал` });
    } else if (/(получил|заработал|зарплат|доход|пришл[оа]|премия|аванс)/.test(p) && (m = p.match(/(\d[\d\s]*)/))) {
      const a = Math.round(num(m[1]));
      if (a > 0) out.push({ cmd: `inc_${a}`, label: `Доход: ${a} ₽` });
    } else if (/(потратил|потратила|расход|купил|купила|заплатил|заплатила|оплатил|ушло)/.test(p) && (m = p.match(/(\d[\d\s]*)/))) {
      const a = Math.round(num(m[1]));
      const cat = (CAT_WORDS.find(([, re]) => re.test(p)) || ["other"])[0];
      if (a > 0) out.push({ cmd: cat === "other" ? `exp_${a}` : `exp_${a}_${cat}`, label: `Расход: ${a} ₽ · ${CATS[cat]}` });
    }
  }
  return out;
}

// Ответ ИИ (JSON) → те же команды, с проверкой границ. ИИ может ошибиться, поэтому проверяем всё.
export function entriesFromAI(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const v = Number(it?.value);
    switch (it?.type) {
      case "steps": if (v >= 0 && v <= 200000) out.push({ cmd: `steps_${Math.round(v)}`, label: `Шаги: ${Math.round(v)}` }); break;
      case "water_ml": if (v > 0 && v <= 5000) out.push({ cmd: `water_${Math.round(v)}`, label: `Вода: +${Math.round(v)} мл` }); break;
      case "sleep_hours": if (v > 0 && v <= 16) out.push({ cmd: `sleep_${tenths(v)}`, label: `Сон: ${tenths(v).replace("-", ",")} ч` }); break;
      case "weight_kg": if (v >= 30 && v <= 300) out.push({ cmd: `weight_${tenths(v)}`, label: `Вес: ${tenths(v).replace("-", ",")} кг` }); break;
      case "mood": case "energy": if (v >= 1 && v <= 5) out.push({ cmd: `${it.type}_${Math.round(v)}`, label: `${it.type === "mood" ? "Настроение" : "Энергия"}: ${Math.round(v)} из 5` }); break;
      case "meal_kcal": if (v > 0 && v <= 5000) out.push({ cmd: `meal_${Math.round(v)}`, label: `Еда: ${Math.round(v)} ккал` }); break;
      case "income": if (v > 0) out.push({ cmd: `inc_${Math.round(v)}`, label: `Доход: ${Math.round(v)} ₽` }); break;
      case "expense": {
        if (!(v > 0)) break;
        const cat = CATS[it.category] ? it.category : "other";
        out.push({ cmd: cat === "other" ? `exp_${Math.round(v)}` : `exp_${Math.round(v)}_${cat}`, label: `Расход: ${Math.round(v)} ₽ · ${CATS[cat]}` });
        break;
      }
      case "task": {
        const t = String(it.text || "").trim().slice(0, 200);
        if (t) out.push({ cmd: "task_" + b64url(t), label: `Задача: ${t}` });
        break;
      }
    }
  }
  return out;
}

export const AI_EXTRACT_PROMPT =
  "Извлеки из сообщения записи для личного трекера. Верни только JSON-массив объектов {\"type\",\"value\",\"category\",\"text\"}. " +
  "type: steps (число шагов), water_ml (вода в миллилитрах), sleep_hours (часы сна), weight_kg, mood (1-5), energy (1-5), meal_kcal, " +
  "income (рубли), expense (рубли; category одно из food, cafe, home, transport, subs, health, other), task (text — формулировка задачи). " +
  "Не выдумывай: если в сообщении нет таких данных, верни []. Вопросы и разговор — это [].";

// ---- события календаря из чата: «завтра в 12:00 поликлиника» ----
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот"];
const MONTHS = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const pad2 = (n) => String(n).padStart(2, "0");

// Текущие дата и время в часовом поясе человека.
export function localNow(tz, now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
// Местные дата и время → момент в мс (UTC).
export function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (t) => { const l = localNow(tz, t); return Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - t; };
  let at = guess - off(guess);
  at = guess - off(at);
  return at;
}
const addDays = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`; };

export function parseEvent(text, tz = "Europe/Moscow", now = Date.now()) {
  const src = String(text || "").trim();
  const low = src.toLowerCase().replace(/ё/g, "е");
  const tm = low.match(/(?:^|\s)в\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:час\S*|ч\b))?(?:\s*(утра|дня|вечера|ночи))?(?=\s|$|[,.!])/) || low.match(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$|[,.!])/);
  if (!tm) return null;
  let hh = +tm[1];
  const mm = tm[2] ? +tm[2] : 0;
  if (tm[3] && /дня|вечера/.test(tm[3]) && hh < 12) hh += 12;
  if (hh > 23 || mm > 59) return null;
  const time = `${pad2(hh)}:${pad2(mm)}`;
  const n = localNow(tz, now);
  let date = null, dayWords = [];
  let m;
  if (/послезавтра/.test(low)) { date = addDays(n.y, n.m, n.d, 2); dayWords.push(/послезавтра/); }
  else if (/завтра/.test(low)) { date = addDays(n.y, n.m, n.d, 1); dayWords.push(/завтра/); }
  else if (/сегодня/.test(low)) { date = addDays(n.y, n.m, n.d, 0); dayWords.push(/сегодня/); }
  else if ((m = low.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/)) && !/\d{1,2}:\d{2}/.test(m[0])) {
    const dd = +m[1], mo = +m[2];
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : n.y;
    if (!m[3] && (mo < n.m || (mo === n.m && dd < n.d))) y++;
    if (dd >= 1 && dd <= 31 && mo >= 1 && mo <= 12) { date = `${y}-${pad2(mo)}-${pad2(dd)}`; dayWords.push(new RegExp(m[0].replace(/[./]/g, "\\$&"))); }
  } else if ((m = low.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})[а-я]*`)))) {
    const dd = +m[1], mo = MONTHS.findIndex((x) => new RegExp("^" + x).test(m[2])) + 1;
    let y = n.y;
    if (mo < n.m || (mo === n.m && dd < n.d)) y++;
    date = `${y}-${pad2(mo)}-${pad2(dd)}`; dayWords.push(new RegExp(m[0]));
  } else {
    const wd = WEEKDAYS.findIndex((w) => low.includes(w));
    if (wd >= 0) {
      let diff = (wd - n.wd + 7) % 7;
      if (diff === 0) diff = 7;
      date = addDays(n.y, n.m, n.d, diff); dayWords.push(new RegExp(`(во?\\s+)?${WEEKDAYS[wd]}[а-я]*`));
    }
  }
  if (!date) {
    // только время: сегодня, а если уже прошло — завтра
    date = hh * 60 + mm > n.hh * 60 + n.mm ? addDays(n.y, n.m, n.d, 0) : addDays(n.y, n.m, n.d, 1);
  }
  let title = low.replace(tm[0], " ");
  for (const re of dayWords) title = title.replace(re, " ");
  title = title
    .replace(/(напомни(те)?( мне)?|мне (нужно|надо)|я (должен|должна)|нужно|надо|запиши|поставь|в календарь|событие|встреча в|у меня)/g, " ")
    .replace(/^\s*(пойти|сходить|поехать)\s+/, "")
    .replace(/\s+[,.:-]+\s*|[,.:]+$/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!title) title = "Событие";
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title: title.slice(0, 120), date, time, at: zonedToUtc(date, time, tz) };
}

export const eventCmd = (e) => "event_" + b64url(JSON.stringify({ t: e.title, d: e.date, h: e.time }));
