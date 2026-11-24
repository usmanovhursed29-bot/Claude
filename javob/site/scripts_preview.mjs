import { writeFileSync } from "node:fs";
import { pages } from "./content/pages.js";
import { renderParts, textSection, STYLE, FONTS } from "./src/template.js";
// Превью для показа: все страницы на одной, ссылки ведут на якоря, форма не отправляет.
const { body } = renderParts(pages[0]);
const privacy = pages.find((p) => p.path === "/privacy");
let html = body
  .replaceAll('href="/#', 'href="#')
  .replaceAll('href="/privacy"', 'href="#privacy"')
  .replaceAll('href="/"', 'href="#"')
  .replace("</main>", textSection(privacy).replace('href="/"', 'href="#"') + "</main>")
  .replace('fetch("/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) })', 'Promise.resolve({ ok: true })')
  .replace("Вопрос отправлен. Ответим в течение дня.", "Это превью: на настоящем сайте вопрос сразу придёт вам в Telegram.");
writeFileSync("preview/index.html", `<title>Javob</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>${STYLE}</style>
${html}
`);
console.log("ok");
