// Telegram-бот знакомств на Cloudflare Workers + D1.
// Анкеты, лента, лайки, сообщения, мэтчи, жалобы, подписка за Telegram Stars.

const MIN_AGE = 14;
const FREE_LIKES_PER_DAY = 25;
const FREE_MESSAGES_PER_DAY = 3;
const SKIP_COOLDOWN = 3 * 24 * 3600; // пропущенная анкета вернётся через 3 дня
// код тарифа: [дней, цена в звёздах]
const PLANS = { w: [7, 50], m: [30, 150], q: [90, 350] };

const BTN_BROWSE = "🔍 Смотреть анкеты";
const BTN_LIKERS = "💘 Кто меня лайкнул";
const BTN_PROFILE = "👤 Моя анкета";
const BTN_PREMIUM = "⭐ Купить подписку";
const BTN_CHAT = "💬 Общий чат";
const MENU_BUTTONS = [BTN_BROWSE, BTN_LIKERS, BTN_PROFILE, BTN_PREMIUM, BTN_CHAT];

const PREMIUM_TEXT =
  "⭐ <b>Премиум</b>\n\n" +
  `• Безлимитные лайки (без подписки — ${FREE_LIKES_PER_DAY} в день)\n` +
  `• Безлимитные сообщения к лайку (без подписки — ${FREE_MESSAGES_PER_DAY} в день)\n` +
  "• Твоя анкета показывается другим чаще\n" +
  "• Твои лайки показываются первыми в «Кто меня лайкнул»\n" +
  "• Фильтры: только мой город и возрастной диапазон\n" +
  "• Кнопка «↩️ Вернуть» — вернуть случайно пропущенную анкету\n" +
  "• Значок ⭐ в анкете\n\n" +
  "Оплата — звёздами Telegram ⭐";

const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])(\S)/g, (_, a, b) => a + b.toUpperCase());

// ================= Telegram API =================

class Bot {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.adminId = Number(env.ADMIN_ID || 0);
    this.chatLink = (env.CHAT_LINK || "").trim();
  }

  async api(method, params) {
    const r = await fetch(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const j = await r.json();
    if (!j.ok) console.log(`TG ${method} error: ${j.description}`);
    return j;
  }

  send(chat_id, text, reply_markup) {
    return this.api("sendMessage", { chat_id, text, parse_mode: "HTML", reply_markup, disable_web_page_preview: true });
  }

  photo(chat_id, photo, caption, reply_markup) {
    return this.api("sendPhoto", { chat_id, photo, caption, parse_mode: "HTML", reply_markup });
  }

  dropKeyboard(cb) {
    return this.api("editMessageReplyMarkup", {
      chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
    });
  }

  answerCb(cb, text, alert = false) {
    return this.api("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  }

  // ---------- клавиатуры ----------
  mainMenu() {
    const rows = [
      [{ text: BTN_BROWSE }, { text: BTN_LIKERS }],
      [{ text: BTN_PROFILE }, { text: BTN_PREMIUM }],
    ];
    if (this.chatLink) rows.push([{ text: BTN_CHAT }]);
    return { keyboard: rows, resize_keyboard: true };
  }
}

const replyKb = (...rows) => ({
  keyboard: rows.map((r) => r.map((text) => ({ text }))),
  resize_keyboard: true,
  one_time_keyboard: true,
});
const removeKb = { remove_keyboard: true };
const ikb = (...rows) => ({
  inline_keyboard: rows.map((r) => r.map(([text, callback_data]) => ({ text, callback_data }))),
});
const feedKb = (uid) =>
  ikb([["❤️", `like:${uid}`], ["💌 Написать", `msg:${uid}`], ["👎", `skip:${uid}`]],
      [["↩️ Вернуть", "undo"], ["⚠️ Жалоба", `rep:${uid}`]]);
const likerKb = (uid) => ikb([["❤️ Взаимно", `lb:${uid}`], ["👎", `ls:${uid}`]], [["⚠️ Жалоба", `rep:${uid}`]]);

// ================= база данных =================

const isPremium = (u) => u.premium_until > now();

function caption(u, extra = "") {
  let t = `<b>${esc(u.name)}</b>, ${u.age}, ${esc(u.city)}${isPremium(u) ? " ⭐" : ""}`;
  if (u.about) t += `\n\n${esc(u.about)}`;
  if (extra) t += `\n\n${extra}`;
  return t.slice(0, 1024);
}

const contactLink = (u) =>
  u.username ? `@${esc(u.username)}` : `<a href="tg://user?id=${u.user_id}">${esc(u.name)}</a>`;

async function getUser(db, id) {
  return db.prepare("SELECT * FROM users WHERE user_id=?").bind(id).first();
}
async function activeUser(db, id) {
  const u = await getUser(db, id);
  return u && !u.banned ? u : null;
}
async function updateUser(db, id, fields) {
  const keys = Object.keys(fields);
  await db.prepare(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE user_id=?`)
    .bind(...keys.map((k) => fields[k]), id).run();
}

async function getState(db, id) {
  const r = await db.prepare("SELECT state, data FROM fsm WHERE user_id=?").bind(id).first();
  return r ? { state: r.state, data: JSON.parse(r.data) } : { state: null, data: {} };
}
async function setState(db, id, state, data = {}) {
  await db.prepare("INSERT OR REPLACE INTO fsm (user_id, state, data) VALUES (?,?,?)")
    .bind(id, state, JSON.stringify(data)).run();
}
async function clearState(db, id) {
  await db.prepare("DELETE FROM fsm WHERE user_id=?").bind(id).run();
}

// Несовершеннолетние видят только сверстников ±2 года, взрослые — только взрослых.
function ageBounds(u) {
  if (u.age < 18) return [Math.max(14, u.age - 2), Math.min(17, u.age + 2)];
  let lo = 18, hi = 99;
  if (isPremium(u)) {
    if (u.f_age_min) lo = Math.max(18, u.f_age_min);
    if (u.f_age_max) hi = u.f_age_max;
  }
  return [lo, hi];
}

async function nextCandidate(db, me) {
  const [lo, hi] = ageBounds(me);
  const cityOnly = isPremium(me) && me.f_city_only ? 1 : 0;
  return db.prepare(
    `SELECT * FROM users u
     WHERE u.active=1 AND u.banned=0 AND u.user_id != ?1
       AND (?2='any' OR u.gender=?2)
       AND (u.looking='any' OR u.looking=?3)
       AND u.age BETWEEN ?4 AND ?5
       AND (?6=0 OR lower(u.city)=lower(?7))
       AND u.user_id NOT IN (
         SELECT to_id FROM views WHERE from_id=?1 AND (action!='skip' OR created > ?8))
     ORDER BY (lower(u.city)=lower(?7)) DESC, (u.premium_until > ?9) DESC, RANDOM()
     LIMIT 1`
  ).bind(me.user_id, me.looking, me.gender, lo, hi, cityOnly, me.city, now() - SKIP_COOLDOWN, now()).first();
}

async function setView(db, from, to, action) {
  await db.prepare("INSERT OR REPLACE INTO views (from_id, to_id, action, created) VALUES (?,?,?,?)")
    .bind(from, to, action, now()).run();
}

async function markResponded(db, from, to) {
  await db.prepare("UPDATE likes SET responded=1 WHERE from_id=? AND to_id=?").bind(from, to).run();
}

// true — если лайк взаимный
async function addLike(db, from, to, message) {
  await db.prepare("INSERT OR REPLACE INTO likes (from_id, to_id, message, responded, created) VALUES (?,?,?,0,?)")
    .bind(from, to, message, now()).run();
  await setView(db, from, to, "like");
  const back = await db.prepare("SELECT 1 AS x FROM likes WHERE from_id=? AND to_id=?").bind(to, from).first();
  if (back) {
    await db.prepare("UPDATE likes SET responded=1 WHERE (from_id=?1 AND to_id=?2) OR (from_id=?2 AND to_id=?1)")
      .bind(from, to).run();
    return true;
  }
  return false;
}

async function likesToday(db, id, withMessage = false) {
  const sql = "SELECT COUNT(*) AS c FROM likes WHERE from_id=? AND created > ?" + (withMessage ? " AND message IS NOT NULL" : "");
  return (await db.prepare(sql).bind(id, now() - 86400).first()).c;
}

async function pendingCount(db, id) {
  return (await db.prepare(
    `SELECT COUNT(*) AS c FROM likes l JOIN users u ON u.user_id=l.from_id
     WHERE l.to_id=? AND l.responded=0 AND u.active=1 AND u.banned=0`
  ).bind(id).first()).c;
}

async function nextPendingLike(db, id) {
  return db.prepare(
    `SELECT u.*, l.message AS like_message FROM likes l JOIN users u ON u.user_id=l.from_id
     WHERE l.to_id=? AND l.responded=0 AND u.active=1 AND u.banned=0
     ORDER BY (u.premium_until > ?) DESC, l.created ASC LIMIT 1`
  ).bind(id, now()).first();
}

// ================= логика =================

async function showNext(bot, chatId, me) {
  const c = await nextCandidate(bot.db, me);
  if (!c) {
    return bot.send(chatId, "😔 Анкеты закончились. Загляни чуть позже — люди регистрируются каждый день!", bot.mainMenu());
  }
  return bot.photo(chatId, c.photo_id, caption(c), feedKb(c.user_id));
}

async function showLiker(bot, chatId, userId) {
  const me = await activeUser(bot.db, userId);
  if (!me) return bot.send(chatId, "Сначала заполни анкету: /start");
  const l = await nextPendingLike(bot.db, userId);
  if (!l) return bot.send(chatId, "Пока новых лайков нет. Листай анкеты — и они появятся! 😉", bot.mainMenu());
  const n = await pendingCount(bot.db, userId);
  let extra = `💘 Ты понравился(ась) этому человеку! (ещё в очереди: ${n - 1})`;
  if (l.like_message) extra += `\n\n💌 Сообщение: <i>${esc(l.like_message)}</i>`;
  return bot.photo(chatId, l.photo_id, caption(l, extra), likerKb(l.user_id));
}

async function checkLimit(db, me, withMessage) {
  if (isPremium(me)) return null;
  if ((await likesToday(db, me.user_id)) >= FREE_LIKES_PER_DAY)
    return `Лимит ${FREE_LIKES_PER_DAY} лайков в день исчерпан. С ⭐ Премиумом — без ограничений!`;
  if (withMessage && (await likesToday(db, me.user_id, true)) >= FREE_MESSAGES_PER_DAY)
    return `Лимит ${FREE_MESSAGES_PER_DAY} сообщения в день исчерпан. С ⭐ Премиумом — без ограничений!`;
  return null;
}

async function doLike(bot, me, targetId, message) {
  const target = await activeUser(bot.db, targetId);
  if (!target) return;
  if (await addLike(bot.db, me.user_id, targetId, message)) {
    for (const [a, b] of [[me, target], [target, me]]) {
      await bot.photo(a.user_id, b.photo_id, caption(b, `🎉 <b>Взаимная симпатия!</b>\nПиши: ${contactLink(b)}`));
    }
  } else {
    const n = await pendingCount(bot.db, targetId);
    await bot.send(targetId, `💘 Ты кому-то понравился(ась)! Лайков ждут ответа: <b>${n}</b>`,
      ikb([["👀 Посмотреть", "likers"]]));
  }
}

async function startRegistration(bot, chatId, uid, again = false) {
  await setState(bot.db, uid, "reg_name");
  const text = again
    ? "Заполним анкету заново. Как тебя зовут?"
    : "Привет! 👋 Это бот знакомств.\n\nЗаполни анкету — и смотри анкеты других, ставь лайки и знакомься.\n\n" +
      "Правила: будь вежлив, никаких оскорблений, чужих фото и спама. За нарушения — бан.\n\nКак тебя зовут?";
  return bot.send(chatId, text, removeKb);
}

async function sendPremium(bot, chatId, me) {
  let text = PREMIUM_TEXT;
  const rows = Object.entries(PLANS).map(([code, [days, stars]]) => [[`${days} дней — ${stars} ⭐`, `buy:${code}`]]);
  if (isPremium(me)) {
    text += `\n\n✅ У тебя Премиум до <b>${fmtDate(me.premium_until)}</b>. Покупка продлит срок.`;
    rows.unshift([["⚙️ Фильтры", "f:menu"]]);
  }
  return bot.send(chatId, text, ikb(...rows));
}

function filtersKb(me) {
  const city = me.f_city_only ? "✅" : "❌";
  if (me.age < 18) return ikb([[`Только мой город: ${city}`, "f:city"]]);
  const [lo, hi] = ageBounds(me);
  return ikb([[`Только мой город: ${city}`, "f:city"]], [[`Возраст: ${lo}–${hi}`, "f:ages"]]);
}

// ---------- регистрация ----------

async function handleRegistration(bot, m, st) {
  const db = bot.db, uid = m.from.id, chat = m.chat.id, text = (m.text || "").trim();
  const d = st.data;
  switch (st.state) {
    case "reg_name":
      if (!text || text.length > 30) return bot.send(chat, "Имя должно быть от 1 до 30 символов.");
      await setState(db, uid, "reg_age", { ...d, name: text });
      return bot.send(chat, "Сколько тебе лет?");
    case "reg_age": {
      if (!/^\d+$/.test(text)) return bot.send(chat, "Напиши возраст цифрами, например 17.");
      const age = Number(text);
      if (age < MIN_AGE) return bot.send(chat, `Бот доступен с ${MIN_AGE} лет 🙏`);
      if (age > 99) return bot.send(chat, "Укажи настоящий возраст.");
      await setState(db, uid, "reg_gender", { ...d, age });
      return bot.send(chat, "Кто ты?", replyKb(["Парень", "Девушка"]));
    }
    case "reg_gender":
      if (!["Парень", "Девушка"].includes(text)) return bot.send(chat, "Нажми кнопку ниже 👇", replyKb(["Парень", "Девушка"]));
      await setState(db, uid, "reg_looking", { ...d, gender: text === "Парень" ? "m" : "f" });
      return bot.send(chat, "Кого ищешь?", replyKb(["Парней", "Девушек"], ["Неважно"]));
    case "reg_looking": {
      const map = { "Парней": "m", "Девушек": "f", "Неважно": "any" };
      if (!map[text]) return bot.send(chat, "Нажми кнопку ниже 👇", replyKb(["Парней", "Девушек"], ["Неважно"]));
      await setState(db, uid, "reg_city", { ...d, looking: map[text] });
      return bot.send(chat, "Из какого ты города?", removeKb);
    }
    case "reg_city":
      if (text.length < 2 || text.length > 40) return bot.send(chat, "Название города — от 2 до 40 символов.");
      await setState(db, uid, "reg_about", { ...d, city: titleCase(text) });
      return bot.send(chat, "Расскажи о себе: увлечения, кого ищешь, чем занимаешься (до 500 символов).",
        replyKb(["Пропустить"]));
    case "reg_about": {
      if (!m.text) return bot.send(chat, "Напиши текстом ✍️");
      const about = text === "Пропустить" ? "" : text;
      if (about.length > 500) return bot.send(chat, `Слишком длинно (${about.length}). Максимум 500 символов.`);
      await setState(db, uid, "reg_photo", { ...d, about });
      return bot.send(chat, "Теперь пришли своё фото 📸", removeKb);
    }
    case "reg_photo": {
      if (!m.photo) return bot.send(chat, "Нужно именно фото (не файл и не видео) 📸");
      const nd = { ...d, photo_id: m.photo[m.photo.length - 1].file_id };
      await setState(db, uid, "reg_confirm", nd);
      await bot.photo(chat, nd.photo_id, caption({ ...nd, premium_until: 0 }));
      return bot.send(chat, "Так выглядит твоя анкета. Всё верно?", replyKb(["✅ Да", "✏️ Заново"]));
    }
    case "reg_confirm":
      if (text !== "✅ Да") return startRegistration(bot, chat, uid, true);
      await db.prepare(
        `INSERT INTO users (user_id, username, name, age, gender, looking, city, about, photo_id, created)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, name=excluded.name, age=excluded.age,
           gender=excluded.gender, looking=excluded.looking, city=excluded.city, about=excluded.about,
           photo_id=excluded.photo_id, active=1`
      ).bind(uid, m.from.username || null, d.name, d.age, d.gender, d.looking, d.city, d.about, d.photo_id, now()).run();
      await clearState(db, uid);
      await bot.send(chat, "🎉 Анкета сохранена!", bot.mainMenu());
      if (!m.from.username) {
        await bot.send(chat, "💡 Совет: поставь себе @username в настройках Telegram — так при взаимной симпатии тебе точно смогут написать.");
      }
  }
}

// ---------- меню ----------

async function handleMenu(bot, m, me) {
  const chat = m.chat.id, db = bot.db;
  switch (m.text) {
    case BTN_BROWSE:
      if (!me.active) {
        await updateUser(db, me.user_id, { active: 1 });
        me.active = 1;
        await bot.send(chat, "👁 Твоя анкета снова видна другим.");
      }
      return showNext(bot, chat, me);
    case BTN_LIKERS:
      return showLiker(bot, chat, me.user_id);
    case BTN_PROFILE: {
      let status = me.active ? "👁 видна другим" : "🙈 скрыта";
      if (isPremium(me)) status += `\n⭐ Премиум до ${fmtDate(me.premium_until)}`;
      return bot.photo(chat, me.photo_id, caption(me, `Статус: ${status}`), ikb(
        [["✏️ Заполнить заново", "p:redo"]],
        [["🖼 Сменить фото", "p:photo"], ["📝 Сменить текст", "p:about"]],
        [me.active ? ["🙈 Скрыть анкету", "p:hide"] : ["👁 Показать анкету", "p:show"]],
      ));
    }
    case BTN_PREMIUM:
      return sendPremium(bot, chat, me);
    case BTN_CHAT:
      if (!bot.chatLink) return bot.send(chat, "Общий чат пока не настроен.");
      return bot.send(chat, "💬 Общий чат знакомств — общайся, пиши, кто тебе понравился.\nБудь вежлив: за оскорбления и спам — бан.",
        { inline_keyboard: [[{ text: "Перейти в чат", url: bot.chatLink }]] });
  }
}

// ---------- сообщения ----------

async function onMessage(bot, m) {
  const db = bot.db, uid = m.from.id, chat = m.chat.id, text = m.text || "";
  if (m.chat.type !== "private") return;

  if (m.successful_payment) {
    const sp = m.successful_payment;
    const [days, stars] = PLANS[sp.invoice_payload.split(":").pop()];
    const u = await getUser(db, uid);
    const until = Math.max(u.premium_until, now()) + days * 86400;
    await updateUser(db, uid, { premium_until: until });
    await db.prepare("INSERT INTO payments VALUES (?,?,?,?,?)").bind(uid, sp.telegram_payment_charge_id, stars, days, now()).run();
    return bot.send(chat, `⭐ Спасибо! Премиум активен до <b>${fmtDate(until)}</b>.`, bot.mainMenu());
  }

  // команды
  if (text.startsWith("/start")) {
    await clearState(db, uid);
    const u = await getUser(db, uid);
    if (u && u.banned) return bot.send(chat, "🚫 Твой аккаунт заблокирован за нарушение правил.");
    if (u) {
      await updateUser(db, uid, { username: m.from.username || null });
      return bot.send(chat, `С возвращением, ${esc(u.name)}! 👋`, bot.mainMenu());
    }
    return startRegistration(bot, chat, uid);
  }
  if (text.startsWith("/help")) {
    return bot.send(chat, "/start — главное меню\n/paysupport — помощь с оплатой\n\nЛистай анкеты: ❤️ — лайк, 💌 — лайк с сообщением, 👎 — дальше.\nПри взаимном лайке бот пришлёт вам контакты друг друга.");
  }
  if (text.startsWith("/paysupport")) {
    return bot.send(chat, "Вопросы по оплате: напиши администратору бота. Возврат звёзд — в течение 7 дней после покупки.");
  }
  if (uid === bot.adminId && text.startsWith("/")) {
    const parts = text.split(/\s+/);
    if (parts[0] === "/stats") {
      const q = async (sql, ...b) => (await db.prepare(sql).bind(...b).first()).c;
      return bot.send(chat,
        `👥 Анкет: ${await q("SELECT COUNT(*) AS c FROM users WHERE banned=0")}\n` +
        `👁 Активных: ${await q("SELECT COUNT(*) AS c FROM users WHERE active=1 AND banned=0")}\n` +
        `⭐ Премиум: ${await q("SELECT COUNT(*) AS c FROM users WHERE premium_until > ?", now())}\n` +
        `❤️ Лайков: ${await q("SELECT COUNT(*) AS c FROM likes")}`);
    }
    if (parts[0] === "/unban" && /^\d+$/.test(parts[1] || "")) {
      await updateUser(db, Number(parts[1]), { banned: 0, active: 1 });
      return bot.send(chat, "✅ Разбанен");
    }
    if (parts[0] === "/refund" && parts.length === 3) {
      const r = await bot.api("refundStarPayment", { user_id: Number(parts[1]), telegram_payment_charge_id: parts[2] });
      if (r.ok) await updateUser(db, Number(parts[1]), { premium_until: 0 });
      return bot.send(chat, r.ok ? "✅ Звёзды возвращены, премиум снят." : `Ошибка: ${esc(r.description)}`);
    }
  }

  const st = await getState(db, uid);

  // регистрация идёт первой — во время неё меню нет
  if (st.state && st.state.startsWith("reg_")) return handleRegistration(bot, m, st);

  const me = await activeUser(db, uid);
  if (!me) {
    const u = await getUser(db, uid);
    if (u && u.banned) return bot.send(chat, "🚫 Твой аккаунт заблокирован за нарушение правил.");
    return bot.send(chat, "Нажми /start, чтобы создать анкету.");
  }

  if (MENU_BUTTONS.includes(text)) {
    await clearState(db, uid);
    return handleMenu(bot, m, me);
  }

  if (["write", "edit_photo", "edit_about", "edit_ages"].includes(st.state) && text === "Отмена") {
    await clearState(db, uid);
    await bot.send(chat, "Отменено.", bot.mainMenu());
    if (st.state === "write") return showNext(bot, chat, me);
    return;
  }

  switch (st.state) {
    case "write": {
      if (!m.text) return bot.send(chat, "Отправь текстом ✍️ или нажми «Отмена».");
      await clearState(db, uid);
      await doLike(bot, me, st.data.target, text.trim().slice(0, 300));
      await bot.send(chat, "✅ Отправлено!", bot.mainMenu());
      return showNext(bot, chat, me);
    }
    case "edit_photo":
      if (!m.photo) return bot.send(chat, "Нужно именно фото 📸");
      await updateUser(db, uid, { photo_id: m.photo[m.photo.length - 1].file_id });
      await clearState(db, uid);
      return bot.send(chat, "✅ Фото обновлено!", bot.mainMenu());
    case "edit_about": {
      if (!m.text) return bot.send(chat, "Напиши текстом ✍️");
      const about = text.trim();
      if (about.length > 500) return bot.send(chat, `Слишком длинно (${about.length}). Максимум 500 символов.`);
      await updateUser(db, uid, { about });
      await clearState(db, uid);
      return bot.send(chat, "✅ Текст обновлён!", bot.mainMenu());
    }
    case "edit_ages": {
      const parts = text.replace(/–/g, "-").replace(/\s/g, "").split("-");
      if (parts.length !== 2 || !parts.every((p) => /^\d+$/.test(p))) return bot.send(chat, "Формат: 18-25");
      let [lo, hi] = parts.map(Number).sort((a, b) => a - b);
      lo = Math.max(18, lo); hi = Math.min(99, hi);
      await updateUser(db, uid, { f_age_min: lo, f_age_max: hi });
      await clearState(db, uid);
      return bot.send(chat, `✅ Буду показывать анкеты ${lo}–${hi} лет.`, bot.mainMenu());
    }
  }

  return bot.send(chat, "Выбери действие в меню 👇", bot.mainMenu());
}

// ---------- кнопки под сообщениями ----------

async function onCallback(bot, cb) {
  const db = bot.db, uid = cb.from.id, chat = cb.message?.chat.id, data = cb.data || "";
  const [action, arg] = data.split(":");
  const target = Number(arg);

  if (action === "ban") {
    if (uid !== bot.adminId) return bot.answerCb(cb);
    await updateUser(db, target, { banned: 1, active: 0 });
    await bot.dropKeyboard(cb);
    await bot.answerCb(cb, "Забанен");
    return bot.send(target, "🚫 Твой аккаунт заблокирован за нарушение правил.");
  }

  if (action === "buy") {
    await bot.answerCb(cb);
    if (!PLANS[arg]) return;
    const [days, stars] = PLANS[arg];
    return bot.api("sendInvoice", {
      chat_id: chat,
      title: `Премиум на ${days} дней`,
      description: "Безлимит лайков и сообщений, фильтры, возврат анкет, приоритет в ленте.",
      payload: `premium:${arg}`,
      currency: "XTR",
      prices: [{ label: `Премиум ${days} дн.`, amount: stars }],
    });
  }

  const me = await activeUser(db, uid);
  if (!me) return bot.answerCb(cb, "Сначала заполни анкету: /start", true);

  switch (action) {
    case "like": {
      const limit = await checkLimit(db, me, false);
      if (limit) return bot.answerCb(cb, limit, true);
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb, "❤️");
      await doLike(bot, me, target, null);
      return showNext(bot, chat, me);
    }
    case "msg": {
      const limit = await checkLimit(db, me, true);
      if (limit) return bot.answerCb(cb, limit, true);
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb);
      await setState(db, uid, "write", { target });
      return bot.send(chat, "💌 Напиши сообщение — оно придёт вместе с лайком (до 300 символов):", replyKb(["Отмена"]));
    }
    case "skip":
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb);
      await setView(db, uid, target, "skip");
      return showNext(bot, chat, me);
    case "undo": {
      if (!isPremium(me)) return bot.answerCb(cb, "↩️ Возврат анкеты доступен с ⭐ Премиумом", true);
      const last = await db.prepare("SELECT to_id FROM views WHERE from_id=? AND action='skip' ORDER BY created DESC LIMIT 1")
        .bind(uid).first();
      const prev = last ? await activeUser(db, last.to_id) : null;
      if (!prev) return bot.answerCb(cb, "Нечего возвращать", true);
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb);
      await db.prepare("DELETE FROM views WHERE from_id=? AND to_id=?").bind(uid, prev.user_id).run();
      return bot.photo(chat, prev.photo_id, caption(prev), feedKb(prev.user_id));
    }
    case "rep": {
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb, "Жалоба отправлена. Спасибо!", true);
      await db.prepare("INSERT INTO reports VALUES (?,?,?)").bind(uid, target, now()).run();
      await setView(db, uid, target, "report");
      await markResponded(db, target, uid);
      const t = await getUser(db, target);
      if (bot.adminId && t) {
        await bot.photo(bot.adminId, t.photo_id, caption(t, `⚠️ Жалоба от ${uid} на ${target}`), ikb([["🚫 Забанить", `ban:${target}`]]));
      }
      return showNext(bot, chat, me);
    }
    case "likers":
      await bot.answerCb(cb);
      return showLiker(bot, chat, uid);
    case "lb":
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb, "❤️");
      await doLike(bot, me, target, null);
      return showLiker(bot, chat, uid);
    case "ls":
      await bot.dropKeyboard(cb);
      await bot.answerCb(cb);
      await markResponded(db, target, uid);
      await setView(db, uid, target, "skip");
      return showLiker(bot, chat, uid);
    case "p":
      await bot.answerCb(cb);
      if (arg === "redo") return startRegistration(bot, chat, uid, true);
      if (arg === "photo") {
        await setState(db, uid, "edit_photo");
        return bot.send(chat, "Пришли новое фото 📸", replyKb(["Отмена"]));
      }
      if (arg === "about") {
        await setState(db, uid, "edit_about");
        return bot.send(chat, "Напиши новый текст о себе (до 500 символов):", replyKb(["Отмена"]));
      }
      if (arg === "hide" || arg === "show") {
        await updateUser(db, uid, { active: arg === "show" ? 1 : 0 });
        await bot.dropKeyboard(cb);
        return bot.send(chat, arg === "show" ? "👁 Анкета снова видна другим."
          : "🙈 Анкета скрыта. Чтобы вернуть — нажми «Смотреть анкеты».", bot.mainMenu());
      }
      return;
    case "f": {
      if (!isPremium(me)) return bot.answerCb(cb, "Фильтры доступны с ⭐ Премиумом", true);
      await bot.answerCb(cb);
      if (arg === "menu") return bot.send(chat, "⚙️ Фильтры ленты:", filtersKb(me));
      if (arg === "city") {
        me.f_city_only = me.f_city_only ? 0 : 1;
        await updateUser(db, uid, { f_city_only: me.f_city_only });
        return bot.api("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: filtersKb(me) });
      }
      if (arg === "ages" && me.age >= 18) {
        await setState(db, uid, "edit_ages");
        return bot.send(chat, "Напиши диапазон возраста через дефис, например <b>18-25</b>:", replyKb(["Отмена"]));
      }
      return;
    }
  }
  return bot.answerCb(cb);
}

async function onPreCheckout(bot, q) {
  const code = q.invoice_payload.split(":").pop();
  const ok = q.invoice_payload.startsWith("premium:") && PLANS[code] && q.total_amount === PLANS[code][1];
  return bot.api("answerPreCheckoutQuery", {
    pre_checkout_query_id: q.id, ok: !!ok, error_message: ok ? undefined : "Тариф не найден, попробуй ещё раз.",
  });
}

// ================= вход =================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BOT_TOKEN) return new Response("BOT_TOKEN не задан. Добавь его в Settings → Variables and Secrets.", { status: 500 });

    // Открой https://<адрес-воркера>/setup один раз — бот подключится к Telegram.
    if (url.pathname === "/setup") {
      const bot = new Bot(env);
      const r = await bot.api("setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
        drop_pending_updates: true,
      });
      await bot.api("setMyCommands", {
        commands: [
          { command: "start", description: "Главное меню" },
          { command: "help", description: "Помощь" },
          { command: "paysupport", description: "Помощь с оплатой" },
        ],
      });
      const me = await bot.api("getMe", {});
      const msg = r.ok ? `✅ Готово! Бот @${me.result?.username} подключён. Открой его в Telegram и нажми /start.`
        : `❌ Ошибка: ${r.description}. Проверь BOT_TOKEN.`;
      return new Response(msg, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      const bot = new Bot(env);
      try {
        if (update.message) await onMessage(bot, update.message);
        else if (update.callback_query) await onCallback(bot, update.callback_query);
        else if (update.pre_checkout_query) await onPreCheckout(bot, update.pre_checkout_query);
      } catch (e) {
        console.log("Ошибка обработки:", e.stack || e);
      }
      return new Response("ok");
    }

    return new Response("Бот знакомств работает 💘");
  },
};
