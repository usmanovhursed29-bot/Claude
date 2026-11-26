// node test-journal.mjs — дневник: вопросы по одному, ответы в inbox, только владельцу.
import assert from "node:assert";
import { startJournal, journalAnswer, journalCallback, sendJournal, journalCmd, JOURNAL_Q, isOwner } from "./journal.js";
const kv = new Map(), inbox = [], sent = [];
const env = {
  ADMIN_IDS: "7041620841", APP_URL: "https://app",
  LIMITS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) },
  DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (sql.startsWith("INSERT INTO inbox")) inbox.push(a); }, first: async () => ({ tz: "Asia/Dushanbe", blocked: 0 }) }) }) },
};
const tg = async (m, p) => sent.push(p.text);
assert(isOwner(env, 7041620841) && !isOwner(env, 1));
await startJournal(env, tg, 7041620841, "Asia/Dushanbe", "2026-11-26");
assert.match(sent[0], /26 ноября 2026/); assert.match(sent[1], /^1\/8\. ✨ Хайлайт/);
await journalAnswer(env, tg, 7041620841, "Снял ролик");
assert.equal(inbox.length, 1); assert.equal(inbox[0][1], journalCmd("2026-11-26", "highlight", "Снял ролик"));
await journalCallback(env, tg, 7041620841, "skip"); // пропуск вайба
await journalAnswer(env, tg, 7041620841, "Описание");
const dec = (c) => JSON.parse(Buffer.from(c.slice(8).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
assert.deepEqual(dec(inbox[1][1]), { d: "2026-11-26", k: "desc", v: "Описание" });
for (let i = 3; i < JOURNAL_Q.length; i++) await journalAnswer(env, tg, 7041620841, "ответ " + i);
assert.match(sent.at(-1), /сохранён/); assert.equal(kv.get("jr:7041620841"), undefined);
assert.equal(await journalAnswer(env, tg, 7041620841, "лишнее"), false);
// крон: 21:00 в Душанбе = 16:00 UTC; второй раз в тот же день не начинает
const t = Date.UTC(2026, 10, 27, 16, 5);
assert.equal(await sendJournal(env, tg, t), 1); assert.equal(await sendJournal(env, tg, t + 60000), 0);
assert.equal(await sendJournal(env, tg, Date.UTC(2026, 10, 27, 12, 0)), 0);
console.log("journal ok");
