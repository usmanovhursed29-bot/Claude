#!/usr/bin/env python3
"""Темы для роликов: карта ниш Рунета и свежие запросы через бесплатный API Букварикса.

Python 3.9+, только стандартная библиотека. Запуск: `uv run --no-project --python 3.12 topics.py <команда>`.

  check                      карта на месте: дата, сколько ниш, источник
  groups                     группы ниш и сколько ниш в каждой
  map [СЛОВО ...]            ниши для роликов; со словами ученика — его ниши. --csv/--pult — таблица в файл и в Пульт
  niche ID                   одна ниша подробно: цифры, кто побеждает, главные запросы
  fetch СЛОВО [СЛОВО ...]    свежие запросы через API Букварикса → <дом>/data/topics/*.tsv
  sheet ФАЙЛ.csv             проверить таблицу тем, подписать источник, показать в Пульте

Данные — Букварикс (bukvarix.com). Условие Букварикса: указывать его источником и не делать на данных
сервис-конкурент. Поэтому каждая таблица, которую пишет этот инструмент, заканчивается строкой источника.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLED_MAP = HERE.parent / "data" / "niches.json.gz"
SOURCE = "Данные: Букварикс (bukvarix.com)"
API = os.environ.get("BUKVARIX_API", "https://api.bukvarix.com/v1/keywords/")
UA = {"User-Agent": "studio-club-topics/1.0"}
SORTS = {
    # для роликов: много спрашивают или хотят купить, а гиганты держат меньше выдачи
    "video": ("для роликов", lambda n: n["demand"] * (1 - n["giants"]) * (n["questions"] + n["money"])),
    "free": ("малым сайтам", lambda n: n["small_clicks"]),
    "demand": ("спрос", lambda n: n["demand_all"]),
    "money": ("деньги", lambda n: n["money"] * n["demand"]),
    "questions": ("вопросы", lambda n: n["questions"] * n["demand"]),
}


# ───────────── где что лежит ─────────────

def nekurs_dir() -> Path:
    """Папка nekurs/ клуба: NEKURS_HOME, иначе над этим файлом (nekurs/<гайд>/materials/tools/), иначе от рабочей папки."""
    if os.environ.get("NEKURS_HOME"):
        return Path(os.environ["NEKURS_HOME"])
    for start in (HERE, Path.cwd()):
        for base in [start, *start.parents][:6]:
            cand = base if base.name == "nekurs" else base / "nekurs"
            if (cand / "profile.md").is_file():
                return cand
    return Path.home() / "nekurs"


def studio_home() -> Path:
    """Дом Studio: STUDIO_HOME, иначе строка «Studio: <путь>» в nekurs/profile.md, иначе ~/studio."""
    if os.environ.get("STUDIO_HOME"):
        return Path(os.environ["STUDIO_HOME"])
    try:
        for line in (nekurs_dir() / "profile.md").read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*[-*]?\s*Studio:\s*(.+?)\s*$", line)
            if m:
                return Path(m.group(1).strip("`'\" ")).expanduser()
    except OSError:
        pass
    return Path.home() / "studio"


def load_map(path: str | None = None) -> dict:
    """Карта ниш: явный путь, иначе <дом>/data/niches.json.gz (если положили новее), иначе та, что пришла с гайдом."""
    candidates = [Path(path)] if path else [studio_home() / "data" / "niches.json.gz", BUNDLED_MAP]
    for p in candidates:
        if p.is_file():
            with gzip.open(p, "rb") as f:
                data = json.loads(f.read().decode("utf-8"))
            data["meta"]["path"] = str(p)
            return data
    raise SystemExit(f"Карты ниш нет: {', '.join(map(str, candidates))}. Она приходит с гайдом в materials/data/.")


# ───────────── вывод ─────────────

def num(n: float) -> str:
    return f"{int(round(n)):,}".replace(",", " ")


def pct(x: float) -> str:
    return f"{round(x * 100)}%"


def short(text: str, width: int) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"


def niche_row(n: dict, hits: int | None = None) -> dict:
    row = {
        "id": n["id"], "ниша": n["name"] or ", ".join(n["heads"][:3]), "группа": n["group"],
        "спрос в месяц": n["demand_all"], "вопросы": pct(n["questions"]), "деньги": pct(n["money"]),
        "гиганты": pct(n["giants"]), "малым сайтам": n["small_clicks"],
    }
    if hits is not None:
        row["совпадений"] = hits
    row["запросы"] = " | ".join(n["queries"][:5])
    return row


def print_table(rows: list[dict]) -> None:
    if not rows:
        print("Ничего не нашлось.")
        return
    extra = "совпадений" in rows[0]
    print(f"{'id':>5}  {'ниша':<38} {'спрос/мес':>11} {'вопр':>5} {'деньги':>6} {'гиганты':>7} {'малым сайтам':>12}"
          + ("  совп." if extra else ""))
    for r in rows:
        print(f"{r['id']:>5}  {short(r['ниша'], 38):<38} {num(r['спрос в месяц']):>11} {r['вопросы']:>5} {r['деньги']:>6} "
              f"{r['гиганты']:>7} {num(r['малым сайтам']):>12}" + (f"  {r['совпадений']:>5}" if extra else ""))


def write_table(path: Path, rows: list[dict], note: str) -> None:
    """CSV для Excel и Пульта: UTF-8 с BOM, разделитель «;», последняя строка — источник."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(list(rows[0].keys()) if rows else ["пусто"])
        for r in rows:
            w.writerow(list(r.values()))
        f.write(f"# {note}\r\n")


def to_pult(title: str, path: Path) -> None:
    pult = studio_home() / "pult" / "pult.py"
    if not pult.is_file():
        print(f"Пульта нет в {pult.parent}: таблица лежит в {path}")
        return
    r = subprocess.run([sys.executable, str(pult), "result", title, "--part", "topics", "--file", str(path)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout.strip() or r.stderr.strip())


def map_note(meta: dict) -> str:
    return f"{SOURCE}. Карта ниш от {meta.get('map_built', '?')}: {meta.get('base', '')}."


# ───────────── команды ─────────────

def cmd_check(args) -> int:
    data = load_map(args.map)
    m = data["meta"]
    print(f"Карта ниш: {m['path']}")
    print(f"Ниш: {len(data['niches'])}, собрана {m.get('map_built')}, выгружена {m.get('exported')}")
    print(f"База: {m.get('base')}")
    print(m["source"])
    return 0


def cmd_groups(args) -> int:
    data = load_map(args.map)
    count: dict[str, list[int]] = {}
    for n in data["niches"]:
        if n["flag"] == "ok":
            count.setdefault(n["group"] or "Без группы", []).append(n["demand_all"])
    for g, d in sorted(count.items(), key=lambda kv: -sum(kv[1])):
        print(f"{g:<34} ниш: {len(d):>4}   спрос в месяц: {num(sum(d)):>13}")
    return 0


def match_score(n: dict, words: list[str]) -> int:
    """Сколько названий и запросов ниши содержат слова ученика. Фраза из нескольких слов («ремонт мебел»)
    совпадает, только если все её слова стоят в одном запросе: так «ремонт» не тащит ремонт авто."""
    hay = {n["name"].lower(), *[q.lower() for q in n["queries"]], *[q.lower() for q in n["heads"]]}  # без повторов
    phrases = [w.split() for w in words]
    return sum(1 for text in hay for ph in phrases if all(part in text for part in ph))


# Запросы, из которых не выйдет темы ролика: город в запросе (ищут мастера рядом), вакансии, коды и объявления.
# Местному бизнесу города нужны: fetch --cities.
CITIES = re.compile(
    r"(москв|мск\b|подмосков|спб\b|санкт|петербург|питер\b|ленобласт|екатеринбург|екб\b|новосибирск|казан[ьи]\b|"
    r"нижн\w* новгород|самар[аеыу]\b|краснодар|ростов|воронеж|перм[иь]\b|\bуф[аеы]\b|челябинск|\bомск|красноярск|"
    r"волгоград|тюмен|саратов|ижевск|барнаул|ярославл|иркутск|хабаровск|владивосток|махачкал|томск|оренбург|кемеров|"
    r"новокузнец|рязан|астрахан|пенз[аеы]\b|липецк|\bтул[аеуы]\b|\bкиров|чебоксар|калининград|\bкурск|ставропол|"
    r"улан-удэ|\bсочи\b|\bтвер[иь]\b|магнитогорск|иваново|брянск|белгород|сургут|\bвладимир[аеу]?\b|архангельск|"
    r"калуг|смоленск|курган|череповец|вологд|мурманск|тамбов|стерлитамак|грозн|якутск|костром|петрозаводск|таганрог|"
    r"нальчик|владикавказ|энгельс|мытищ|балаших|химк|подольск|королев|люберц|зеленоград|набережн\w* челн|"
    r"новомосковск|кисловодск|минск|гомел|\bкиев|харьков|одесс|днепр|львов|алматы|астан[аеы]\b|шымкент|ташкент|"
    r"бишкек|донецк|луганск|\bкрым|севастопол|симферопол)", re.I)
NOT_TOPICS = re.compile(r"ваканси|резюме|оквэд|авито|\bюла\b|отзыв|адрес|телефон|официальн\w* сайт|\bсмет", re.I)


def cmd_map(args) -> int:
    data = load_map(args.map)
    words = [w.lower().strip() for w in args.words if w.strip()]
    niches = [n for n in data["niches"] if args.all or n["flag"] == "ok"]
    if args.group:
        niches = [n for n in niches if n["group"].lower().startswith(args.group.lower())]
    key = SORTS[args.sort][1]
    hits: dict[int, int] = {}
    if words:
        scored = [(match_score(n, words), n) for n in niches]
        floor = 2 if sum(1 for sc, _ in scored if sc >= 2) >= 3 else 1  # одно случайное совпадение — шум
        hits = {n["id"]: sc for sc, n in scored}
        # ниша одного города («Мебель в Донецке») — вниз списка: темы роликов в ней почти все «мастер рядом»
        local = (lambda n: False) if args.cities else (lambda n: bool(CITIES.search(n["name"] or "")))
        niches = [n for sc, n in sorted(scored, key=lambda sn: (local(sn[1]), -sn[0], -key(sn[1]))) if sc >= floor]
    else:
        niches = sorted(niches, key=lambda n: -key(n))
    rows = [niche_row(n, hits[n["id"]] if words else None) for n in niches[: args.top]]
    what = f"по словам: {', '.join(words)}" if words else f"лучшие по столбцу «{SORTS[args.sort][0]}»"
    print(f"Ниши {what}. Всего подходит: {len(niches)}, показано: {len(rows)}.")
    print_table(rows)
    print(f"\n{SOURCE}")
    if args.csv or args.pult:
        path = Path(args.csv) if args.csv else studio_home() / "out" / "topics" / "karta-nish.csv"
        write_table(path, rows, map_note(data["meta"]))
        print(f"Таблица: {path}")
        if args.pult:
            to_pult(args.title, path)
    return 0


def cmd_niche(args) -> int:
    data = load_map(args.map)
    n = next((x for x in data["niches"] if x["id"] == args.id), None)
    if not n:
        raise SystemExit(f"Ниши {args.id} в карте нет (18+ и казино в карту не попали).")
    if args.json:
        print(json.dumps(n, ensure_ascii=False, indent=1))
        return 0
    print(f"Ниша {n['id']}: {n['name']} ({n['group']}){'  — входы на сайты, тем почти нет' if n['flag'] == 'junk' else ''}")
    print(f"- Спрос: {num(n['demand_all'])} поисков в месяц, из них длинных запросов (от 3 слов) {num(n['demand'])}, "
          f"это {num(n['nq'])} разных запросов.")
    print(f"- Вопросы: {pct(n['questions'])} главных длинных запросов — вопросы (как, что, почему, сколько, что лучше).")
    print(f"- Деньги: {pct(n['money'])} спроса — запросы со словами купить, цена, заказать, услуги.")
    print(f"- Гиганты: {pct(n['giants'])} выдачи у 211 самых больших сайтов Рунета. Чем меньше, тем свободнее.")
    print(f"- Небольшим сайтам достаётся примерно {num(n['small_clicks'])} переходов в месяц.")
    if n["winners"]:
        print("- Кто из небольших уже побеждает:")
        for w in n["winners"]:
            print(f"    {w['site']}: ~{num(w['clicks'])} переходов в месяц, запросов в топ-3: {w['top3']}")
    print("- Главные запросы:", " | ".join(n["heads"]))
    print("- Длинные запросы по спросу:")
    for q in n["queries"]:
        print("    " + q)
    print(SOURCE)
    return 0


def translit(text: str) -> str:
    table = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                     ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u",
                      "f", "h", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))
    out = "".join(table.get(c, c) for c in text.lower())
    return re.sub(r"[^a-z0-9]+", "-", out).strip("-")[:40] or "zaprosy"


def api_get(seed: str, limit: int, tries: int = 4) -> list[list]:
    """Все запросы, где есть эти слова: [запрос, слов, символов, общая частота, точная частота]."""
    url = API + "?" + urllib.parse.urlencode({"q": seed, "api_key": "free", "num": limit, "format": "json"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                raw = r.read()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("cp1251")
            return json.loads(text).get("data") or []
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"Букварикс не пустил к API (код {e.code}). Проверь в браузере https://www.bukvarix.com/api/ "
                                 "и скажи ученику, если бесплатный доступ закрыли.")
            err = f"код {e.code}"
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            err = str(e)
        time.sleep(3 * (attempt + 1))
    raise SystemExit(f"API Букварикса не ответил на «{seed}»: {err}. Повтори позже.")


def cmd_fetch(args) -> int:
    seeds = [s.strip() for s in args.seeds if s.strip()]
    merged: dict[str, list[int]] = {}
    for i, seed in enumerate(seeds):
        if i:
            time.sleep(1)  # бережно: API бесплатный
        rows = api_get(seed, args.max)
        for row in rows:
            if not row or not isinstance(row[0], str):
                continue
            kw = row[0].strip().lower()
            total = int(row[3]) if len(row) > 3 and str(row[3]).isdigit() else 0
            exact = int(row[4]) if len(row) > 4 and str(row[4]).isdigit() else 0
            old = merged.get(kw)
            merged[kw] = [max(exact, old[0]) if old else exact, max(total, old[1]) if old else total, len(kw.split())]
        print(f"«{seed}»: {len(rows)} запросов" + (f" — это потолок --max, есть ещё: подними --max" if len(rows) >= args.max else ""))
    drop = [d.strip().lower() for chunk in (args.drop or []) for d in chunk.split(",") if d.strip()]
    dropped = {"с городом": 0, "не темы (вакансии, отзывы, ОКВЭД…)": 0, "по --drop": 0}
    keep: dict[str, list[int]] = {}
    for kw, v in merged.items():
        if v[0] < args.min:
            continue
        if not args.cities and CITIES.search(kw):
            dropped["с городом"] += 1
        elif NOT_TOPICS.search(kw):
            dropped["не темы (вакансии, отзывы, ОКВЭД…)"] += 1
        elif any(d in kw for d in drop):
            dropped["по --drop"] += 1
        else:
            keep[kw] = v
    gone = ", ".join(f"{k} {n}" for k, n in dropped.items() if n)
    rows = sorted(((kw, *v) for kw, v in keep.items()), key=lambda r: (-r[1], -r[2], r[0]))
    name = f"niche-{args.niche}" if args.niche is not None else translit(seeds[0])
    path = Path(args.out) if args.out else studio_home() / "data" / "topics" / f"{name}.tsv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write("запрос\tточная частота\tобщая частота\tслов\n")
        for kw, exact, total, words in rows:
            f.write(f"{kw}\t{exact}\t{total}\t{words}\n")
        f.write(f"# {SOURCE}, API {date.today().isoformat()}. Слова: {', '.join(seeds)}. "
                f"Точная частота от {args.min} в месяц." + (f" Убраны запросы: {gone}." if gone else "")
                + (f" Слова --drop: {', '.join(drop)}." if drop else "") + "\n")
    print(f"Всего разных запросов: {len(merged)}, с точной частотой от {args.min} и без мусора: {len(rows)}.")
    if gone:
        print(f"Убраны запросы: {gone}." + (" Запрос с городом ищет мастера рядом, а не тему ролика; "
                                            "местному бизнесу города нужны: fetch --cities." if dropped["с городом"] else ""))
    print(f"Файл: {path}")
    print("Посмотри первые 50 строк. Если есть чужой предмет с тем же словом (у мебели — «духовой шкаф»), "
          "повтори fetch с --drop духов (через запятую можно несколько).")
    if args.pult:
        to_pult(args.title or f"Запросы: {', '.join(seeds)[:60]}", path)
    return 0


def read_sheet(path: Path) -> tuple[list[str], list[list[str]], list[str]]:
    text = path.read_bytes().decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    notes = [line for line in lines if line.startswith("#")]
    data = [line for line in lines if line.strip() and not line.startswith("#")]
    sample = "\n".join(data[:5])
    sep = ";" if sample.count(";") > max(sample.count(","), sample.count("\t")) else \
        "\t" if sample.count("\t") > sample.count(",") else ","
    rows = list(csv.reader(io.StringIO("\n".join(data)), delimiter=sep))
    return (rows[0] if rows else []), rows[1:], notes


def cmd_sheet(args) -> int:
    path = Path(args.file).expanduser().resolve()
    if not path.is_file():
        raise SystemExit(f"Нет файла: {path}")
    head, rows, notes = read_sheet(path)
    cols = [c.strip().lower() for c in head]
    problems = []
    for need in ("тема", "спрос"):
        if need not in cols:
            problems.append(f"нет столбца «{need}»")
    if len(rows) < args.min_rows:
        problems.append(f"тем {len(rows)}, а нужно {args.min_rows}")
    if "спрос" in cols:
        k = cols.index("спрос")
        bad = [r for r in rows if len(r) <= k or not re.sub(r"[\s ]", "", r[k]).isdigit()]
        if bad:
            problems.append(f"в столбце «спрос» не число у {len(bad)} строк")
    if not any("bukvarix" in n.lower() or "букварикс" in n.lower() for n in notes):
        with path.open("a", encoding="utf-8", newline="") as f:
            f.write(("" if path.read_bytes().endswith(b"\n") else "\r\n") + f"# {SOURCE}\r\n")
        print("Дописал строку источника: " + SOURCE)
    if problems:
        print("Таблицу надо поправить: " + "; ".join(problems) + ".")
        print("Столбцы: тема; спрос; запросы; формат. Спрос — сумма точных частот запросов темы в месяц.")
        return 1
    print(f"ок: тем {len(rows)}, столбцы: {', '.join(head)}")
    if args.pult:
        to_pult(args.title, path)
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass
    ap = argparse.ArgumentParser(prog="topics", description="Темы для роликов: карта ниш и запросы Букварикса.")
    ap.add_argument("--map", help="путь к карте ниш (по умолчанию та, что пришла с гайдом)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="карта на месте: дата, сколько ниш, источник")
    sub.add_parser("groups", help="группы ниш")
    p = sub.add_parser("map", help="ниши: лучшие или по словам ученика")
    p.add_argument("words", nargs="*", help="слова ученика: основы (зуб, стоматолог) или фраза в кавычках "
                        "(\"ремонт мебел\" — все слова в одном запросе)")
    p.add_argument("--group", help="только эта группа (начало названия: «Здоровье»)")
    p.add_argument("--sort", choices=sorted(SORTS), default="video",
                   help="video — для роликов: много вопросов или покупок, мало гигантов (по умолчанию); "
                        "free — сколько переходов достаётся небольшим сайтам; demand — спрос; "
                        "money — денежный спрос; questions — спрос на вопросы")
    p.add_argument("--top", type=int, default=30)
    p.add_argument("--all", action="store_true", help="показать и ниши-входы на сайты (junk)")
    p.add_argument("--cities", action="store_true", help="не опускать ниши одного города (местный бизнес)")
    p.add_argument("--csv", help="сохранить таблицу сюда (по умолчанию <дом>/out/topics/karta-nish.csv)")
    p.add_argument("--pult", action="store_true", help="сохранить таблицу и показать её в Пульте")
    p.add_argument("--title", default="Карта ниш")
    p = sub.add_parser("niche", help="одна ниша подробно")
    p.add_argument("id", type=int)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("fetch", help="свежие запросы через бесплатный API Букварикса")
    p.add_argument("seeds", nargs="+", help="слова или фразы: API вернёт все запросы, где они есть")
    p.add_argument("--niche", type=int, help="id ниши: для имени файла")
    p.add_argument("--max", type=int, default=20000, help="сколько запросов брать на одно слово")
    p.add_argument("--min", type=int, default=10, help="отбросить запросы с точной частотой меньше этой")
    p.add_argument("--drop", action="append", help="убрать запросы с этими кусками слов, через запятую: --drop духов,авто")
    p.add_argument("--cities", action="store_true", help="оставить запросы с городами (местный бизнес)")
    p.add_argument("--out", help="куда сохранить (по умолчанию <дом>/data/topics/)")
    p.add_argument("--pult", action="store_true", help="показать таблицу в Пульте")
    p.add_argument("--title")
    p = sub.add_parser("sheet", help="проверить таблицу тем, подписать источник, показать в Пульте")
    p.add_argument("file")
    p.add_argument("--min-rows", type=int, default=30)
    p.add_argument("--pult", action="store_true")
    p.add_argument("--title", default="30 тем для роликов")
    args = ap.parse_args(argv)
    return {"check": cmd_check, "groups": cmd_groups, "map": cmd_map, "niche": cmd_niche,
            "fetch": cmd_fetch, "sheet": cmd_sheet}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
