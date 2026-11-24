// Анализ Корана: идеи для роликов по каждому отрывку.
//   node run.mjs estimate            — сколько отрывков и примерная цена, без запросов
//   node run.mjs sample 16:68 3      — пробный запуск: 3 отрывка начиная с суры 16, аята 68 (обычные запросы)
//   node run.mjs batch [сура-сура]   — весь Коран (или диапазон сур) пакетом со скидкой 50%
//   node run.mjs collect <batch_id>  — забрать готовые результаты пакета
//   node run.mjs count النحل [ar|ru|en] — точный подсчёт слова по тексту (без ИИ)
// Ключ API: переменная ANTHROPIC_API_KEY (или профиль `ant auth login`). В код ключ не пишется.
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { passages, countWord, ATTRIBUTION } from "./lib/quran.mjs";
import { SYSTEM, MODEL, requestParams } from "./lib/prompt.mjs";
import { report } from "./lib/report.mjs";

const OUT = new URL("./out/", import.meta.url);
const IDEAS = new URL("ideas.jsonl", OUT);
const [cmd = "estimate", ...args] = process.argv.slice(2);
const all = passages();

// Цены Claude Opus 5.5, $ за 1 млн токенов (сверено со справкой 2026-11-03). Пакет — половина цены.
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

function parseIdeas(message) {
  if (message.stop_reason === "refusal") return { error: "refusal" };
  if (message.stop_reason === "max_tokens") return { error: "max_tokens" };
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return { ideas: JSON.parse(text).ideas }; } catch { return { error: "bad_json" }; }
}
function save(p, result, usage) {
  appendFileSync(IDEAS, JSON.stringify({ passage: p.id, surah: p.surahRu, ...result, usage }) + "\n");
}

if (cmd === "estimate") {
  const chars = all.reduce((n, p) => n + p.verses.reduce((m, v) => m + v.ar.length + v.ru.length, 0), 0);
  const inTok = Math.round(chars / 2.6) + all.length * 60; // грубо: ~2.6 символа на токен для арабского и русского
  const sysTok = Math.round(SYSTEM.length / 2.6);
  const outTok = all.length * 3000; // ответ + рассуждение, грубая оценка
  const full = (inTok * PRICE.input + all.length * sysTok * PRICE.cacheRead + outTok * PRICE.output) / 1e6;
  console.log(`Отрывков: ${all.length}. Модель: ${MODEL}.`);
  console.log(`Вход ≈ ${(inTok / 1e6).toFixed(2)} млн токенов, выход ≈ ${(outTok / 1e6).toFixed(2)} млн (оценка).`);
  console.log(`Цена обычными запросами ≈ $${full.toFixed(0)}, пакетом ≈ $${(full / 2).toFixed(0)}. Точная цена видна после пробного запуска (sample).`);
} else if (cmd === "count") {
  const [word, lang = "ar"] = args;
  const r = countWord(word, { lang });
  console.log(`«${word}» (${lang}): ${r.total} раз в ${r.ayahs} аятах`);
  console.log(r.refs.join(", "));
} else if (cmd === "sample") {
  const [start = "16:68", n = "3"] = args;
  const [s, a] = start.split(":").map(Number);
  const i = all.findIndex((p) => p.s === s && a >= p.from && a <= p.to);
  if (i < 0) throw new Error(`Не нашёл отрывок ${start}`);
  const client = new Anthropic();
  let cost = 0;
  for (const p of all.slice(i, i + Number(n))) {
    // Обычный запрос: включаем запасную модель на случай отказа (в пакетах этот параметр недоступен).
    const msg = await client.beta.messages.create({ ...requestParams(p), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    const u = msg.usage;
    cost += ((u.input_tokens) * PRICE.input + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.input * 1.25 + u.output_tokens * PRICE.output) / 1e6;
    const r = parseIdeas(msg);
    save(p, r, u);
    console.log(`${p.id}: ${r.error ? "ошибка " + r.error : r.ideas.length + " идей"} (вход ${u.input_tokens}, кэш ${u.cache_read_input_tokens || 0}, выход ${u.output_tokens})`);
  }
  console.log(`Стоимость пробы ≈ $${cost.toFixed(3)}. Отчёт: out/report.md`);
  writeFileSync(new URL("report.md", OUT), report(IDEAS, ATTRIBUTION));
} else if (cmd === "batch") {
  const [range = "1-114"] = args;
  const [lo, hi] = range.split("-").map(Number);
  const chosen = all.filter((p) => p.s >= lo && p.s <= (hi || lo));
  const client = new Anthropic();
  const batch = await client.messages.batches.create({
    requests: chosen.map((p) => ({ custom_id: p.id.replace(/[:]/g, "_"), params: requestParams(p) })),
  });
  writeFileSync(new URL("batch.json", OUT), JSON.stringify({ id: batch.id, range, count: chosen.length, created: new Date().toISOString() }, null, 2));
  console.log(`Пакет отправлен: ${batch.id}, отрывков: ${chosen.length}. Обычно готов в течение часа (максимум 24 ч).`);
  console.log(`Забрать: node run.mjs collect ${batch.id}`);
} else if (cmd === "collect") {
  const id = args[0] || (existsSync(new URL("batch.json", OUT)) && JSON.parse(readFileSync(new URL("batch.json", OUT))).id);
  const client = new Anthropic();
  const b = await client.messages.batches.retrieve(id);
  if (b.processing_status !== "ended") {
    console.log(`Ещё обрабатывается: готово ${b.request_counts.succeeded}, в работе ${b.request_counts.processing}. Попробуйте позже.`);
  } else {
    const byId = Object.fromEntries(all.map((p) => [p.id.replace(/[:]/g, "_"), p]));
    let ok = 0, bad = 0;
    for await (const r of await client.messages.batches.results(id)) {
      const p = byId[r.custom_id];
      if (r.result.type === "succeeded") { const res = parseIdeas(r.result.message); save(p, res, r.result.message.usage); res.error ? bad++ : ok++; }
      else { save(p, { error: r.result.type }, null); bad++; }
    }
    writeFileSync(new URL("report.md", OUT), report(IDEAS, ATTRIBUTION));
    console.log(`Готово: ${ok} отрывков, ошибок ${bad}. Отчёт: out/report.md, данные: out/ideas.jsonl`);
  }
} else {
  console.log("Команды: estimate | sample <сура:аят> <N> | batch [сура-сура] | collect <batch_id> | count <слово> [ar|ru|en]");
}
