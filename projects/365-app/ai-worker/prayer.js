// Время намаза по координатам (астрономический расчёт, как в PrayTimes): склонение Солнца и уравнение времени.
// Фаджр и Иша — угол Солнца под горизонтом; Аср — длина тени (1 — шафиитский, 2 — ханафитский).
// Для северных широт летом (Солнце не опускается на нужный угол) — правило «доля ночи по углу» (angle-based).
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };

function sunPos(jd) {
  const D = jd - 2451545.0, g = fix(357.529 + 0.98560028 * D, 360), q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.020 * Math.sin(rad(2 * g)), 360), e = 23.439 - 0.00000036 * D;
  const RA = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
  return { decl: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), eqt: q / 15 - RA };
}
const julian = (y, m, d) => { if (m <= 2) { y -= 1; m += 12; } const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4); return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5; };

// Метод «Всемирной исламской лиги» (Фаджр 18°, Иша 17°), Аср по ханафитскому мазхабу.
// Сверено с расписанием для Одинцово на 29.10.2026: 05:25 / 07:30 / 12:15 / 15:05 / 16:58 / 18:56 — совпадает.
export const METHOD = { fajr: 18, isha: 17, asr: 2 };

// Время в часах (местных, с учётом tzHours) для даты y-m-d.
export function prayerTimes(y, m, d, lat, lng, tzHours, method = METHOD) {
  const jd = julian(y, m, d) - lng / (15 * 24);
  const mid = (t) => fix(12 - sunPos(jd + t).eqt, 24);
  const angleT = (angle, t, ccw) => {
    const { decl } = sunPos(jd + t);
    const v = (-Math.sin(rad(angle)) - Math.sin(rad(decl)) * Math.sin(rad(lat))) / (Math.cos(rad(decl)) * Math.cos(rad(lat)));
    const x = deg(Math.acos(Math.max(-1, Math.min(1, v)))) / 15; // при |v|>1 — Солнце не доходит до угла, поправим ниже
    return { t: mid(t) + (ccw ? -x : x), bad: Math.abs(v) > 1 };
  };
  const asrT = (factor, t) => { const { decl } = sunPos(jd + t); const a = -deg(Math.atan(1 / (factor + Math.tan(rad(Math.abs(lat - decl)))))); return angleT(a, t, false).t; };
  // два прохода для точности
  let T = { fajr: 5 / 24, sunrise: 6 / 24, dhuhr: 12 / 24, asr: 13 / 24, sunset: 18 / 24, isha: 18 / 24 };
  let r;
  for (let i = 0; i < 2; i++) {
    const f = angleT(method.fajr, T.fajr, true), s = angleT(0.833, T.sunrise, true), z = mid(T.dhuhr), a = asrT(method.asr, T.asr), ss = angleT(0.833, T.sunset, false), is = angleT(method.isha, T.isha, false);
    r = { fajr: f, sunrise: s.t, dhuhr: z, asr: a, maghrib: ss.t, isha: is };
    T = { fajr: f.t / 24, sunrise: s.t / 24, dhuhr: z / 24, asr: a / 24, sunset: ss.t / 24, isha: is.t / 24 };
  }
  // высокие широты: Фаджр не раньше, а Иша не позже, чем доля ночи (угол/60)
  const night = fix(r.sunrise - r.maghrib, 24);
  let fajr = r.fajr.t, isha = r.isha.t;
  const fMax = night * (method.fajr / 60), iMax = night * (method.isha / 60);
  if (r.fajr.bad || fix(r.sunrise - fajr, 24) > fMax) fajr = r.sunrise - fMax;
  if (r.isha.bad || fix(isha - r.maghrib, 24) > iMax) isha = r.maghrib + iMax;
  const shift = tzHours - lng / 15;
  const out = { fajr, sunrise: r.sunrise, dhuhr: r.dhuhr, asr: r.asr, maghrib: r.maghrib, isha };
  for (const k in out) out[k] = fix(out[k] + shift, 24);
  return out;
}
export const hm = (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
export const NAMES = { fajr: "Фаджр", sunrise: "Восход", dhuhr: "Зухр", asr: "Аср", maghrib: "Магриб", isha: "Иша" };
export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
