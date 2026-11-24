// Время намаза и кибла. Расчёт локальный, библиотека adhan (MIT), без внешних запросов.
import { Coordinates, CalculationMethod, PrayerTimes, Madhab, HighLatitudeRule, Qibla } from "adhan";
import tzlookup from "@photostructure/tz-lookup";
import { t as tr } from "./i18n.js";

// Методы расчёта, которые пользователь может выбрать в настройках.
// Названия методов на языках лежат в i18n.js.
export const METHODS = {
  mwl: { make: () => CalculationMethod.MuslimWorldLeague() },
  turkey: { make: () => CalculationMethod.Turkey() },
  karachi: { make: () => CalculationMethod.Karachi() },
  ummalqura: { make: () => CalculationMethod.UmmAlQura() },
  egypt: { make: () => CalculationMethod.Egyptian() },
  isna: { make: () => CalculationMethod.NorthAmerica() },
};
export const DEFAULT_METHOD = "mwl";
export const DEFAULT_MADHAB = "hanafi"; // в СНГ большинство следует ханафитскому мазхабу; меняется в настройках

export const KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

export const timezoneFor = (lat, lon) => tzlookup(lat, lon);

export function computeTimes({ lat, lon, method = DEFAULT_METHOD, madhab = DEFAULT_MADHAB }, date = new Date()) {
  const coords = new Coordinates(lat, lon);
  const params = (METHODS[method] || METHODS[DEFAULT_METHOD]).make();
  params.madhab = madhab === "shafi" ? Madhab.Shafi : Madhab.Hanafi;
  // Для северных широт (Москва летом и т.п.) Иша и Фаджр иначе могут не наступать.
  params.highLatitudeRule = HighLatitudeRule.recommended(coords);
  return new PrayerTimes(coords, date, params);
}

const fmt = (d, tz, loc) => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
const fmtDate = (d, tz, loc) => new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", timeZone: tz }).format(d);
const localNoon = (now, tz) => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now) + "T12:00:00Z");

// Данные для приложения (Mini App) и для текста бота.
export function timesData({ lat, lon, method, madhab }, now = new Date()) {
  const tz = timezoneFor(lat, lon);
  const pt = computeTimes({ lat, lon, method, madhab }, localNoon(now, tz));
  const times = Object.fromEntries(KEYS.map((k) => [k, pt[k].toISOString()]));
  const next = KEYS.filter((k) => k !== "sunrise").find((k) => pt[k] > now) || null;
  return { tz, times, next, qibla: Qibla(new Coordinates(lat, lon)) };
}

export function timesText(user, now = new Date()) {
  const L = tr(user.lang);
  const tz = user.tz || timezoneFor(user.lat, user.lon);
  const d = timesData(user, now);
  const lines = [`🕌 <b>${L.timesTitle} ${fmtDate(now, tz, L.locale)}</b>`, ""];
  for (const k of KEYS) lines.push(`${k === "sunrise" ? "🌅" : k === d.next ? "▶️" : "•"} ${L.names[k]} — <b>${fmt(new Date(d.times[k]), tz, L.locale)}</b>`);
  if (d.next) {
    const mins = Math.round((new Date(d.times[d.next]) - now) / 60000);
    lines.push("", `⏳ ${L.until} ${L.names[d.next]}: ${Math.floor(mins / 60)} ${L.h} ${mins % 60} ${L.m}`);
  }
  lines.push("", `<i>${L.methodLine(L.methods[user.method] || L.methods.mwl, user.madhab === "shafi", tz)}</i>`);
  return lines.join("\n");
}

const ARROWS = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];

export function qiblaText(user) {
  const L = tr(user.lang);
  const deg = Qibla(new Coordinates(user.lat, user.lon));
  const i = Math.round(deg / 45) % 8;
  return [`🧭 <b>${L.qiblaTitle}: ${deg.toFixed(0)}°</b> ${ARROWS[i]}`, "", L.qiblaDir(L.dirs[i]), L.qiblaHow].join("\n");
}
