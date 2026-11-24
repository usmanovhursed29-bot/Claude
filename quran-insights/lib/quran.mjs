// Текст Корана: пакет quran-json 3.1.2 (лицензия пакета CC-BY-SA 4.0, Risan Bagja Pradana).
// Арабский текст: The Noble Qur'an Encyclopedia (quranenc.com). Транскрипция: tanzil.net.
// Русский перевод смыслов: Эльмир Кулиев (через tanzil.net). ⚠️ Права на перевод принадлежат правообладателю:
// для внутреннего анализа и коротких цитат с указанием автора. Публикацию полного текста согласовывать отдельно.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ar = require("quran-json/dist/quran.json");
const ru = require("quran-json/dist/quran_ru.json");
const en = require("quran-json/dist/quran_en.json");
const tr = require("quran-json/dist/quran_transliteration.json");

export const ATTRIBUTION =
  "Арабский текст: quranenc.com; перевод смыслов: Э. Кулиев; данные: пакет quran-json (CC-BY-SA 4.0).";

// Все аяты одним списком: { s, a, ar, ru, en, tr, surahAr, surahRu }
export const verses = ar.flatMap((sura, i) =>
  sura.verses.map((v, j) => ({
    s: sura.id,
    a: v.id,
    ar: v.text,
    ru: ru[i].verses[j].translation,
    en: en[i].verses[j].translation,
    tr: tr[i].verses[j].transliteration,
    surahAr: sura.name,
    surahRu: ru[i].translation,
  }))
);
export const surahs = ar.map((s, i) => ({ id: s.id, ar: s.name, ru: ru[i].translation, en: en[i].translation, total: s.total_verses }));
export const verse = (s, a) => verses.find((v) => v.s === s && v.a === a) || null;

// Делим Коран на отрывки: внутри одной суры, до maxAyahs аятов и до maxChars символов перевода.
// Отрывок не разрывает суру; один длинный аят может быть отрывком сам по себе.
export function passages({ maxAyahs = 12, maxChars = 2200 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const v of verses) {
    if (cur.length && (cur[0].s !== v.s || cur.length >= maxAyahs || cur.reduce((n, x) => n + x.ru.length, 0) + v.ru.length > maxChars)) flush();
    cur.push(v);
  }
  flush();
  return out.map((vs) => ({
    id: `${vs[0].s}:${vs[0].a}-${vs.at(-1).a}`,
    s: vs[0].s,
    from: vs[0].a,
    to: vs.at(-1).a,
    surahRu: vs[0].surahRu,
    surahAr: vs[0].surahAr,
    verses: vs,
  }));
}

// Точный подсчёт по тексту: только код, никакого ИИ.
// Убираем огласовки и служебные знаки, приводим разные формы алифа к одной.
export function normalizeArabic(s) {
  return s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ـ/g, "")
    .replace(/ى/g, "ي");
}
export function countWord(query, { lang = "ar", whole = false } = {}) {
  const field = lang === "ru" ? "ru" : lang === "en" ? "en" : "ar";
  const q = field === "ar" ? normalizeArabic(query) : query.toLowerCase();
  let total = 0;
  const hits = [];
  for (const v of verses) {
    const text = field === "ar" ? normalizeArabic(v.ar) : v[field].toLowerCase();
    const words = text.split(/[\s.,;:!?«»"()\-—]+/).filter(Boolean);
    const n = words.filter((w) => (whole ? w === q : w.includes(q))).length;
    if (n) { total += n; hits.push(`${v.s}:${v.a}`); }
  }
  return { total, ayahs: hits.length, refs: hits };
}
