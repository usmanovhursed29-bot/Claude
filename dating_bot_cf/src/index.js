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
const BTN_ADMIN = "🛠 Админка";
const BTN_SWITCH = "🔄 Сменить анкету";
let ADMIN = 0; // ID админа текущего запроса (из env)

// У админа до 5 анкет. Анкета 1 — его настоящий ID, анкеты 2–5 — служебные отрицательные ID.
// Все они помечены «👑 Админ», возраст у всех — как в основной анкете.
const SLOTS = 5;
const slotId = (n) => (n === 1 ? ADMIN : -(9000000000 + n));
const slotNum = (id) => (ADMIN && id === ADMIN ? 1 : id <= -9000000002 && id >= -9000000005 ? -id - 9000000000 : 0);
const isAdminProfile = (id) => !!ADMIN && slotNum(id) > 0;
const adminIds = () => Array.from({ length: SLOTS }, (_, i) => slotId(i + 1));
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

// куда слать уведомление анкете и с какой подписью
const inbox = (id) => isAdminProfile(id)
  ? { chat: ADMIN, pre: `👑 <b>[Анкета ${slotNum(id)}]</b>\n` }
  : { chat: id, pre: "" };

class Bot {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.adminId = Number(env.ADMIN_ID || 0);
    ADMIN = this.adminId;
    this.uid = 0; // кто сейчас пишет боту
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
    if (this.adminId && this.uid === this.adminId) rows.push([{ text: BTN_ADMIN }, { text: BTN_SWITCH }]);
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

// у админа — вечный премиум: безлимит лайков, сообщений и всех функций
const isPremium = (u) => isAdminProfile(u.user_id) || u.premium_until > now();
const premiumUntil = (u) => (isAdminProfile(u.user_id) ? "навсегда (админ)" : `до ${fmtDate(u.premium_until)}`);

function caption(u, extra = "") {
  let t = `<b>${esc(u.name)}</b>, ${u.age}, ${esc(u.city)}${isAdminProfile(u.user_id) ? " 👑 Админ" : isPremium(u) ? " ⭐" : ""}`;
  if (u.about) t += `\n\n${esc(u.about)}`;
  if (extra) t += `\n\n${extra}`;
  return t.slice(0, 1024);
}

const contactLink = (u) =>
  isAdminProfile(u.user_id) && !u.username ? `<a href="tg://user?id=${ADMIN}">${esc(u.name)}</a>` :
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
       ${isAdminProfile(me.user_id) ? `AND u.user_id NOT IN (${adminIds().join(",")})` : ""}
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
      const to = inbox(a.user_id);
      await bot.photo(to.chat, b.photo_id, caption(b, `${to.pre}🎉 <b>Взаимная симпатия!</b>\nПиши: ${contactLink(b)}`));
    }
  } else {
    const n = await pendingCount(bot.db, targetId);
    const to = inbox(targetId);
    await bot.send(to.chat, `${to.pre}💘 Ты кому-то понравился(ась)! Лайков ждут ответа: <b>${n}</b>`,
      ikb([["👀 Посмотреть", "likers"]]));
  }
}

async function startRegistration(bot, chatId, uid, again = false) {
  await setState(bot.db, uid, "reg_name");
  const text = again
    ? "Заполним анкету заново. Как тебя зовут?"
    : "Привет! 👋 Это бот знакомств.\n\nЗаполни анкету — и смотри анкеты других, ставь лайки и знакомься.\n\n" +
      "Правила: будь вежлив, никаких оскорблений, чужих фото и спама. За нарушения — бан. Администрация может просматривать анкеты и лайки для модерации.\n\nКак тебя зовут?";
  return bot.send(chatId, text, removeKb);
}

async function sendPremium(bot, chatId, me) {
  let text = PREMIUM_TEXT;
  const rows = Object.entries(PLANS).map(([code, [days, stars]]) => [[`${days} дней — ${stars} ⭐`, `buy:${code}`]]);
  if (isPremium(me)) {
    text += `\n\n✅ У тебя Премиум <b>${premiumUntil(me)}</b>.`;
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

async function handleRegistration(bot, m, st, uid) {
  const db = bot.db, chat = m.chat.id, text = (m.text || "").trim();
  const d = st.data;
  switch (st.state) {
    case "reg_name":
      if (!text || text.length > 30) return bot.send(chat, "Имя должно быть от 1 до 30 символов.");
      if (slotNum(uid) > 1) {
        const main = await getUser(db, ADMIN);
        if (!main) return bot.send(chat, "Сначала заполни основную анкету (№1).");
        await setState(db, uid, "reg_gender", { ...d, name: text, age: main.age });
        return bot.send(chat, `Возраст — как в основной анкете: ${main.age}.\nКто ты?`, replyKb(["Парень", "Девушка"]));
      }
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
      await bot.photo(chat, nd.photo_id, caption({ ...nd, user_id: uid, premium_until: 0 }));
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
      if (uid === ADMIN) {
        // возраст всех анкет админа всегда совпадает с основной
        await db.prepare(`UPDATE users SET age=? WHERE user_id IN (${adminIds().join(",")})`).bind(d.age).run();
      }
      await bot.send(chat, slotNum(uid) ? `🎉 Анкета №${slotNum(uid)} сохранена!` : "🎉 Анкета сохранена!", bot.mainMenu());
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
      if (isPremium(me)) status += `\n⭐ Премиум ${premiumUntil(me)}`;
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
  const db = bot.db, realUid = m.from.id, chat = m.chat.id, text = m.text || "";
  if (m.chat.type !== "private") return;
  bot.uid = realUid;
  const uid = await actingId(bot, realUid);

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
  if (realUid === bot.adminId && text.startsWith("/")) {
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

  if (bot.adminId && realUid === bot.adminId && (text === BTN_ADMIN || text.startsWith("/admin"))) {
    await clearState(db, uid);
    return adminPanel(bot, chat);
  }
  if (bot.adminId && realUid === bot.adminId && text === BTN_SWITCH) {
    await clearState(db, uid);
    return slotMenu(bot, chat);
  }

  const st = await getState(db, uid);

  // регистрация идёт первой — во время неё меню нет
  if (st.state && st.state.startsWith("reg_")) return handleRegistration(bot, m, st, uid);

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
  const db = bot.db, realUid = cb.from.id, chat = cb.message?.chat.id, data = cb.data || "";
  const [action, arg] = data.split(":");
  const target = Number(arg);
  bot.uid = realUid;
  const uid = await actingId(bot, realUid);

  if (action === "sw") {
    if (!bot.adminId || realUid !== bot.adminId) return bot.answerCb(cb);
    await bot.answerCb(cb);
    return switchSlot(bot, cb, target);
  }

  if (action === "adm") {
    if (!bot.adminId || realUid !== bot.adminId) return bot.answerCb(cb);
    await bot.answerCb(cb);
    return adminAction(bot, cb, data.split(":").slice(1));
  }

  if (action === "ban") {
    if (realUid !== bot.adminId || isAdminProfile(target)) return bot.answerCb(cb);
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

// ================= НЕСКОЛЬКО АНКЕТ АДМИНА =================

async function actingId(bot, realUid) {
  if (!bot.adminId || realUid !== bot.adminId) return realUid;
  const r = await bot.db.prepare("SELECT v FROM kv WHERE k='admin_slot'").first();
  return slotId(Number(r?.v) || 1);
}

async function slotMenu(bot, chat) {
  const cur = slotNum(await actingId(bot, bot.adminId));
  const rows = [];
  for (let n = 1; n <= SLOTS; n++) {
    const u = await getUser(bot.db, slotId(n));
    const label = u ? `${n}. ${u.name}, ${u.city}${u.active ? "" : " 🙈"}` : `${n}. ➕ Создать`;
    rows.push([[`${n === cur ? "✅ " : ""}${label}`, `sw:${n}`]]);
  }
  return bot.send(chat, `🔄 <b>Твои анкеты</b>\nСейчас ты действуешь от анкеты №${cur}.\n\nВсе анкеты помечены «👑 Админ».`, ikb(...rows));
}

async function switchSlot(bot, cb, n) {
  if (!(n >= 1 && n <= SLOTS)) return;
  const db = bot.db, chat = cb.message.chat.id;
  await bot.dropKeyboard(cb);
  if (n > 1 && !(await getUser(db, ADMIN))) return bot.send(chat, "Сначала заполни основную анкету (№1): /start");
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('admin_slot', ?)").bind(String(n)).run();
  const id = slotId(n);
  const u = await getUser(db, id);
  if (!u) {
    await setState(db, id, "reg_name");
    return bot.send(chat, `Анкета №${n} пустая — заполним. Как зовут?`, removeKb);
  }
  await clearState(db, id);
  return bot.photo(chat, u.photo_id, caption(u, `🔄 Теперь ты действуешь от анкеты №${n}`), bot.mainMenu());
}

// ================= АДМИНКА (только для ADMIN_ID) =================

const TZ_OFFSET = 5 * 3600; // время Душанбе (UTC+5)
const fmtDT = (ts) => {
  const d = new Date((ts + TZ_OFFSET) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const PAGE = 15;
const who = (name, age, id) => `<b>${esc(name)}</b> (${age}, <code>${id}</code>)`;
const navRow = (sub, off, total, size = PAGE) => {
  const row = [];
  if (off > 0) row.push(["◀️", `adm:${sub}:${Math.max(0, off - size)}:e`]);
  if (off + size < total) row.push(["▶️", `adm:${sub}:${off + size}:e`]);
  return row;
};
const count = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).first()).c;

async function adminPanel(bot, chat) {
  const db = bot.db;
  const users = await count(db, "SELECT COUNT(*) AS c FROM users");
  const today = await count(db, "SELECT COUNT(*) AS c FROM users WHERE created > ?", now() - 86400);
  const likes = await count(db, "SELECT COUNT(*) AS c FROM likes");
  return bot.send(chat,
    `🛠 <b>Админка</b>\n\n👥 Анкет: <b>${users}</b> (+${today} за сутки)\n❤️ Лайков: <b>${likes}</b>`,
    ikb([["📊 Статистика", "adm:stats"], ["❤️ Кто кого лайкнул", "adm:likes:0"]],
        [["💞 Взаимные пары", "adm:pairs:0"], ["👥 Все анкеты", "adm:prof:0"]],
        [["⚠️ Жалобы", "adm:reps"]]));
}

async function profileCard(bot, chat, u, off, total) {
  const db = bot.db, id = u.user_id;
  const got = await count(db, "SELECT COUNT(*) AS c FROM likes WHERE to_id=?", id);
  const gave = await count(db, "SELECT COUNT(*) AS c FROM likes WHERE from_id=?", id);
  const mutual = await count(db,
    "SELECT COUNT(*) AS c FROM likes a JOIN likes b ON a.from_id=b.to_id AND a.to_id=b.from_id WHERE a.from_id=?", id);
  const reps = await count(db, "SELECT COUNT(*) AS c FROM reports WHERE to_id=?", id);
  const status = u.banned ? "🚫 забанен" : u.active ? "👁 активна" : "🙈 скрыта";
  const g = { m: "парень", f: "девушка" }[u.gender];
  const l = { m: "парней", f: "девушек", any: "всех" }[u.looking];
  let info = `🆔 <code>${id}</code> ${u.username ? "@" + esc(u.username) : ""}\n` +
    `${g}, ищет ${l} • ${status}${isPremium(u) ? " • ⭐" : ""}\n` +
    `❤️ получил: ${got} • поставил: ${gave} • 💞 взаимных: ${mutual}\n` +
    `⚠️ жалоб: ${reps} • 📅 ${fmtDT(u.created)}`;
  if (off !== null) info = `📋 Анкета ${off + 1} из ${total}\n` + info;
  const rows = [];
  if (off !== null) {
    const nav = [];
    if (off > 0) nav.push(["◀️", `adm:prof:${off - 1}`]);
    if (off + 1 < total) nav.push(["▶️", `adm:prof:${off + 1}`]);
    if (nav.length) rows.push(nav);
  }
  rows.push([["❤️ Его лайки", `adm:ul:${id}`], [u.banned ? "✅ Разбанить" : "🚫 Забанить", `adm:ban:${id}:${off ?? -1}`]]);
  return bot.photo(chat, u.photo_id, caption(u, info), ikb(...rows));
}

async function adminAction(bot, cb, [sub, a, b]) {
  const db = bot.db, chat = cb.message.chat.id;
  const off = Number(a) || 0;
  // ◀️▶️ в текстовых списках редактируют то же сообщение
  const out = (text, kb) => b === "e"
    ? bot.api("editMessageText", { chat_id: chat, message_id: cb.message.message_id, text, parse_mode: "HTML", reply_markup: kb })
    : bot.send(chat, text, kb);

  if (sub === "stats") {
    const q = (sql, ...x) => count(db, sql, ...x);
    const t = now();
    const text =
      "📊 <b>Статистика</b>\n\n" +
      `👥 Всего анкет: <b>${await q("SELECT COUNT(*) AS c FROM users")}</b>\n` +
      `👁 Активных: ${await q("SELECT COUNT(*) AS c FROM users WHERE active=1 AND banned=0")}\n` +
      `🙈 Скрытых: ${await q("SELECT COUNT(*) AS c FROM users WHERE active=0 AND banned=0")}\n` +
      `🚫 Забанено: ${await q("SELECT COUNT(*) AS c FROM users WHERE banned=1")}\n\n` +
      `👨 Парней: ${await q("SELECT COUNT(*) AS c FROM users WHERE gender='m'")}\n` +
      `👩 Девушек: ${await q("SELECT COUNT(*) AS c FROM users WHERE gender='f'")}\n` +
      `🧒 14–17 лет: ${await q("SELECT COUNT(*) AS c FROM users WHERE age<18")}\n` +
      `🧑 18+: ${await q("SELECT COUNT(*) AS c FROM users WHERE age>=18")}\n\n` +
      `🆕 Новых за сутки: ${await q("SELECT COUNT(*) AS c FROM users WHERE created > ?", t - 86400)}\n` +
      `🆕 Новых за неделю: ${await q("SELECT COUNT(*) AS c FROM users WHERE created > ?", t - 7 * 86400)}\n\n` +
      `❤️ Лайков всего: ${await q("SELECT COUNT(*) AS c FROM likes")}\n` +
      `❤️ Лайков за сутки: ${await q("SELECT COUNT(*) AS c FROM likes WHERE created > ?", t - 86400)}\n` +
      `💌 С сообщением: ${await q("SELECT COUNT(*) AS c FROM likes WHERE message IS NOT NULL")}\n` +
      `💞 Взаимных пар: ${await q("SELECT COUNT(*) AS c FROM likes a JOIN likes b ON a.from_id=b.to_id AND a.to_id=b.from_id WHERE a.from_id < a.to_id")}\n\n` +
      `⭐ Премиум сейчас: ${await q("SELECT COUNT(*) AS c FROM users WHERE premium_until > ?", t)}\n` +
      `💰 Покупок: ${await q("SELECT COUNT(*) AS c FROM payments")}, звёзд: ${await q("SELECT COALESCE(SUM(stars),0) AS c FROM payments")} ⭐\n` +
      `⚠️ Жалоб: ${await q("SELECT COUNT(*) AS c FROM reports")}\n\n` +
      `🏙 Топ городов:\n` +
      (await db.prepare("SELECT city, COUNT(*) AS c FROM users GROUP BY lower(city) ORDER BY c DESC LIMIT 5").all())
        .results.map((r) => `• ${esc(r.city)} — ${r.c}`).join("\n");
    return bot.send(chat, text);
  }

  if (sub === "likes") {
    const total = await count(db, "SELECT COUNT(*) AS c FROM likes");
    const rows = (await db.prepare(
      `SELECT l.*, a.name AS an, a.age AS aa, b.name AS bn, b.age AS ba,
              EXISTS(SELECT 1 FROM likes r WHERE r.from_id=l.to_id AND r.to_id=l.from_id) AS mutual
       FROM likes l JOIN users a ON a.user_id=l.from_id JOIN users b ON b.user_id=l.to_id
       ORDER BY l.created DESC LIMIT ? OFFSET ?`).bind(PAGE, off).all()).results;
    if (!rows.length) return out("Лайков пока нет.");
    const text = `❤️ <b>Кто кого лайкнул</b> (${off + 1}–${off + rows.length} из ${total})\n\n` + rows.map((r) =>
      `${fmtDT(r.created)} ${who(r.an, r.aa, r.from_id)} → ${who(r.bn, r.ba, r.to_id)}${r.mutual ? " 💞" : ""}` +
      (r.message ? `\n   💌 <i>${esc(r.message.slice(0, 100))}</i>` : "")).join("\n");
    return out(text.slice(0, 4096), ikb(navRow("likes", off, total)));
  }

  if (sub === "pairs") {
    const base = "FROM likes a JOIN likes b ON a.from_id=b.to_id AND a.to_id=b.from_id WHERE a.from_id < a.to_id";
    const total = await count(db, `SELECT COUNT(*) AS c ${base}`);
    const rows = (await db.prepare(
      `SELECT a.from_id AS x, a.to_id AS y, MAX(a.created, b.created) AS t, ux.name AS xn, ux.age AS xa, uy.name AS yn, uy.age AS ya
       ${base.replace("WHERE", "JOIN users ux ON ux.user_id=a.from_id JOIN users uy ON uy.user_id=a.to_id WHERE")}
       ORDER BY t DESC LIMIT ? OFFSET ?`).bind(PAGE, off).all()).results;
    if (!rows.length) return out("Взаимных пар пока нет.");
    const text = `💞 <b>Взаимные пары</b> (${off + 1}–${off + rows.length} из ${total})\n\n` +
      rows.map((r) => `${fmtDT(r.t)} ${who(r.xn, r.xa, r.x)} 💞 ${who(r.yn, r.ya, r.y)}`).join("\n");
    return out(text.slice(0, 4096), ikb(navRow("pairs", off, total)));
  }

  if (sub === "prof") {
    const total = await count(db, "SELECT COUNT(*) AS c FROM users");
    const u = await db.prepare("SELECT * FROM users ORDER BY created DESC LIMIT 1 OFFSET ?").bind(off).first();
    if (!u) return bot.send(chat, "Анкет пока нет.");
    if (cb.message.photo) await bot.dropKeyboard(cb);
    return profileCard(bot, chat, u, off, total);
  }

  if (sub === "user") {
    const u = await getUser(db, off);
    return u ? profileCard(bot, chat, u, null, 0) : bot.send(chat, "Анкета не найдена.");
  }

  if (sub === "ban") {
    const id = off, back = Number(b);
    const u = await getUser(db, id);
    if (!u) return;
    if (isAdminProfile(id)) return bot.send(chat, "Свои анкеты забанить нельзя 🙂");
    const banned = u.banned ? 0 : 1;
    await updateUser(db, id, { banned, active: banned ? 0 : 1 });
    await bot.dropKeyboard(cb);
    await bot.send(chat, banned ? `🚫 ${esc(u.name)} забанен(а).` : `✅ ${esc(u.name)} разбанен(а).`);
    if (banned) await bot.send(id, "🚫 Твой аккаунт заблокирован за нарушение правил.");
    const fresh = await getUser(db, id);
    if (back >= 0) return profileCard(bot, chat, fresh, back, await count(db, "SELECT COUNT(*) AS c FROM users"));
    return profileCard(bot, chat, fresh, null, 0);
  }

  if (sub === "ul") {
    const id = off;
    const u = await getUser(db, id);
    if (!u) return;
    const gave = (await db.prepare(
      `SELECT l.*, u.name, u.age FROM likes l JOIN users u ON u.user_id=l.to_id WHERE l.from_id=? ORDER BY l.created DESC LIMIT 20`
    ).bind(id).all()).results;
    const got = (await db.prepare(
      `SELECT l.*, u.name, u.age FROM likes l JOIN users u ON u.user_id=l.from_id WHERE l.to_id=? ORDER BY l.created DESC LIMIT 20`
    ).bind(id).all()).results;
    const line = (r, uid) => `${fmtDT(r.created)} ${who(r.name, r.age, uid)}` + (r.message ? ` 💌 <i>${esc(r.message.slice(0, 60))}</i>` : "");
    const text = `❤️ <b>Лайки: ${esc(u.name)}</b>\n\n<b>Поставил(а):</b>\n` +
      (gave.map((r) => line(r, r.to_id)).join("\n") || "—") +
      `\n\n<b>Получил(а):</b>\n` + (got.map((r) => line(r, r.from_id)).join("\n") || "—");
    return bot.send(chat, text.slice(0, 4096));
  }

  if (sub === "reps") {
    const rows = (await db.prepare(
      `SELECT r.to_id, COUNT(*) AS c, MAX(r.created) AS t, u.name, u.age, u.banned
       FROM reports r JOIN users u ON u.user_id=r.to_id GROUP BY r.to_id ORDER BY c DESC, t DESC LIMIT 10`
    ).all()).results;
    if (!rows.length) return bot.send(chat, "Жалоб пока нет 👍");
    const text = "⚠️ <b>Больше всего жалоб</b>\n\n" + rows.map((r) =>
      `${r.c}× ${who(r.name, r.age, r.to_id)}${r.banned ? " 🚫" : ""} — посл. ${fmtDT(r.t)}`).join("\n");
    return bot.send(chat, text, ikb(...rows.map((r) => [[`👤 ${r.name} (${r.c})`, `adm:user:${r.to_id}`]])));
  }
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
