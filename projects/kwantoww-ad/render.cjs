// Рендер кадров: node render.cjs <outDir> <fps> [from] [to] [times...]
// Каждый кадр — renderAt(i / fps), состояние полностью считается по времени.
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
(async () => {
  const [outDir, fpsS, fromS, toS, ...list] = process.argv.slice(2);
  const fps = Number(fpsS || 60);
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await p.goto("file://" + path.resolve(__dirname, "ad.html"));
  await p.evaluate(() => window.__ready);
  const times = list.length ? list.map(Number) : null;
  const n0 = Number(fromS || 0), n1 = Number(toS || Math.round(25 * fps));
  const t0 = Date.now();
  const jobs = times ? times.map((t, i) => [t, `probe_${String(i).padStart(2, "0")}_${t}.png`]) : Array.from({ length: n1 - n0 }, (_, k) => [(n0 + k) / fps, `f${String(n0 + k).padStart(5, "0")}.png`]);
  for (const [t, name] of jobs) {
    await p.evaluate((t) => window.renderAt(t), t);
    await p.screenshot({ path: path.join(outDir, name), type: "png" });
  }
  console.log(`frames: ${jobs.length}, ${((Date.now() - t0) / jobs.length).toFixed(0)} ms/frame`);
  await b.close();
})();
