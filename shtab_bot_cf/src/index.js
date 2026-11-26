// «Штаб»: команда ИИ-агентов (директор, аналитик, маркетолог, продавец) в Telegram.
// Работает на Cloudflare Workers AI (бесплатный дневной лимит). Только для владельца (ADMIN_ID).
//
// Как это устроено:
//  1. Ты даёшь задачу в Telegram -> она встаёт в очередь (таблица jobs).
//  2. Раз в минуту cron берёт задачу: директор раздаёт поручения, агенты по очереди работают,
//     каждый видит работу предыдущих, директор собирает итог.
//  3. Итог приходит тебе с кнопками. Ничего не публикуется и не тратится без тебя.

// Модели по порядку: если первая недоступна — пробуем следующую.
const MODELS = ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];

const DEFAULT_PROFILE =
  "Я живу в Таджикистане. Я мусульманин — бизнес только халяль: без процентов и кредитов под проценты, " +
  "без азартных игр, алкоголя, обмана. Стартовые деньги — до 50 000 ₽. " +
  "Умею с помощью ИИ делать Telegram-ботов и сайты на Cloudflare (хостинг у меня бесплатный), учусь монтажу видео. " +
  "Могу работать онлайн на Россию и СНГ. Цены и расчёты — в рублях по России.";

const COMMON_RULES =
  "Пиши по-русски, просто и конкретно, без воды. " +
  "Не выдумывай статистику, проценты конверсии, отзывы и результаты клиентов: если цифра — оценка, так и пиши «оценка» и как её проверить. " +
  "Не приписывай продукту функций, которых владелец не называл, и не придумывай «реальные истории» и отзывы — если чего-то не знаешь, пиши «уточнить у владельца». " +
  "Ты работаешь в команде ИИ-агентов на владельца бизнеса. Ничего не публикуешь и не тратишь сам — только готовишь, владелец одобряет. " +
  "Соблюдай ограничения владельца (халяль, бюджет). Пиши обычным текстом: без markdown, без звёздочек и решёток, без таблиц.";

const AGENTS = {
  director: {
    name: "👔 Директор",
    role:
      "Ты — директор маленькой онлайн-компании. Ты ставишь задачи аналитику, маркетологу и продавцу, " +
      "проверяешь их работу и принимаешь решения. Ты требовательный и практичный: тебе нужны действия, " +
      "которые принесут первые деньги быстро и с маленьким бюджетом.",
  },
  analyst: {
    name: "🔎 Аналитик",
    role:
      "Ты — бизнес-аналитик. Оцениваешь спрос, конкурентов, цены и риски. " +
      "Подсказываешь, как проверить спрос бесплатно за 1–3 дня (поиск в Яндекс Вордстат, Авито, Telegram-каналы, маркетплейсы).",
  },
  marketer: {
    name: "📣 Маркетолог",
    role:
      "Ты — маркетолог. Придумываешь, где найти первых клиентов почти без бюджета (Telegram, Reels/TikTok/Shorts, Авито, сарафан), " +
      "пишешь цепляющие заголовки, идеи роликов и рекламные тексты. Строишь воронку: где человек узнаёт → что получает → как покупает.",
  },
  seller: {
    name: "💬 Продавец",
    role:
      "Ты — продавец. Думаешь как клиент: за что он реально заплатит, сколько, какие у него возражения. " +
      "Формулируешь оффер, цену и скрипт продажи в переписке. Честно говоришь, если идея не продаётся.",
  },
};
const WORKERS = ["analyst", "marketer", "seller"];
const ALIASES = { "аналитик": "analyst", "маркетолог": "marketer", "продавец": "seller" };

const TASKS = {
  ideas: (extra) =>
    "Придумайте для меня бизнес, который реально начнёт приносить деньги в ближайшие 2–4 недели. " +
    "Нужно 3 лучших идеи. " + (extra ? `Пожелание владельца: ${extra}. ` : "") +
    "В итоговом ответе оформи каждую идею строго так:\n" +
    "Идея 1: <название>\nЧто продаём и кому: ...\nЦена: ...\nГде взять первых клиентов: ...\n" +
    "Сколько нужно денег на старт: ...\nПервые деньги через: ...\nРиски: ...\n\n" +
    "Идея 2: ... (так же)\n\nИдея 3: ... (так же)\n\nВ конце — какую идею рекомендует директор и почему.",
  launch: (biz) =>
    `Мы выбрали бизнес:\n${biz}\n\n` +
    "Подготовьте план запуска на 7 дней. В итоговом ответе должно быть:\n" +
    "1) Оффер — одной фразой, и цена.\n" +
    "2) Воронка по шагам: где человек нас видит → что получает → как платит.\n" +
    "3) 5 идей для коротких роликов/постов с заголовками.\n" +
    "4) Готовый текст объявления (для Авито или Telegram).\n" +
    "5) Скрипт ответа клиенту в переписке и ответы на 3 главных возражения.\n" +
    "6) План по дням: день 1 … день 7 — что конкретно сделать владельцу.\n" +
    "7) Как понять, что работает: какие цифры смотреть.",
};

const now = () => Math.floor(Date.now() / 1000);

// ================= ИИ =================

function clean(t) {
  return t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\*\s+/gm, "• ")
    .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,!?:;]|$)/g, "$1$2")
    .replace(/Ideя/g, "Идея")
    .trim();
}

function extractText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res.response === "string") return res.response;
  if (typeof res.output_text === "string") return res.output_text;
  if (Array.isArray(res.output)) {
    const parts = [];
    for (const item of res.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) if (c.text) parts.push(c.text);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  if (res.choices?.[0]?.message?.content) return res.choices[0].message.content;
  return "";
}

class LimitError extends Error {}

async function ai(env, system, user, maxTokens = 1800) {
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const res = model.includes("gpt-oss")
        ? await env.AI.run(model, { instructions: system, input: user, reasoning: { effort: "low" } })
        : await env.AI.run(model, {
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            max_tokens: maxTokens,
          });
      const text = clean(extractText(res));
      if (text) return text;
      lastErr = `${model}: пустой ответ`;
    } catch (e) {
      lastErr = `${model}: ${e.message || e}`;
      console.log("AI error", lastErr);
      if (/neuron|daily|limit|4006|quota/i.test(lastErr)) throw new LimitError(lastErr);
    }
  }
  throw new Error(lastErr || "ИИ не ответил");
}

// ================= Команда агентов =================

async function getKV(db, k) {
  return (await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first())?.v ?? null;
}
async function setKV(db, k, v) {
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, v).run();
}

function parseAssignments(plan) {
  const found = {};
  const re = /^[\s*#>\-•]*(аналитик|маркетолог|продавец)[*\s]*[:\-—][*\s]*(.+)$/gim;
  let m;
  while ((m = re.exec(plan))) {
    const key = ALIASES[m[1].toLowerCase()];
    if (key && !found[key]) found[key] = m[2].trim();
  }
  return found;
}

async function runTeam(env, job, onStep) {
  const db = env.DB;
  const profile = (await getKV(db, "profile")) || DEFAULT_PROFILE;
  const business = await getKV(db, "business");
  const context =
    `О владельце: ${profile}\n` + (business && job.kind !== "launch" ? `Текущий выбранный бизнес: ${business}\n` : "");
  const log = [];

  // 1. Директор раздаёт поручения
  const plan = await ai(env,
    `${AGENTS.director.role} ${COMMON_RULES}`,
    `${context}\nЗадача от владельца:\n${job.input}\n\n` +
    "Сейчас НЕ решай задачу сам — только раздай поручения. Ответ — максимум 4 короткие строки, без пояснений:\n" +
    "Цель: <одна фраза>\nАналитик: <поручение, до 30 слов>\nМаркетолог: <поручение, до 30 слов>\nПродавец: <поручение, до 30 слов>\n" +
    "Пропусти сотрудника, если он не нужен.", 300);
  log.push({ agent: "director", text: plan });
  await onStep(log);

  let assignments = parseAssignments(plan);
  if (!Object.keys(assignments).length) {
    for (const w of WORKERS) assignments[w] = job.input;
  }

  // 2. Сотрудники работают по очереди и видят работу коллег
  let teamWork = "";
  for (const w of WORKERS) {
    if (!assignments[w]) continue;
    const out = await ai(env,
      `${AGENTS[w].role} ${COMMON_RULES}`,
      `${context}\nОбщая задача владельца:\n${job.input}\n\nПоручение директора тебе:\n${assignments[w]}\n\n` +
      (teamWork ? `Что уже сделали коллеги:\n${teamWork}\n\n` : "") +
      "Сделай только свою часть по поручению. Опирайся на работу коллег, не повторяй её и не пиши итоговый ответ за директора. До 250 слов.", 1200);
    log.push({ agent: w, text: out });
    teamWork += `\n--- ${AGENTS[w].name} ---\n${out}\n`;
    await onStep(log);
  }

  // 3. Директор собирает итог для владельца
  const final = await ai(env,
    `${AGENTS.director.role} ${COMMON_RULES}`,
    `${context}\nЗадача владельца:\n${job.input}\n\nРабота команды:\n${teamWork}\n\n` +
    "Собери итоговый ответ владельцу. Убери слабое, оставь лучшее, исправь ошибки коллег. " +
    "Выполни все требования к формату из задачи. В самом конце — строка «Следующий шаг: ...» (одно конкретное действие владельца).",
    3000);
  log.push({ agent: "director", text: final });
  return { result: final, log };
}

// ================= Telegram =================

class TG {
  constructor(env) { this.env = env; }
  async api(method, params) {
    const r = await fetch(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
    });
    const j = await r.json();
    if (!j.ok) console.log(`TG ${method}: ${j.description}`);
    return j;
  }
  // без parse_mode: ответы ИИ могут ломать разметку
  async send(chat_id, text, reply_markup) {
    const chunks = [];
    let t = String(text);
    while (t.length > 4000) {
      let cut = t.lastIndexOf("\n", 4000);
      if (cut < 1000) cut = 4000;
      chunks.push(t.slice(0, cut));
      t = t.slice(cut);
    }
    chunks.push(t);
    let last;
    for (let i = 0; i < chunks.length; i++) {
      last = await this.api("sendMessage", {
        chat_id, text: chunks[i], disable_web_page_preview: true,
        reply_markup: i === chunks.length - 1 ? reply_markup : undefined,
      });
    }
    return last;
  }
  answer(cb, text) { return this.api("answerCallbackQuery", { callback_query_id: cb.id, text }); }
}

const BTN_IDEAS = "💡 Найти идею бизнеса";
const BTN_LAUNCH = "🚀 План запуска";
const BTN_PROFILE = "👤 О себе";
const BTN_STATUS = "📋 Задачи";

const menu = {
  keyboard: [[{ text: BTN_IDEAS }, { text: BTN_LAUNCH }], [{ text: BTN_PROFILE }, { text: BTN_STATUS }]],
  resize_keyboard: true,
};
const ikb = (...rows) => ({ inline_keyboard: rows.map((r) => r.map(([text, callback_data]) => ({ text, callback_data }))) });

async function enqueue(env, kind, input, chatId) {
  const r = await env.DB.prepare(
    "INSERT INTO jobs (kind, input, chat_id, created, updated) VALUES (?,?,?,?,?) RETURNING id"
  ).bind(kind, input, chatId, now(), now()).first();
  const ahead = (await env.DB.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending','running') AND id < ?")
    .bind(r.id).first()).c;
  return { id: r.id, ahead };
}

const queuedText = (q) =>
  `👔 Директор собрал совещание (задача №${q.id}).\n` +
  (q.ahead ? `Перед ней в очереди: ${q.ahead}. ` : "") +
  "Команда начнёт в течение минуты, работа займёт 1–3 минуты. Я пришлю результат.";

function extractIdea(text, n) {
  const re = new RegExp(`Идея\\s*${n}\\s*[:.)][\\s\\S]*?(?=Идея\\s*${n + 1}\\s*[:.)]|Директор рекомендует|Рекомендация|Следующий шаг|$)`, "i");
  const m = text.match(re);
  return m ? m[0].trim() : null;
}

async function onMessage(env, tg, m) {
  const chat = m.chat.id, text = (m.text || "").trim();
  const db = env.DB;
  const state = await getKV(db, "state");

  if (text.startsWith("/start")) {
    await setKV(db, "state", "");
    return tg.send(chat,
      "👋 Это твой штаб — команда ИИ-агентов:\n\n" +
      "👔 Директор — раздаёт задачи и собирает итог\n🔎 Аналитик — спрос, конкуренты, цены\n" +
      "📣 Маркетолог — где найти клиентов, ролики, реклама\n💬 Продавец — оффер, цена, скрипт продажи\n\n" +
      "Что умеет:\n• 💡 Найти идею бизнеса — команда предложит 3 идеи, ты выберешь\n" +
      "• 🚀 План запуска — оффер, воронка, тексты и план на 7 дней для выбранного бизнеса\n" +
      "• Любое сообщение — это задача для команды. Например: «Напишите 10 идей роликов» или «Как поднять цену?»\n\n" +
      "Сначала загляни в «👤 О себе» — команда учитывает это во всех задачах.", menu);
  }

  if (text === BTN_PROFILE) {
    await setKV(db, "state", "profile");
    const p = (await getKV(db, "profile")) || DEFAULT_PROFILE;
    return tg.send(chat, `👤 Что команда знает о тебе:\n\n${p}\n\nЧтобы изменить — пришли новый текст целиком. Чтобы оставить — нажми любую кнопку меню.`, menu);
  }
  if (state === "profile" && text && !text.startsWith("/") && ![BTN_IDEAS, BTN_LAUNCH, BTN_STATUS].includes(text)) {
    await setKV(db, "profile", text.slice(0, 2000));
    await setKV(db, "state", "");
    return tg.send(chat, "✅ Запомнил. Команда будет это учитывать.", menu);
  }
  if (state) await setKV(db, "state", "");

  if (text === BTN_IDEAS || text.startsWith("/ideas")) {
    const extra = text.startsWith("/ideas") ? text.slice(6).trim() : "";
    const q = await enqueue(env, "ideas", TASKS.ideas(extra), chat);
    return tg.send(chat, queuedText(q) + "\n\n💡 Совет: можно написать «/ideas что-то связанное с видео», чтобы задать направление.", menu);
  }

  if (text === BTN_LAUNCH) {
    const biz = await getKV(db, "business");
    if (!biz) return tg.send(chat, "Сначала выбери бизнес: нажми «💡 Найти идею бизнеса».", menu);
    const q = await enqueue(env, "launch", TASKS.launch(biz), chat);
    return tg.send(chat, queuedText(q), menu);
  }

  if (text === BTN_STATUS) {
    const rows = (await db.prepare("SELECT id, kind, status, created FROM jobs ORDER BY id DESC LIMIT 10").all()).results;
    const icon = { pending: "⏳", running: "⚙️", done: "✅", error: "❌" };
    const kindName = { ideas: "идеи", launch: "план запуска", task: "задача" };
    const biz = await getKV(db, "business");
    return tg.send(chat,
      (biz ? `🏢 Выбранный бизнес:\n${biz.slice(0, 300)}\n\n` : "") +
      "📋 Последние задачи:\n" + (rows.map((r) => `${icon[r.status]} №${r.id} — ${kindName[r.kind] || r.kind}`).join("\n") || "пока нет"),
      menu);
  }

  if (!text) return tg.send(chat, "Пришли задачу текстом ✍️", menu);
  if (text.startsWith("/")) return tg.send(chat, "Не знаю такую команду. Нажми /start", menu);

  const q = await enqueue(env, "task", text, chat);
  return tg.send(chat, queuedText(q), menu);
}

async function onCallback(env, tg, cb) {
  const db = env.DB, chat = cb.message.chat.id;
  const [action, a, b] = (cb.data || "").split(":");
  await tg.answer(cb);

  if (action === "log") {
    const job = await db.prepare("SELECT log FROM jobs WHERE id=?").bind(Number(a)).first();
    if (!job) return;
    const log = JSON.parse(job.log);
    for (const step of log.slice(0, -1)) {
      await tg.send(chat, `${AGENTS[step.agent].name}:\n\n${step.text}`);
    }
    return;
  }
  if (action === "pick") {
    const job = await db.prepare("SELECT result FROM jobs WHERE id=?").bind(Number(a)).first();
    const idea = job && extractIdea(job.result, Number(b));
    if (!idea) return tg.send(chat, "Не смог найти эту идею в ответе. Напиши её своими словами — я передам команде как задачу.");
    await setKV(db, "business", idea);
    const q = await enqueue(env, "launch", TASKS.launch(idea), chat);
    return tg.send(chat, `✅ Выбрано:\n${idea.slice(0, 500)}\n\n🚀 Команда готовит план запуска.\n${queuedText(q)}`, menu);
  }
  if (action === "more") {
    const q = await enqueue(env, "ideas", TASKS.ideas("предложите другие идеи, не похожие на прошлые"), chat);
    return tg.send(chat, queuedText(q), menu);
  }
  if (action === "redo") {
    const job = await db.prepare("SELECT kind, input FROM jobs WHERE id=?").bind(Number(a)).first();
    if (!job) return;
    const q = await enqueue(env, job.kind, job.input + "\n\nПрошлый вариант владельцу не понравился — сделайте сильнее и конкретнее.", chat);
    return tg.send(chat, queuedText(q), menu);
  }
}

function resultKeyboard(job) {
  const rows = [];
  if (job.kind === "ideas") {
    rows.push([["✅ Идея 1", `pick:${job.id}:1`], ["✅ Идея 2", `pick:${job.id}:2`], ["✅ Идея 3", `pick:${job.id}:3`]]);
    rows.push([["🔄 Другие идеи", "more"]]);
  } else {
    rows.push([["🔄 Переделать", `redo:${job.id}`]]);
  }
  rows.push([["📜 Как команда это обсуждала", `log:${job.id}`]]);
  return ikb(...rows);
}

// ================= Очередь (cron) =================

async function processQueue(env) {
  const db = env.DB;
  // зависшие задачи (больше 10 минут) — возвращаем в очередь, максимум 2 попытки
  await db.prepare("UPDATE jobs SET status='pending' WHERE status='running' AND updated < ? AND attempts < 2").bind(now() - 600).run();
  await db.prepare("UPDATE jobs SET status='error', result='Задача зависла' WHERE status='running' AND updated < ? AND attempts >= 2").bind(now() - 600).run();

  const job = await db.prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 1").first();
  if (!job) return;
  // захватываем задачу (если её уже взял другой запуск — выходим)
  const grab = await db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, updated=? WHERE id=? AND status='pending'")
    .bind(now(), job.id).run();
  if (!grab.meta?.changes) return;

  const tg = new TG(env);
  try {
    const { result, log } = await runTeam(env, job, async (log) => {
      await db.prepare("UPDATE jobs SET log=?, updated=? WHERE id=?").bind(JSON.stringify(log), now(), job.id).run();
    });
    await db.prepare("UPDATE jobs SET status='done', result=?, log=?, updated=? WHERE id=?")
      .bind(result, JSON.stringify(log), now(), job.id).run();
    if (job.chat_id && env.BOT_TOKEN) {
      const title = { ideas: "💡 Идеи бизнеса", launch: "🚀 План запуска", task: "📌 Ответ команды" }[job.kind] || "Готово";
      await tg.send(job.chat_id, `${title} (задача №${job.id})\n\n${result}`, resultKeyboard(job));
    }
  } catch (e) {
    const limit = e instanceof LimitError;
    const msg = limit
      ? "Бесплатный лимит ИИ на сегодня закончился. Задача выполнится автоматически завтра."
      : `Ошибка: ${e.message || e}`;
    console.log("job error", job.id, e.stack || e);
    if (limit) {
      await db.prepare("UPDATE jobs SET status='pending', attempts=0, updated=? WHERE id=?").bind(now(), job.id).run();
    } else {
      await db.prepare("UPDATE jobs SET status='error', result=?, updated=? WHERE id=?").bind(msg, now(), job.id).run();
    }
    if (job.chat_id && env.BOT_TOKEN && (!limit || job.attempts === 0)) await tg.send(job.chat_id, `❌ Задача №${job.id}: ${msg}`);
  }
}

// ================= Вход =================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/setup") {
      if (!env.BOT_TOKEN) return new Response("Добавь BOT_TOKEN в Settings → Variables and Secrets.", { status: 500 });
      const tg = new TG(env);
      const r = await tg.api("setWebhook", {
        url: `${url.origin}/webhook`, secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
      });
      await tg.api("setMyCommands", { commands: [
        { command: "start", description: "Меню штаба" },
        { command: "ideas", description: "Найти идеи бизнеса (можно с пожеланием)" },
      ] });
      const me = await tg.api("getMe", {});
      return new Response(r.ok ? `✅ Готово! Штаб @${me.result?.username} подключён. Открой его в Telegram и нажми /start.`
        : `❌ Ошибка: ${r.description}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const u = await request.json();
      const from = u.message?.from?.id ?? u.callback_query?.from?.id;
      const tg = new TG(env);
      // штаб только для владельца
      if (!from || String(from) !== String(env.ADMIN_ID)) {
        if (u.message) await tg.send(u.message.chat.id, "⛔ Это закрытый бот.");
        return new Response("ok");
      }
      try {
        if (u.message) await onMessage(env, tg, u.message);
        else if (u.callback_query) await onCallback(env, tg, u.callback_query);
      } catch (e) {
        console.log("update error", e.stack || e);
      }
      return new Response("ok");
    }
    return new Response("Штаб работает 🧠");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await setKV(env.DB, "cron_last", String(now()));
      try {
        await processQueue(env);
      } catch (e) {
        await setKV(env.DB, "cron_error", `${now()}: ${e.stack || e}`);
      }
    })());
  },
};
