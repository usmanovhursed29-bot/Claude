// Отчёт для автора: лучшие идеи сверху, с пометками проверки.
import { readFileSync, existsSync } from "node:fs";
import { verse, countWord } from "./quran.mjs";

const STATUS = { none: "", established: "✅ установленный факт (нужен источник)", debated: "⚠️ спорно в науке", speculative: "❗ натяжка, не выдавать за доказательство" };
const RISK = { low: "низкий", medium: "средний", high: "высокий" };

export function report(file, attribution) {
  if (!existsSync(file)) return "# Идеи\n\nПока пусто.\n";
  const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ideas = rows.flatMap((r) => (r.ideas || []).map((i) => ({ ...i, passage: r.passage, surah: r.surah })));
  ideas.sort((a, b) => b.video_potential - a.video_potential || (a.risk > b.risk ? 1 : -1));
  const errors = rows.filter((r) => r.error);
  const out = [
    "# Идеи для роликов из Корана",
    "",
    `Отрывков разобрано: ${rows.length}, идей: ${ideas.length}, ошибок: ${errors.length}.`,
    "",
    "Перед публикацией каждой идеи: сверить тафсир, подтвердить научный факт источником, пересчитать числа программой (`node run.mjs count`), спорное показать знающему человеку.",
    "",
  ];
  for (const i of ideas) {
    const [s, a] = String(i.ayahs).split(":").map((x) => parseInt(x, 10));
    const v = verse(s, a);
    out.push(
      `## ${"★".repeat(i.video_potential)} ${i.title}`,
      "",
      `**${i.surah}, ${i.ayahs}** · ${i.type} · риск: ${RISK[i.risk]}${i.needs_scholar_review ? " · 🕌 показать знающему человеку" : ""}`,
      "",
      v ? `> ${v.ar}\n>\n> ${v.ru} (${v.s}:${v.a})` : "",
      "",
      `**Хук:** ${i.hook}`,
      "",
      `**Что сказано в аяте:** ${i.text_says}`,
      "",
      `**Классические тафсиры:** ${i.classical_view}`,
      "",
      `**Как применить сегодня:** ${i.modern_application}`,
      ""
    );
    if (i.science?.status && i.science.status !== "none") out.push(`**Наука:** ${i.science.claim} — ${STATUS[i.science.status]}. Проверить: ${i.science.what_to_check}`, "");
    if (i.count_to_verify) out.push(`**Посчитать программой:** ${i.count_to_verify}`, "");
    if (i.risk !== "low") out.push(`**Почему риск:** ${i.risk_reason}`, "");
  }
  if (errors.length) out.push("## Не обработано", "", ...errors.map((e) => `- ${e.passage}: ${e.error}`), "");
  out.push("---", "", attribution, "");
  return out.join("\n");
}

export { countWord };
