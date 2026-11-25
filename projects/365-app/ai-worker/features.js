// Похвала за записи, закономерности в данных человека, челленджи шагов с друзьями.
// Всё считается кодом по реальным данным из приложения (таблица days) и записям из чата (inbox). ИИ здесь не нужен.
import { localNow } from "./parse.js";

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (l) => `${l.y}-${pad2(l.m)}-${pad2(l.d)}`;
const sp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const liters = (ml) => String(Math.round(ml / 100) / 10).replace(".", ",");
export const DEFAULT_GOALS = { water: 2500, steps: 8000, sleep: 480 };

async function userTz(env, userId) {
  const u = await env.DB.prepare("SELECT tz, goals FROM users WHERE id = ?").bind(userId).first();
  let goals = DEFAULT_GOALS;
  try { goals = { ...DEFAULT_GOALS, ...(JSON.parse(u?.goals || "{}") || {}) }; } catch {}
  return { tz: u?.tz || "Europe/Moscow", goals };
}

// ---- синхронизация дней из приложения ----
export async function saveDays(env, userId, days, goals) {
  const ok = (Array.isArray(days) ? days : []).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.d)).slice(-31);
  const n = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : null);
  const stmts = ok.map((d) => env.DB.prepare(
    `INSERT INTO days (user_id, date, sleep, water, steps, mood, energy, spend, cafe, kcal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET sleep = excluded.sleep, water = excluded.water, steps = excluded.steps, mood = excluded.mood,
       energy = excluded.energy, spend = excluded.spend, cafe = excluded.cafe, kcal = excluded.kcal`
  ).bind(userId, d.d, n(d.sleep), n(d.water), n(d.steps), n(d.mood), n(d.energy), n(d.spend), n(d.cafe), n(d.kcal)));
  const g = goals && typeof goals === "object" ? { water: n(goals.water) || DEFAULT_GOALS.water, steps: n(goals.steps) || DEFAULT_GOALS.steps, sleep: n(goals.sleep) || DEFAULT_GOALS.sleep } : null;
  if (g) stmts.push(env.DB.prepare("UPDATE users SET goals = ?, synced_at = ? WHERE id = ?").bind(JSON.stringify(g), Date.now(), userId));
  else stmts.push(env.DB.prepare("UPDATE users SET synced_at = ? WHERE id = ?").bind(Date.now(), userId));
  if (stmts.length) await env.DB.batch(stmts);
  return ok.length;
}

// Сегодняшние значения: то, что прислало приложение, плюс записи из чата, которые оно ещё не забрало.
async function todayState(env, userId, tz, now) {
  const today = ymd(localNow(tz, now));
  const day = (await env.DB.prepare("SELECT * FROM days WHERE user_id = ? AND date = ?").bind(userId, today).first()) || {};
  // записи, которые приложение ещё не забрало (забранные уже входят в данные приложения)
  const rows = (await env.DB.prepare("SELECT cmd, ts FROM inbox WHERE user_id = ? AND done = 0 AND ts > ? ORDER BY id").bind(userId, now - 2 * 86400000).all()).results || [];
  let water = day.water || 0, steps = day.steps || 0, sleep = day.sleep || 0;
  for (const r of rows) {
    if (ymd(localNow(tz, r.ts)) !== today) continue;
    const [k, v] = r.cmd.split("_");
    const num = parseFloat(String(v).replace("-", "."));
    if (k === "water") water += num;
    if (k === "steps") steps = num; // в приложении шаги заменяются последним значением
    if (k === "sleep") sleep = Math.round(num * 60);
  }
  return { water, steps, sleep };
}

// ---- 3. похвала и прогресс к цели после записи ----
export async function praise(env, userId, cmds, now = Date.now()) {
  if (!env.DB) return "";
  const { tz, goals } = await userTz(env, userId);
  const st = await todayState(env, userId, tz, now);
  const kinds = new Set(cmds.map((c) => c.split("_")[0]));
  const out = [];
  if (kinds.has("water")) {
    const left = goals.water - st.water;
    out.push(left <= 0 ? `🎉 Норма воды на сегодня выполнена: ${liters(st.water)} л!` : `💧 Сегодня около ${liters(st.water)} из ${liters(goals.water)} л. Осталось ${Math.ceil(left / 250)} стак.`);
  }
  if (kinds.has("steps")) {
    const left = goals.steps - st.steps;
    out.push(left <= 0 ? `🏆 ${sp(st.steps)} шагов — цель ${sp(goals.steps)} выполнена!` : `👟 ${sp(st.steps)} из ${sp(goals.steps)} шагов. Осталось ${sp(left)}, это примерно ${Math.max(5, Math.round(left / 100 / 5) * 5)} минут ходьбы.`);
  }
  if (kinds.has("sleep")) {
    out.push(st.sleep >= goals.sleep ? `😴 Отлично выспались, цель ${goals.sleep / 60} ч выполнена!` : `😴 Цель — ${goals.sleep / 60} ч. Сегодня постарайтесь лечь на ${Math.max(15, Math.round((goals.sleep - st.sleep) / 15) * 15)} минут раньше.`);
  }
  return out.join("\n");
}

// ---- 4. закономерности в данных человека ----
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export async function insights(env, userId, now = Date.now(), { patterns = true, days: span = 30 } = {}) {
  const { tz, goals } = await userTz(env, userId);
  const today = localNow(tz, now);
  const from = ymd(localNow(tz, now - span * 86400000));
  const rows = ((await env.DB.prepare("SELECT * FROM days WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date").bind(userId, from, ymd(today)).all()).results) || [];
  const has = (k) => rows.filter((r) => r[k] != null && r[k] > 0);
  const found = [];
  const compare = (key, splitFn, labelA, labelB, metric, fmt, unit) => {
    const A = rows.filter((r) => r[key] != null && r[metric] != null && splitFn(r[key]) === "a").map((r) => r[metric]);
    const B = rows.filter((r) => r[key] != null && r[metric] != null && splitFn(r[key]) === "b").map((r) => r[metric]);
    if (A.length < 3 || B.length < 3) return;
    const a = avg(A), b = avg(B);
    const base = Math.max(Math.min(a, b), 1);
    if (Math.abs(a - b) / base < 0.25) return;
    found.push({ score: Math.abs(a - b) / base, text: `${labelA} ${fmt(a)}${unit}, а ${labelB} — ${fmt(b)}${unit} (дней: ${A.length} и ${B.length}).` });
  };
  const sleepSplit = (m) => (m < 360 ? "a" : m >= 420 ? "b" : null);
  compare("sleep", sleepSplit, "В дни, когда вы спите меньше 6 часов, расходы в среднем", "когда спите 7+ часов", "spend", sp, " ₽");
  compare("sleep", sleepSplit, "После сна меньше 6 часов вы проходите в среднем", "после 7+ часов", "steps", sp, " шагов");
  compare("sleep", sleepSplit, "После короткого сна (меньше 6 ч) настроение в среднем", "после 7+ часов", "mood", (x) => x.toFixed(1).replace(".", ","), " из 5");
  compare("steps", (s) => (s < 5000 ? "a" : s >= 8000 ? "b" : null), "В дни меньше 5 000 шагов настроение", "в дни 8 000+ шагов", "mood", (x) => x.toFixed(1).replace(".", ","), " из 5");
  compare("sleep", sleepSplit, "После короткого сна траты в кафе", "после 7+ часов", "cafe", sp, " ₽");
  found.sort((x, y) => y.score - x.score);

  const lines = [];
  const sl = has("sleep"), wt = has("water"), stp = has("steps");
  if (sl.length >= 3) lines.push(`😴 Сон: в среднем ${(avg(sl.map((r) => r.sleep)) / 60).toFixed(1).replace(".", ",")} ч за ${sl.length} дн. (цель ${goals.sleep / 60} ч).`);
  if (stp.length >= 3) lines.push(`👟 Шаги: в среднем ${sp(avg(stp.map((r) => r.steps)))}, цель выполнена в ${stp.filter((r) => r.steps >= goals.steps).length} из ${stp.length} дн.`);
  if (wt.length >= 3) lines.push(`💧 Вода: норма выполнена в ${wt.filter((r) => r.water >= goals.water).length} из ${wt.length} дн.`);
  const spendDays = rows.filter((r) => r.spend > 0);
  if (spendDays.length >= 7) {
    const byWd = Array.from({ length: 7 }, () => []);
    for (const r of spendDays) byWd[new Date(r.date + "T12:00:00Z").getUTCDay()].push(r.spend);
    const names = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
    const best = byWd.map((a, i) => [a.length >= 2 ? avg(a) : 0, i]).sort((x, y) => y[0] - x[0])[0];
    if (best[0] > 0) lines.push(`💸 Больше всего вы тратите в ${names[best[1]]}: в среднем ${sp(best[0])} ₽.`);
  }
  if (!rows.length || (!lines.length && !found.length)) {
    return span === 7 ? "" : "📈 Пока мало данных для выводов. Записывайте сон, шаги и расходы хотя бы неделю и откройте приложение, чтобы я увидел данные. Потом напишите /insights ещё раз.";
  }
  const parts = [span === 7 ? "📈 Ваша неделя" : "📈 Что видно в ваших данных за последние 30 дней", "", ...lines];
  if (!patterns) {
    if (found.length) parts.push("", `🔍 В ваших данных есть закономерности (${found.length}) — например, как сон влияет на расходы и шаги. Они доступны в подписке ⭐ Plus.`);
    return parts.join("\n");
  }
  if (found.length) parts.push("", "🔍 Закономерности:", ...found.slice(0, 3).map((f) => "• " + f.text), "", "Это совпадения в ваших днях, не обязательно причина и следствие. Но присмотреться стоит.");
  else parts.push("", "Явных закономерностей пока нет: нужно больше дней, где записаны и сон, и шаги или расходы.");
  return parts.join("\n");
}

// ---- 5. челлендж шагов с друзьями ----
const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ABC[b % CODE_ABC.length]).join("");

export async function createChallenge(env, userId, days = 7, now = Date.now()) {
  const { tz } = await userTz(env, userId);
  const start = ymd(localNow(tz, now));
  const end = ymd(localNow(tz, now + (days - 1) * 86400000));
  const code = newCode();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO challenges (code, owner_id, start_date, end_date, started_at, ends_at, announced) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(code, userId, start, end, now, now + days * 86400000),
    env.DB.prepare("INSERT OR IGNORE INTO challenge_members (code, user_id, joined_at) VALUES (?, ?, ?)").bind(code, userId, now),
  ]);
  return { code, start, end };
}

export async function joinChallenge(env, userId, code, now = Date.now()) {
  const ch = await env.DB.prepare("SELECT * FROM challenges WHERE code = ?").bind(code).first();
  if (!ch) return { error: "Челлендж не найден. Попросите друга прислать ссылку ещё раз." };
  if (ch.ends_at < now) return { error: "Этот челлендж уже закончился. Создайте свой: /challenge" };
  const n = (await env.DB.prepare("SELECT COUNT(*) c FROM challenge_members WHERE code = ?").bind(code).first()).c;
  if (n >= 50) return { error: "В этом челлендже уже 50 участников." };
  await env.DB.prepare("INSERT OR IGNORE INTO challenge_members (code, user_id, joined_at) VALUES (?, ?, ?)").bind(code, userId, now).run();
  return { ch };
}

// Шаги участника за период: данные приложения по дням плюс ещё не забранные записи из чата.
async function stepsFor(env, userId, startMs, endMs) {
  const { tz } = await userTz(env, userId);
  // период челленджа в днях по времени этого участника
  const start = ymd(localNow(tz, startMs)), end = ymd(localNow(tz, endMs - 1));
  const perDay = {};
  for (const r of (await env.DB.prepare("SELECT date, steps FROM days WHERE user_id = ? AND date BETWEEN ? AND ?").bind(userId, start, end).all()).results || []) perDay[r.date] = r.steps || 0;
  // записи из чата, ещё не забранные приложением, заменяют значение дня (последняя побеждает, как в приложении)
  for (const r of (await env.DB.prepare("SELECT cmd, ts FROM inbox WHERE user_id = ? AND done = 0 AND cmd LIKE 'steps_%' ORDER BY id").bind(userId).all()).results || []) {
    const d = ymd(localNow(tz, r.ts));
    if (d >= start && d <= end) perDay[d] = parseInt(r.cmd.slice(6), 10) || 0;
  }
  return Object.values(perDay).reduce((s, x) => s + x, 0);
}

export async function leaderboard(env, code) {
  const ch = await env.DB.prepare("SELECT * FROM challenges WHERE code = ?").bind(code).first();
  if (!ch) return null;
  const members = (await env.DB.prepare("SELECT m.user_id, u.first_name, u.premium_until FROM challenge_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.code = ?").bind(code).all()).results || [];
  const rows = [];
  for (const m of members) rows.push({ id: m.user_id, name: (m.first_name || "Участник") + ((m.premium_until || 0) > Date.now() ? " ⭐" : ""), steps: await stepsFor(env, m.user_id, ch.started_at || ch.ends_at - 7 * 86400000, ch.ends_at) });
  rows.sort((a, b) => b.steps - a.steps);
  return { ch, rows };
}

const MEDALS = ["🥇", "🥈", "🥉"];
export const boardText = (b, title) =>
  [title, `${b.ch.start_date.slice(8)}.${b.ch.start_date.slice(5, 7)} — ${b.ch.end_date.slice(8)}.${b.ch.end_date.slice(5, 7)}`, "",
    ...b.rows.map((r, i) => `${MEDALS[i] || `${i + 1}.`} ${r.name} — ${sp(r.steps)} шагов`)].join("\n");

export async function myChallenge(env, userId, now = Date.now()) {
  return env.DB.prepare("SELECT c.code FROM challenges c JOIN challenge_members m ON m.code = c.code WHERE m.user_id = ? AND c.ends_at > ? ORDER BY c.ends_at DESC LIMIT 1").bind(userId, now).first();
}

// Закончившиеся челленджи: один раз рассылаем итоги всем участникам.
export async function finishChallenges(env, send, now = Date.now()) {
  const done = (await env.DB.prepare("SELECT code FROM challenges WHERE ends_at <= ? AND announced = 0 LIMIT 20").bind(now).all()).results || [];
  for (const { code } of done) {
    await env.DB.prepare("UPDATE challenges SET announced = 1 WHERE code = ?").bind(code).run();
    const b = await leaderboard(env, code);
    if (!b || !b.rows.length) continue;
    const text = boardText(b, `🏁 Челлендж закончился! Победитель — ${b.rows[0].name} 🎉`) + "\n\nНовый челлендж: /challenge";
    for (const r of b.rows) await send(r.id, text).catch(() => {});
  }
  return done.length;
}
