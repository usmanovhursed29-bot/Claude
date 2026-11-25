"""Работа с базой данных SQLite."""
import time

import aiosqlite

DB_PATH = "dating.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY,
    username      TEXT,
    name          TEXT NOT NULL,
    age           INTEGER NOT NULL,
    gender        TEXT NOT NULL,          -- m / f
    looking       TEXT NOT NULL,          -- m / f / any
    city          TEXT NOT NULL,
    about         TEXT NOT NULL DEFAULT '',
    photo_id      TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    banned        INTEGER NOT NULL DEFAULT 0,
    premium_until INTEGER NOT NULL DEFAULT 0,
    f_city_only   INTEGER NOT NULL DEFAULT 0,
    f_age_min     INTEGER NOT NULL DEFAULT 0,
    f_age_max     INTEGER NOT NULL DEFAULT 0,
    created       INTEGER NOT NULL
);
-- что пользователь сделал с чужой анкетой: like / skip / report
CREATE TABLE IF NOT EXISTS views (
    from_id INTEGER NOT NULL,
    to_id   INTEGER NOT NULL,
    action  TEXT NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS likes (
    from_id   INTEGER NOT NULL,
    to_id     INTEGER NOT NULL,
    message   TEXT,
    responded INTEGER NOT NULL DEFAULT 0,
    created   INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS reports (
    from_id INTEGER NOT NULL,
    to_id   INTEGER NOT NULL,
    created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    user_id   INTEGER NOT NULL,
    charge_id TEXT NOT NULL,
    stars     INTEGER NOT NULL,
    days      INTEGER NOT NULL,
    created   INTEGER NOT NULL
);
"""

SKIP_COOLDOWN = 3 * 24 * 3600  # пропущенная анкета вернётся через 3 дня


def now() -> int:
    return int(time.time())


async def init() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def _fetchone(sql: str, params=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def _fetchall(sql: str, params=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def _exec(sql: str, params=()) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(sql, params)
        await db.commit()


# ---------- пользователи ----------

async def get_user(user_id: int):
    return await _fetchone("SELECT * FROM users WHERE user_id=?", (user_id,))


async def save_profile(user_id: int, username, p: dict) -> None:
    await _exec(
        """INSERT INTO users (user_id, username, name, age, gender, looking, city, about, photo_id, created)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET
             username=excluded.username, name=excluded.name, age=excluded.age,
             gender=excluded.gender, looking=excluded.looking, city=excluded.city,
             about=excluded.about, photo_id=excluded.photo_id, active=1""",
        (user_id, username, p["name"], p["age"], p["gender"], p["looking"],
         p["city"], p["about"], p["photo_id"], now()),
    )


async def update_user(user_id: int, **fields) -> None:
    cols = ", ".join(f"{k}=?" for k in fields)
    await _exec(f"UPDATE users SET {cols} WHERE user_id=?", (*fields.values(), user_id))


def is_premium(user: dict) -> bool:
    return user["premium_until"] > now()


async def add_premium(user_id: int, days: int, charge_id: str, stars: int) -> int:
    user = await get_user(user_id)
    start = max(user["premium_until"], now())
    until = start + days * 24 * 3600
    await update_user(user_id, premium_until=until)
    await _exec("INSERT INTO payments VALUES (?,?,?,?,?)", (user_id, charge_id, stars, days, now()))
    return until


# ---------- лента анкет ----------

def age_bounds(user: dict) -> tuple[int, int]:
    """Возрастные рамки показа. Несовершеннолетние видят только сверстников ±2 года,
    взрослые — только взрослых. Взрослые и подростки друг друга никогда не видят."""
    age = user["age"]
    if age < 18:
        return max(14, age - 2), min(17, age + 2)
    lo, hi = 18, 99
    if is_premium(user):
        if user["f_age_min"]:
            lo = max(18, user["f_age_min"])
        if user["f_age_max"]:
            hi = user["f_age_max"]
    return lo, hi


async def next_candidate(user: dict):
    lo, hi = age_bounds(user)
    city_only = 1 if (is_premium(user) and user["f_city_only"]) else 0
    return await _fetchone(
        """SELECT * FROM users u
           WHERE u.active=1 AND u.banned=0 AND u.user_id != :me
             AND (:looking='any' OR u.gender=:looking)
             AND (u.looking='any' OR u.looking=:gender)
             AND u.age BETWEEN :lo AND :hi
             AND (:city_only=0 OR lower(u.city)=lower(:city))
             AND u.user_id NOT IN (
                 SELECT to_id FROM views
                 WHERE from_id=:me AND (action!='skip' OR created > :cutoff))
           ORDER BY (lower(u.city)=lower(:city)) DESC,
                    (u.premium_until > :now) DESC,
                    RANDOM()
           LIMIT 1""",
        {"me": user["user_id"], "looking": user["looking"], "gender": user["gender"],
         "lo": lo, "hi": hi, "city_only": city_only, "city": user["city"],
         "cutoff": now() - SKIP_COOLDOWN, "now": now()},
    )


async def set_view(from_id: int, to_id: int, action: str) -> None:
    await _exec(
        "INSERT OR REPLACE INTO views (from_id, to_id, action, created) VALUES (?,?,?,?)",
        (from_id, to_id, action, now()),
    )


async def last_skip(from_id: int):
    return await _fetchone(
        "SELECT to_id FROM views WHERE from_id=? AND action='skip' ORDER BY created DESC LIMIT 1",
        (from_id,),
    )


async def delete_view(from_id: int, to_id: int) -> None:
    await _exec("DELETE FROM views WHERE from_id=? AND to_id=?", (from_id, to_id))


# ---------- лайки ----------

async def add_like(from_id: int, to_id: int, message: str | None) -> bool:
    """Ставит лайк. Возвращает True, если лайк взаимный (мэтч)."""
    await _exec(
        "INSERT OR REPLACE INTO likes (from_id, to_id, message, responded, created) VALUES (?,?,?,0,?)",
        (from_id, to_id, message, now()),
    )
    await set_view(from_id, to_id, "like")
    back = await _fetchone("SELECT 1 FROM likes WHERE from_id=? AND to_id=?", (to_id, from_id))
    if back:
        await _exec(
            "UPDATE likes SET responded=1 WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)",
            (from_id, to_id, to_id, from_id),
        )
        return True
    return False


async def mark_responded(from_id: int, to_id: int) -> None:
    await _exec("UPDATE likes SET responded=1 WHERE from_id=? AND to_id=?", (from_id, to_id))


async def likes_today(user_id: int, with_message: bool = False) -> int:
    sql = "SELECT COUNT(*) AS c FROM likes WHERE from_id=? AND created > ?"
    if with_message:
        sql += " AND message IS NOT NULL"
    row = await _fetchone(sql, (user_id, now() - 24 * 3600))
    return row["c"]


async def pending_likes_count(user_id: int) -> int:
    row = await _fetchone(
        """SELECT COUNT(*) AS c FROM likes l JOIN users u ON u.user_id=l.from_id
           WHERE l.to_id=? AND l.responded=0 AND u.active=1 AND u.banned=0""",
        (user_id,),
    )
    return row["c"]


async def next_pending_like(user_id: int):
    return await _fetchone(
        """SELECT u.*, l.message AS like_message FROM likes l JOIN users u ON u.user_id=l.from_id
           WHERE l.to_id=? AND l.responded=0 AND u.active=1 AND u.banned=0
           ORDER BY (u.premium_until > ?) DESC, l.created ASC LIMIT 1""",
        (user_id, now()),
    )


# ---------- жалобы ----------

async def add_report(from_id: int, to_id: int) -> None:
    await _exec("INSERT INTO reports VALUES (?,?,?)", (from_id, to_id, now()))
    await set_view(from_id, to_id, "report")
    await mark_responded(to_id, from_id)


async def stats() -> dict:
    users = await _fetchone("SELECT COUNT(*) AS c FROM users WHERE banned=0")
    active = await _fetchone("SELECT COUNT(*) AS c FROM users WHERE active=1 AND banned=0")
    premium = await _fetchone("SELECT COUNT(*) AS c FROM users WHERE premium_until > ?", (now(),))
    likes = await _fetchone("SELECT COUNT(*) AS c FROM likes")
    return {"users": users["c"], "active": active["c"], "premium": premium["c"], "likes": likes["c"]}
