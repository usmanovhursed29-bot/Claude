import { writeFileSync } from "node:fs";
import { pages } from "./content/pages.js";
import { renderParts, STYLE, FONTS } from "./src/template.js";
const { title, body } = renderParts(pages[0]);
const fixed = body.replaceAll('href="/#', 'href="#').replaceAll('href="/privacy"', 'href="#contact"').replaceAll('href="/"', 'href="#"');
writeFileSync("preview/index.html",
`<title>Javob</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>${STYLE}</style>
${fixed}
`);
console.log("ok", title);
