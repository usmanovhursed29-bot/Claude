// Встраивает страницу Mini App в код Worker (один файл на выкладку).
import { readFileSync, writeFileSync } from "node:fs";
const body = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
writeFileSync(new URL("./src/app-body.js", import.meta.url), `// Собрано из app/index.html, не править вручную.\nexport default ${JSON.stringify(body)};\n`);
console.log("app-body.js собран");
