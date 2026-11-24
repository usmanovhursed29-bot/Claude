// Проверка сайта и мини-сторож: node test/run.mjs
// Те же правила потом проверяет ночной сторож на живом сайте.
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { pages } from "../content/pages.js";
import { brand } from "../src/brand.js";

const get = (p) => worker.fetch(new Request("https://javob.test" + p, { redirect: "manual" }));

for (const p of pages) {
  const r = await get(p.path);
  assert.equal(r.status, 200, p.path);
  const t = await r.text();
  assert.match(t, /<title>[^<]+<\/title>/, `${p.path}: title`);
  assert.match(t, /<h1>/, `${p.path}: h1 в сыром HTML`);
  assert.ok(t.includes(`rel="canonical" href="${brand.siteUrl}`), `${p.path}: canonical`);
  assert.ok(t.includes(`${brand.name}<span>.</span>`), `${p.path}: бренд в шапке`);
}

const slash = await get("/privacy/");
assert.equal(slash.status, 301);
assert.equal(slash.headers.get("location"), "https://javob.test/privacy");

assert.equal((await get("/price")).status, 301);
assert.equal((await get("/nope")).status, 404);

const robots = await (await get("/robots.txt")).text();
assert.ok(!/Disallow:\s*\/\s*$/m.test(robots), "robots не закрывает весь сайт");
const sitemap = await (await get("/sitemap.xml")).text();
for (const p of pages) assert.ok(sitemap.includes(`<loc>${brand.siteUrl}${p.path}</loc>`), `sitemap: ${p.path}`);

console.log(`Сайт: все проверки пройдены ✅ (${pages.length} страницы)`);
