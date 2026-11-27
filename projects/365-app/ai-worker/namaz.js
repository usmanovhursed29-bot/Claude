// Уведомления о времени намаза (/namaz): в момент каждого из 5 намазов — сообщение с аятом или хадисом для мотивации.
import { prayerTimes, hm, NAMES, PRAYERS } from "./prayer.js";
import { localNow } from "./parse.js";

export const CITIES = { odintsovo: { name: "Одинцово", lat: 55.6789, lng: 37.2639, tz: "Europe/Moscow" }, moscow: { name: "Москва", lat: 55.7558, lng: 37.6173, tz: "Europe/Moscow" }, dushanbe: { name: "Душанбе", lat: 38.5598, lng: 68.787, tz: "Asia/Dushanbe" } };

// Короткие достоверные тексты с источником (смыслы Корана — по переводу Э. Кулиева).
const COMMON = [
  "«Поистине, намаз предписан верующим в определённое время» — Коран, 4:103",
  "«Ищите помощи в терпении и намазе» — Коран, 2:45",
  "«Воистину, намаз оберегает от мерзости и предосудительного» — Коран, 29:45",
  "«Совершай намаз, чтобы поминать Меня» — Коран, 20:14",
  "«Воистину, преуспели верующие, которые смиренны во время своих намазов» — Коран, 23:1–2",
  "«Оберегайте намазы и средний намаз и стойте перед Аллахом смиренно» — Коран, 2:238",
  "Пророк ﷺ спросил: «Если у двери кого-то из вас течёт река и он купается в ней пять раз в день, останется ли на нём грязь?» Сказали: «Нет». Он сказал: «Таков пример пяти намазов: ими Аллах стирает грехи» — аль-Бухари, 528; Муслим, 667",
  "Пророка ﷺ спросили, какое дело самое любимое для Аллаха. Он ответил: «Намаз, совершённый в своё время» — аль-Бухари, 527; Муслим, 85",
];
const SPECIAL = {
  fajr: ["«Два ракаата перед утренним намазом лучше, чем этот мир и всё, что в нём» — Муслим, 725", "«Кто совершил утренний намаз, тот под защитой Аллаха» — Муслим, 657"],
  asr: ["«Кто совершает два прохладных намаза (утренний и послеполуденный), войдёт в Рай» — аль-Бухари, 574; Муслим, 635"],
  isha: ["«Кто совершил ночной намаз в джамаате — будто простоял половину ночи; а кто совершил и утренний в джамаате — будто простоял всю ночь» — Муслим, 656"],
};
export function motivation(prayer, n) { const pool = [...(SPECIAL[prayer] || []), ...COMMON]; return pool[n % pool.length]; }

const dayParts = (l) => ({ y: l.y, m: l.m, d: l.d, key: `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}` });
const tzOffset = (tz, now) => { const l = localNow(tz, now); return Math.round((Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - Math.floor(now / 60000) * 60000) / 3600000 * 4) / 4; };
export function todayTimes(city, now = Date.now()) {
  const c = CITIES[city] || CITIES.odintsovo, l = localNow(c.tz, now);
  return { city: c, day: dayParts(l), t: prayerTimes(l.y, l.m, l.d, c.lat, c.lng, tzOffset(c.tz, now)), mins: l.hh * 60 + l.mm };
}
export function timesText(city, now = Date.now()) {
  const { city: c, t } = todayTimes(city, now);
  return `🕌 Время намаза сегодня — ${c.name}\n\n` + ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map((k) => `${k === "sunrise" ? "☀️" : "•"} ${NAMES[k]} — ${hm(t[k])}`).join("\n") + "\n\nАср — по ханафитскому мазхабу. Сверяйте с расписанием своей мечети.";
}

export async function namazCommand(env, tg, chatId, id, arg) {
  const city = Object.keys(CITIES).find((k) => arg && (k === arg || CITIES[k].name.toLowerCase() === arg.toLowerCase()));
  await env.DB.prepare("INSERT INTO namaz (user_id, on_, city) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET on_ = 1" + (city ? ", city = excluded.city" : "")).bind(id, city || "odintsovo").run();
  const r = await env.DB.prepare("SELECT * FROM namaz WHERE user_id = ?").bind(id).first();
  return tg("sendMessage", { chat_id: chatId, text: timesText(r.city) + "\n\n🔔 Уведомления включены: в момент каждого намаза пришлю напоминание с аятом или хадисом.",
    reply_markup: { inline_keyboard: [Object.entries(CITIES).map(([k, c]) => ({ text: (k === r.city ? "✓ " : "") + c.name, callback_data: `nz:city:${k}` })), [{ text: "🔕 Выключить", callback_data: "nz:off" }]] } });
}
export async function namazCallback(env, tg, q) {
  const [, k, v] = String(q.data).split(":"), id = q.from.id;
  const answer = (t) => tg("answerCallbackQuery", { callback_query_id: q.id, ...(t ? { text: t } : {}) });
  if (k === "off") { await env.DB.prepare("UPDATE namaz SET on_ = 0 WHERE user_id = ?").bind(id).run(); await answer("Выключено"); return tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: "🔕 Уведомления о намазе выключены. Включить снова: /namaz" }); }
  if (k === "city" && CITIES[v]) { await env.DB.prepare("UPDATE namaz SET city = ?, on_ = 1 WHERE user_id = ?").bind(v, id).run(); await answer(CITIES[v].name); return tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: timesText(v) + "\n\n🔔 Уведомления включены.", reply_markup: { inline_keyboard: [Object.entries(CITIES).map(([kk, c]) => ({ text: (kk === v ? "✓ " : "") + c.name, callback_data: `nz:city:${kk}` })), [{ text: "🔕 Выключить", callback_data: "nz:off" }]] } }); }
  return answer();
}

// Cron раз в минуту: наступил намаз (окно 0–10 минут) — отправить один раз.
export async function sendNamaz(env, tg, now = Date.now()) {
  if (!env.DB) return 0;
  const rows = (await env.DB.prepare("SELECT n.*, u.blocked FROM namaz n LEFT JOIN users u ON u.id = n.user_id WHERE n.on_ = 1 LIMIT 5000").all()).results || [];
  let n = 0;
  for (const r of rows) {
    if (r.blocked) continue;
    const { city, day, t, mins } = todayTimes(r.city, now);
    for (const p of PRAYERS) {
      const at = Math.round(t[p] * 60), tag = `${day.key}:${p}`;
      if (mins < at || mins > at + 10 || r.sent === tag) continue;
      await env.DB.prepare("UPDATE namaz SET sent = ?, count = count + 1 WHERE user_id = ?").bind(tag, r.user_id).run();
      await tg("sendMessage", { chat_id: r.user_id, text: `🕌 Наступило время намаза ${NAMES[p]} — ${hm(t[p])} (${city.name})\n\n${motivation(p, (r.count || 0) + day.d)}` }).catch(() => {});
      n++;
      break;
    }
  }
  return n;
}
