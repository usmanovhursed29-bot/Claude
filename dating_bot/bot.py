"""Telegram-бот знакомств: анкеты, лента, лайки, сообщения, мэтчи, подписка за Telegram Stars."""
import asyncio
import html
import logging
import os
from datetime import datetime

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from dotenv import load_dotenv

import db

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID") or 0)
CHAT_LINK = os.getenv("CHAT_LINK", "").strip()

MIN_AGE = 14
FREE_LIKES_PER_DAY = 25
FREE_MESSAGES_PER_DAY = 3

# код тарифа: (дней, цена в звёздах)
PLANS = {"w": (7, 50), "m": (30, 150), "q": (90, 350)}

# ---------- тексты кнопок ----------
BTN_BROWSE = "🔍 Смотреть анкеты"
BTN_LIKERS = "💘 Кто меня лайкнул"
BTN_PROFILE = "👤 Моя анкета"
BTN_PREMIUM = "⭐ Купить подписку"
BTN_CHAT = "💬 Общий чат"

PREMIUM_TEXT = (
    "⭐ <b>Премиум</b>\n\n"
    f"• Безлимитные лайки (без подписки — {FREE_LIKES_PER_DAY} в день)\n"
    f"• Безлимитные сообщения к лайку (без подписки — {FREE_MESSAGES_PER_DAY} в день)\n"
    "• Твоя анкета показывается другим чаще\n"
    "• Твои лайки показываются первыми в «Кто меня лайкнул»\n"
    "• Фильтры: только мой город и возрастной диапазон\n"
    "• Кнопка «↩️ Вернуть» — вернуть случайно пропущенную анкету\n"
    "• Значок ⭐ в анкете\n\n"
    "Оплата — звёздами Telegram ⭐"
)

router = Router()


class Reg(StatesGroup):
    name = State()
    age = State()
    gender = State()
    looking = State()
    city = State()
    about = State()
    photo = State()
    confirm = State()


class Edit(StatesGroup):
    about = State()
    photo = State()
    ages = State()


class Write(StatesGroup):
    text = State()


# ---------- клавиатуры ----------

def main_menu() -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text=BTN_BROWSE), KeyboardButton(text=BTN_LIKERS)],
        [KeyboardButton(text=BTN_PROFILE), KeyboardButton(text=BTN_PREMIUM)],
    ]
    if CHAT_LINK:
        rows.append([KeyboardButton(text=BTN_CHAT)])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def reply_kb(*rows: list[str]) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=t) for t in row] for row in rows],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def ikb(*rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=d) for t, d in row] for row in rows]
    )


def feed_kb(uid: int) -> InlineKeyboardMarkup:
    return ikb(
        [("❤️", f"like:{uid}"), ("💌 Написать", f"msg:{uid}"), ("👎", f"skip:{uid}")],
        [("↩️ Вернуть", "undo"), ("⚠️ Жалоба", f"rep:{uid}")],
    )


def liker_kb(uid: int) -> InlineKeyboardMarkup:
    return ikb(
        [("❤️ Взаимно", f"lb:{uid}"), ("👎", f"ls:{uid}")],
        [("⚠️ Жалоба", f"rep:{uid}")],
    )


# ---------- вспомогательное ----------

def caption(u: dict, extra: str = "") -> str:
    star = " ⭐" if db.is_premium(u) else ""
    text = f"<b>{html.escape(u['name'])}</b>, {u['age']}, {html.escape(u['city'])}{star}"
    if u["about"]:
        text += f"\n\n{html.escape(u['about'])}"
    if extra:
        text += f"\n\n{extra}"
    return text[:1024]


def contact_link(u: dict) -> str:
    if u.get("username"):
        return f"@{html.escape(u['username'])}"
    return f'<a href="tg://user?id={u["user_id"]}">{html.escape(u["name"])}</a>'


async def safe_send(bot: Bot, chat_id: int, text: str, **kw) -> None:
    try:
        await bot.send_message(chat_id, text, **kw)
    except (TelegramForbiddenError, TelegramBadRequest):
        pass  # пользователь заблокировал бота


async def drop_keyboard(cb: CallbackQuery) -> None:
    try:
        await cb.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass


async def active_user(user_id: int):
    u = await db.get_user(user_id)
    if not u or u["banned"]:
        return None
    return u


async def show_next(bot: Bot, chat_id: int, me: dict) -> None:
    cand = await db.next_candidate(me)
    if not cand:
        await bot.send_message(
            chat_id,
            "😔 Анкеты закончились. Загляни чуть позже — люди регистрируются каждый день!",
            reply_markup=main_menu(),
        )
        return
    await bot.send_photo(chat_id, cand["photo_id"], caption=caption(cand), reply_markup=feed_kb(cand["user_id"]))


async def notify_like(bot: Bot, to_id: int) -> None:
    n = await db.pending_likes_count(to_id)
    await safe_send(
        bot, to_id,
        f"💘 Ты кому-то понравился(ась)! Лайков ждут ответа: <b>{n}</b>",
        reply_markup=ikb([("👀 Посмотреть", "likers")]),
    )


async def notify_match(bot: Bot, a: dict, b: dict) -> None:
    """a и b понравились друг другу — шлём каждому анкету и контакт второго."""
    for me, other in ((a, b), (b, a)):
        try:
            await bot.send_photo(
                me["user_id"], other["photo_id"],
                caption=caption(other, f"🎉 <b>Взаимная симпатия!</b>\nПиши: {contact_link(other)}"),
            )
        except (TelegramForbiddenError, TelegramBadRequest):
            pass


async def check_like_limit(me: dict, with_message: bool) -> str | None:
    if db.is_premium(me):
        return None
    if await db.likes_today(me["user_id"]) >= FREE_LIKES_PER_DAY:
        return f"Лимит {FREE_LIKES_PER_DAY} лайков в день исчерпан. С ⭐ Премиумом — без ограничений!"
    if with_message and await db.likes_today(me["user_id"], with_message=True) >= FREE_MESSAGES_PER_DAY:
        return f"Лимит {FREE_MESSAGES_PER_DAY} сообщения в день исчерпан. С ⭐ Премиумом — без ограничений!"
    return None


async def do_like(bot: Bot, me: dict, target_id: int, message: str | None) -> None:
    target = await active_user(target_id)
    if not target:
        return
    matched = await db.add_like(me["user_id"], target_id, message)
    if matched:
        await notify_match(bot, me, target)
    else:
        await notify_like(bot, target_id)


# ================= РЕГИСТРАЦИЯ =================

@router.message(CommandStart())
async def cmd_start(m: Message, state: FSMContext) -> None:
    await state.clear()
    u = await db.get_user(m.from_user.id)
    if u and u["banned"]:
        await m.answer("🚫 Твой аккаунт заблокирован за нарушение правил.")
        return
    if u:
        await db.update_user(m.from_user.id, username=m.from_user.username)
        await m.answer(f"С возвращением, {html.escape(u['name'])}! 👋", reply_markup=main_menu())
        return
    await m.answer(
        "Привет! 👋 Это бот знакомств.\n\n"
        "Заполни анкету — и смотри анкеты других, ставь лайки и знакомься.\n\n"
        "Правила: будь вежлив, никаких оскорблений, чужих фото и спама. "
        "За нарушения — бан.\n\n"
        "Как тебя зовут?",
        reply_markup=ReplyKeyboardRemove(),
    )
    await state.set_state(Reg.name)


async def start_registration(m: Message, state: FSMContext) -> None:
    await state.clear()
    await m.answer("Заполним анкету заново. Как тебя зовут?", reply_markup=ReplyKeyboardRemove())
    await state.set_state(Reg.name)


@router.message(Reg.name, F.text)
async def reg_name(m: Message, state: FSMContext) -> None:
    name = m.text.strip()
    if not 1 <= len(name) <= 30:
        await m.answer("Имя должно быть от 1 до 30 символов.")
        return
    await state.update_data(name=name)
    await m.answer("Сколько тебе лет?")
    await state.set_state(Reg.age)


@router.message(Reg.age, F.text)
async def reg_age(m: Message, state: FSMContext) -> None:
    if not m.text.strip().isdigit():
        await m.answer("Напиши возраст цифрами, например 17.")
        return
    age = int(m.text.strip())
    if age < MIN_AGE:
        await m.answer(f"Бот доступен с {MIN_AGE} лет 🙏")
        return
    if age > 99:
        await m.answer("Укажи настоящий возраст.")
        return
    await state.update_data(age=age)
    await m.answer("Кто ты?", reply_markup=reply_kb(["Парень", "Девушка"]))
    await state.set_state(Reg.gender)


@router.message(Reg.gender, F.text.in_({"Парень", "Девушка"}))
async def reg_gender(m: Message, state: FSMContext) -> None:
    await state.update_data(gender="m" if m.text == "Парень" else "f")
    await m.answer("Кого ищешь?", reply_markup=reply_kb(["Парней", "Девушек"], ["Неважно"]))
    await state.set_state(Reg.looking)


@router.message(Reg.gender)
async def reg_gender_bad(m: Message) -> None:
    await m.answer("Нажми кнопку ниже 👇", reply_markup=reply_kb(["Парень", "Девушка"]))


@router.message(Reg.looking, F.text.in_({"Парней", "Девушек", "Неважно"}))
async def reg_looking(m: Message, state: FSMContext) -> None:
    await state.update_data(looking={"Парней": "m", "Девушек": "f", "Неважно": "any"}[m.text])
    await m.answer("Из какого ты города?", reply_markup=ReplyKeyboardRemove())
    await state.set_state(Reg.city)


@router.message(Reg.looking)
async def reg_looking_bad(m: Message) -> None:
    await m.answer("Нажми кнопку ниже 👇", reply_markup=reply_kb(["Парней", "Девушек"], ["Неважно"]))


@router.message(Reg.city, F.text)
async def reg_city(m: Message, state: FSMContext) -> None:
    city = m.text.strip()
    if not 2 <= len(city) <= 40:
        await m.answer("Название города — от 2 до 40 символов.")
        return
    await state.update_data(city=city.title())
    await m.answer(
        "Расскажи о себе: увлечения, кого ищешь, чем занимаешься (до 500 символов).",
        reply_markup=reply_kb(["Пропустить"]),
    )
    await state.set_state(Reg.about)


@router.message(Reg.about, F.text)
async def reg_about(m: Message, state: FSMContext) -> None:
    about = "" if m.text == "Пропустить" else m.text.strip()
    if len(about) > 500:
        await m.answer(f"Слишком длинно ({len(about)}). Максимум 500 символов.")
        return
    await state.update_data(about=about)
    await m.answer("Теперь пришли своё фото 📸", reply_markup=ReplyKeyboardRemove())
    await state.set_state(Reg.photo)


@router.message(Reg.photo, F.photo)
async def reg_photo(m: Message, state: FSMContext) -> None:
    await state.update_data(photo_id=m.photo[-1].file_id)
    data = await state.get_data()
    preview = {**data, "premium_until": 0}
    await m.answer_photo(data["photo_id"], caption=caption(preview))
    await m.answer("Так выглядит твоя анкета. Всё верно?", reply_markup=reply_kb(["✅ Да", "✏️ Заново"]))
    await state.set_state(Reg.confirm)


@router.message(Reg.photo)
async def reg_photo_bad(m: Message) -> None:
    await m.answer("Нужно именно фото (не файл и не видео) 📸")


@router.message(Reg.confirm, F.text == "✅ Да")
async def reg_confirm(m: Message, state: FSMContext) -> None:
    data = await state.get_data()
    await db.save_profile(m.from_user.id, m.from_user.username, data)
    await state.clear()
    await m.answer("🎉 Анкета сохранена!", reply_markup=main_menu())
    if not m.from_user.username:
        await m.answer(
            "💡 Совет: поставь себе @username в настройках Telegram — "
            "так при взаимной симпатии тебе точно смогут написать."
        )


@router.message(Reg.confirm)
async def reg_restart(m: Message, state: FSMContext) -> None:
    await start_registration(m, state)


# ================= ГЛАВНОЕ МЕНЮ =================

@router.message(F.text == BTN_BROWSE)
async def menu_browse(m: Message, state: FSMContext, bot: Bot) -> None:
    await state.clear()
    me = await active_user(m.from_user.id)
    if not me:
        await m.answer("Сначала заполни анкету: /start")
        return
    if not me["active"]:
        await db.update_user(me["user_id"], active=1)
        await m.answer("👁 Твоя анкета снова видна другим.")
    await show_next(bot, m.chat.id, me)


@router.message(F.text == BTN_LIKERS)
async def menu_likers(m: Message, state: FSMContext, bot: Bot) -> None:
    await state.clear()
    await show_liker(bot, m.chat.id, m.from_user.id)


async def show_liker(bot: Bot, chat_id: int, user_id: int) -> None:
    me = await active_user(user_id)
    if not me:
        await bot.send_message(chat_id, "Сначала заполни анкету: /start")
        return
    liker = await db.next_pending_like(user_id)
    if not liker:
        await bot.send_message(chat_id, "Пока новых лайков нет. Листай анкеты — и они появятся! 😉",
                               reply_markup=main_menu())
        return
    n = await db.pending_likes_count(user_id)
    extra = f"💘 Ты понравился(ась) этому человеку! (ещё в очереди: {n - 1})"
    if liker["like_message"]:
        extra += f"\n\n💌 Сообщение: <i>{html.escape(liker['like_message'])}</i>"
    await bot.send_photo(chat_id, liker["photo_id"], caption=caption(liker, extra),
                         reply_markup=liker_kb(liker["user_id"]))


@router.message(F.text == BTN_PROFILE)
async def menu_profile(m: Message, state: FSMContext) -> None:
    await state.clear()
    me = await active_user(m.from_user.id)
    if not me:
        await m.answer("Сначала заполни анкету: /start")
        return
    status = "👁 видна другим" if me["active"] else "🙈 скрыта"
    if db.is_premium(me):
        until = datetime.fromtimestamp(me["premium_until"]).strftime("%d.%m.%Y")
        status += f"\n⭐ Премиум до {until}"
    await m.answer_photo(
        me["photo_id"],
        caption=caption(me, f"Статус: {status}"),
        reply_markup=ikb(
            [("✏️ Заполнить заново", "p:redo")],
            [("🖼 Сменить фото", "p:photo"), ("📝 Сменить текст", "p:about")],
            [("👁 Показать анкету", "p:show") if not me["active"] else ("🙈 Скрыть анкету", "p:hide")],
        ),
    )


@router.message(F.text == BTN_PREMIUM)
async def menu_premium(m: Message, state: FSMContext) -> None:
    await state.clear()
    me = await active_user(m.from_user.id)
    if not me:
        await m.answer("Сначала заполни анкету: /start")
        return
    await send_premium(m, me)


async def send_premium(m: Message, me: dict) -> None:
    text = PREMIUM_TEXT
    rows = [[(f"{days} дней — {stars} ⭐", f"buy:{code}")] for code, (days, stars) in PLANS.items()]
    if db.is_premium(me):
        until = datetime.fromtimestamp(me["premium_until"]).strftime("%d.%m.%Y")
        text += f"\n\n✅ У тебя Премиум до <b>{until}</b>. Покупка продлит срок."
        rows.insert(0, [("⚙️ Фильтры", "f:menu")])
    await m.answer(text, reply_markup=ikb(*rows))


@router.message(F.text == BTN_CHAT)
async def menu_chat(m: Message, state: FSMContext) -> None:
    await state.clear()
    if not CHAT_LINK:
        await m.answer("Общий чат пока не настроен.")
        return
    await m.answer(
        "💬 Общий чат знакомств — общайся, пиши, кто тебе понравился.\n"
        "Будь вежлив: за оскорбления и спам — бан.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Перейти в чат", url=CHAT_LINK)]]),
    )


# ================= ЛЕНТА =================

@router.callback_query(F.data.startswith("like:"))
async def cb_like(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    limit = await check_like_limit(me, with_message=False)
    if limit:
        await cb.answer(limit, show_alert=True)
        return
    await drop_keyboard(cb)
    await cb.answer("❤️")
    await do_like(bot, me, int(cb.data.split(":")[1]), None)
    await show_next(bot, cb.message.chat.id, me)


@router.callback_query(F.data.startswith("msg:"))
async def cb_msg(cb: CallbackQuery, state: FSMContext) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    limit = await check_like_limit(me, with_message=True)
    if limit:
        await cb.answer(limit, show_alert=True)
        return
    await drop_keyboard(cb)
    await cb.answer()
    await state.set_state(Write.text)
    await state.update_data(target=int(cb.data.split(":")[1]))
    await cb.message.answer(
        "💌 Напиши сообщение — оно придёт вместе с лайком (до 300 символов):",
        reply_markup=reply_kb(["Отмена"]),
    )


@router.message(Write.text, F.text)
async def write_text(m: Message, state: FSMContext, bot: Bot) -> None:
    me = await active_user(m.from_user.id)
    data = await state.get_data()
    await state.clear()
    if not me:
        return
    if m.text == "Отмена":
        await m.answer("Отменено.", reply_markup=main_menu())
        await show_next(bot, m.chat.id, me)
        return
    text = m.text.strip()[:300]
    await do_like(bot, me, data["target"], text)
    await m.answer("✅ Отправлено!", reply_markup=main_menu())
    await show_next(bot, m.chat.id, me)


@router.message(Write.text)
async def write_bad(m: Message) -> None:
    await m.answer("Отправь текстом ✍️ или нажми «Отмена».")


@router.callback_query(F.data.startswith("skip:"))
async def cb_skip(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    await drop_keyboard(cb)
    await cb.answer()
    await db.set_view(me["user_id"], int(cb.data.split(":")[1]), "skip")
    await show_next(bot, cb.message.chat.id, me)


@router.callback_query(F.data == "undo")
async def cb_undo(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    if not db.is_premium(me):
        await cb.answer("↩️ Возврат анкеты доступен с ⭐ Премиумом", show_alert=True)
        return
    last = await db.last_skip(me["user_id"])
    prev = await active_user(last["to_id"]) if last else None
    if not prev:
        await cb.answer("Нечего возвращать", show_alert=True)
        return
    await drop_keyboard(cb)
    await cb.answer()
    await db.delete_view(me["user_id"], prev["user_id"])
    await cb.message.answer_photo(prev["photo_id"], caption=caption(prev), reply_markup=feed_kb(prev["user_id"]))


@router.callback_query(F.data.startswith("rep:"))
async def cb_report(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    target_id = int(cb.data.split(":")[1])
    await drop_keyboard(cb)
    await cb.answer("Жалоба отправлена. Спасибо!", show_alert=True)
    await db.add_report(me["user_id"], target_id)
    target = await db.get_user(target_id)
    if ADMIN_ID and target:
        try:
            await bot.send_photo(
                ADMIN_ID, target["photo_id"],
                caption=caption(target, f"⚠️ Жалоба от {me['user_id']} на {target_id}"),
                reply_markup=ikb([("🚫 Забанить", f"ban:{target_id}")]),
            )
        except (TelegramForbiddenError, TelegramBadRequest):
            pass
    await show_next(bot, cb.message.chat.id, me)


# ================= КТО МЕНЯ ЛАЙКНУЛ =================

@router.callback_query(F.data == "likers")
async def cb_likers(cb: CallbackQuery, bot: Bot) -> None:
    await cb.answer()
    await show_liker(bot, cb.message.chat.id, cb.from_user.id)


@router.callback_query(F.data.startswith("lb:"))
async def cb_like_back(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    await drop_keyboard(cb)
    await cb.answer("❤️")
    await do_like(bot, me, int(cb.data.split(":")[1]), None)
    await show_liker(bot, cb.message.chat.id, me["user_id"])


@router.callback_query(F.data.startswith("ls:"))
async def cb_like_skip(cb: CallbackQuery, bot: Bot) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    liker_id = int(cb.data.split(":")[1])
    await drop_keyboard(cb)
    await cb.answer()
    await db.mark_responded(liker_id, me["user_id"])
    await db.set_view(me["user_id"], liker_id, "skip")
    await show_liker(bot, cb.message.chat.id, me["user_id"])


# ================= РЕДАКТИРОВАНИЕ АНКЕТЫ =================

@router.callback_query(F.data.startswith("p:"))
async def cb_profile(cb: CallbackQuery, state: FSMContext) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    action = cb.data.split(":")[1]
    await cb.answer()
    if action == "redo":
        await start_registration(cb.message, state)
    elif action == "photo":
        await state.set_state(Edit.photo)
        await cb.message.answer("Пришли новое фото 📸", reply_markup=reply_kb(["Отмена"]))
    elif action == "about":
        await state.set_state(Edit.about)
        await cb.message.answer("Напиши новый текст о себе (до 500 символов):", reply_markup=reply_kb(["Отмена"]))
    elif action == "hide":
        await db.update_user(me["user_id"], active=0)
        await drop_keyboard(cb)
        await cb.message.answer("🙈 Анкета скрыта. Чтобы вернуть — нажми «Смотреть анкеты».",
                                reply_markup=main_menu())
    elif action == "show":
        await db.update_user(me["user_id"], active=1)
        await drop_keyboard(cb)
        await cb.message.answer("👁 Анкета снова видна другим.", reply_markup=main_menu())


@router.message(StateFilter(Edit.photo, Edit.about, Edit.ages), F.text == "Отмена")
async def edit_cancel(m: Message, state: FSMContext) -> None:
    await state.clear()
    await m.answer("Отменено.", reply_markup=main_menu())


@router.message(Edit.photo, F.photo)
async def edit_photo(m: Message, state: FSMContext) -> None:
    await db.update_user(m.from_user.id, photo_id=m.photo[-1].file_id)
    await state.clear()
    await m.answer("✅ Фото обновлено!", reply_markup=main_menu())


@router.message(Edit.photo)
async def edit_photo_bad(m: Message) -> None:
    await m.answer("Нужно именно фото 📸")


@router.message(Edit.about, F.text)
async def edit_about(m: Message, state: FSMContext) -> None:
    about = m.text.strip()
    if len(about) > 500:
        await m.answer(f"Слишком длинно ({len(about)}). Максимум 500 символов.")
        return
    await db.update_user(m.from_user.id, about=about)
    await state.clear()
    await m.answer("✅ Текст обновлён!", reply_markup=main_menu())


# ================= ФИЛЬТРЫ (ПРЕМИУМ) =================

def filters_kb(me: dict) -> InlineKeyboardMarkup:
    city = "✅" if me["f_city_only"] else "❌"
    if me["age"] < 18:
        return ikb([(f"Только мой город: {city}", "f:city")])
    lo, hi = db.age_bounds(me)
    return ikb([(f"Только мой город: {city}", "f:city")], [(f"Возраст: {lo}–{hi}", "f:ages")])


@router.callback_query(F.data.startswith("f:"))
async def cb_filters(cb: CallbackQuery, state: FSMContext) -> None:
    me = await active_user(cb.from_user.id)
    if not me:
        await cb.answer()
        return
    if not db.is_premium(me):
        await cb.answer("Фильтры доступны с ⭐ Премиумом", show_alert=True)
        return
    action = cb.data.split(":")[1]
    await cb.answer()
    if action == "menu":
        await cb.message.answer("⚙️ Фильтры ленты:", reply_markup=filters_kb(me))
    elif action == "city":
        await db.update_user(me["user_id"], f_city_only=0 if me["f_city_only"] else 1)
        me = await db.get_user(me["user_id"])
        await cb.message.edit_reply_markup(reply_markup=filters_kb(me))
    elif action == "ages" and me["age"] >= 18:
        await state.set_state(Edit.ages)
        await cb.message.answer("Напиши диапазон возраста через дефис, например <b>18-25</b>:",
                                reply_markup=reply_kb(["Отмена"]))


@router.message(Edit.ages, F.text)
async def edit_ages(m: Message, state: FSMContext) -> None:
    parts = m.text.replace("–", "-").replace(" ", "").split("-")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        await m.answer("Формат: 18-25")
        return
    lo, hi = sorted(int(p) for p in parts)
    lo, hi = max(18, lo), min(99, hi)
    await db.update_user(m.from_user.id, f_age_min=lo, f_age_max=hi)
    await state.clear()
    await m.answer(f"✅ Буду показывать анкеты {lo}–{hi} лет.", reply_markup=main_menu())


# ================= ОПЛАТА (Telegram Stars) =================

@router.callback_query(F.data.startswith("buy:"))
async def cb_buy(cb: CallbackQuery) -> None:
    code = cb.data.split(":")[1]
    if code not in PLANS:
        await cb.answer()
        return
    days, stars = PLANS[code]
    await cb.answer()
    await cb.message.answer_invoice(
        title=f"Премиум на {days} дней",
        description="Безлимит лайков и сообщений, фильтры, возврат анкет, приоритет в ленте.",
        payload=f"premium:{code}",
        currency="XTR",
        prices=[LabeledPrice(label=f"Премиум {days} дн.", amount=stars)],
    )


@router.pre_checkout_query()
async def pre_checkout(q: PreCheckoutQuery) -> None:
    code = q.invoice_payload.split(":")[-1]
    ok = q.invoice_payload.startswith("premium:") and code in PLANS and q.total_amount == PLANS[code][1]
    await q.answer(ok=ok, error_message=None if ok else "Тариф не найден, попробуй ещё раз.")


@router.message(F.successful_payment)
async def paid(m: Message) -> None:
    sp = m.successful_payment
    days, stars = PLANS[sp.invoice_payload.split(":")[-1]]
    until = await db.add_premium(m.from_user.id, days, sp.telegram_payment_charge_id, stars)
    date = datetime.fromtimestamp(until).strftime("%d.%m.%Y")
    await m.answer(f"⭐ Спасибо! Премиум активен до <b>{date}</b>.", reply_markup=main_menu())


@router.message(Command("paysupport"))
async def paysupport(m: Message) -> None:
    await m.answer("Вопросы по оплате: напиши администратору бота. Возврат звёзд — в течение 7 дней после покупки.")


@router.message(Command("help"))
async def cmd_help(m: Message) -> None:
    await m.answer(
        "/start — главное меню\n/paysupport — помощь с оплатой\n\n"
        "Листай анкеты: ❤️ — лайк, 💌 — лайк с сообщением, 👎 — дальше.\n"
        "При взаимном лайке бот пришлёт вам контакты друг друга."
    )


# ================= АДМИН =================

@router.callback_query(F.data.startswith("ban:"))
async def cb_ban(cb: CallbackQuery, bot: Bot) -> None:
    if cb.from_user.id != ADMIN_ID:
        await cb.answer()
        return
    uid = int(cb.data.split(":")[1])
    await db.update_user(uid, banned=1, active=0)
    await drop_keyboard(cb)
    await cb.answer("Забанен")
    await safe_send(bot, uid, "🚫 Твой аккаунт заблокирован за нарушение правил.")


@router.message(Command("stats"), F.from_user.id == ADMIN_ID)
async def cmd_stats(m: Message) -> None:
    s = await db.stats()
    await m.answer(
        f"👥 Анкет: {s['users']}\n👁 Активных: {s['active']}\n⭐ Премиум: {s['premium']}\n❤️ Лайков: {s['likes']}"
    )


@router.message(Command("unban"), F.from_user.id == ADMIN_ID)
async def cmd_unban(m: Message) -> None:
    parts = m.text.split()
    if len(parts) != 2 or not parts[1].isdigit():
        await m.answer("Формат: /unban <user_id>")
        return
    await db.update_user(int(parts[1]), banned=0, active=1)
    await m.answer("✅ Разбанен")


@router.message(Command("refund"), F.from_user.id == ADMIN_ID)
async def cmd_refund(m: Message, bot: Bot) -> None:
    parts = m.text.split()
    if len(parts) != 3 or not parts[1].isdigit():
        await m.answer("Формат: /refund <user_id> <charge_id>")
        return
    try:
        await bot.refund_star_payment(int(parts[1]), parts[2])
        await db.update_user(int(parts[1]), premium_until=0)
        await m.answer("✅ Звёзды возвращены, премиум снят.")
    except TelegramBadRequest as e:
        await m.answer(f"Ошибка: {e.message}")


@router.message()
async def fallback(m: Message) -> None:
    u = await db.get_user(m.from_user.id)
    if not u:
        await m.answer("Нажми /start, чтобы создать анкету.")
    else:
        await m.answer("Выбери действие в меню 👇", reply_markup=main_menu())


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not BOT_TOKEN:
        raise SystemExit("Укажи BOT_TOKEN в файле .env")
    await db.init()
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
