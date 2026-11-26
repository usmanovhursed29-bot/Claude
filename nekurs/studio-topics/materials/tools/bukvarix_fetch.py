#!/usr/bin/env python3
"""Скачивает базу ключевых слов Букварикса (2 млрд запросов) с её официальной страницы, с докачкой.

Базу раздаёт сам Букварикс: https://www.bukvarix.com/about_bases.html. Условия: указывать Букварикс как
источник и не делать на базе сервис-конкурент. Поэтому каждый участник качает её себе сам, мы копию не раздаём.

Запуск (Python 3.9+, без зависимостей):
  uv run --no-project --python 3.12 bukvarix_fetch.py --list            # что и сколько качать, ничего не качает
  uv run --no-project --python 3.12 bukvarix_fetch.py --background      # качать в фоне, прогресс в Пульт
  uv run --no-project --python 3.12 bukvarix_fetch.py                   # качать в этом окне

Куда: <дом Studio>/data/bukvarix (или --dest). Прерванное продолжится с того же места при следующем запуске.
Прогресс: файл progress.json в папке базы и строки в Пульте (если Пульт стоит в <дом>/pult).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PAGE = "https://www.bukvarix.com/about_bases.html"
API = "https://cloud.mail.ru/api/v2"
FALLBACK_LINK = "NZyu/saCDZpUEX"      # «База ключевых слов», 2 млрд, на 12.11.2026
UA = {"User-Agent": "Mozilla/5.0 (studio-club bukvarix_fetch)"}
GB = 1024 ** 3
SOURCE_NOTE = "Данные: Букварикс (bukvarix.com)"


def nekurs_dir() -> Path:
    """Папка nekurs/ клуба: NEKURS_HOME, иначе над этим файлом (nekurs/<гайд>/materials/tools/), иначе от рабочей папки."""
    if os.environ.get("NEKURS_HOME"):
        return Path(os.environ["NEKURS_HOME"])
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for base in [start, *start.parents][:6]:
            cand = base if base.name == "nekurs" else base / "nekurs"
            if (cand / "profile.md").is_file():
                return cand
    return Path.home() / "nekurs"


def studio_home() -> Path:
    """Дом Studio: STUDIO_HOME, иначе строка «Studio: <путь>» в nekurs/profile.md, иначе ~/studio."""
    if os.environ.get("STUDIO_HOME"):
        return Path(os.environ["STUDIO_HOME"])
    profile = nekurs_dir() / "profile.md"
    try:
        for line in profile.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*[-*]?\s*Studio:\s*(.+?)\s*$", line)
            if m:
                return Path(m.group(1).strip("`'\" ")).expanduser()
    except OSError:
        pass
    return Path.home() / "studio"


def http(url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 30):
    return urllib.request.urlopen(urllib.request.Request(url, data=data, headers={**UA, **(headers or {})}), timeout=timeout)


def find_link(page_html: str) -> str | None:
    """Первая ссылка на облако после заголовка «База ключевых слов» — это основная база на 2 млрд."""
    start = page_html.find("База ключевых слов")
    m = re.search(r"https://cloud\.mail\.ru/public/([A-Za-z0-9]+/[A-Za-z0-9]+)", page_html[start if start >= 0 else 0:])
    return m.group(1) if m else None


def current_link(api: str = API, page: str = PAGE) -> str:
    try:
        with http(page, timeout=20) as r:
            return find_link(r.read().decode("utf-8", "replace")) or FALLBACK_LINK
    except (OSError, urllib.error.URLError):
        return FALLBACK_LINK


def list_files(link: str, api: str = API) -> list[dict]:
    with http(f"{api}/folder?weblink={link}") as r:
        body = json.loads(r.read().decode("utf-8"))["body"]
    files = [{"name": f["name"], "size": int(f["size"]), "weblink": f["weblink"]}
             for f in body.get("list", []) if f.get("type", "file") == "file"]
    return sorted(files, key=lambda f: f["name"])


def download_base(api: str = API) -> str:
    with http(f"{api}/dispatcher", data=b"") as r:
        return json.loads(r.read().decode("utf-8"))["body"]["weblink_get"][0]["url"]


class Pult:
    """Строки в Пульт через его команду; без Пульта — тихо."""

    def __init__(self, home: Path):
        self.script = home / "pult" / "pult.py"
        self.last = 0.0

    def say(self, text: str, kind: str = "info", force: bool = False) -> None:
        if not self.script.is_file() or (not force and time.time() - self.last < 600):
            return
        self.last = time.time()
        try:
            subprocess.run([sys.executable, str(self.script), "say", text, "--part", "topics", "--kind", kind],
                           capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            pass


def fetch_file(url: str, target: Path, size: int, on_chunk=None, retries: int = 8) -> None:
    """Качает файл в target с докачкой: .part растёт, при обрыве продолжаем с его размера."""
    part = target.with_name(target.name + ".part")
    attempt = 0
    while True:
        have = part.stat().st_size if part.exists() else 0
        if have >= size:
            break
        try:
            with http(url, headers={"Range": f"bytes={have}-"}, timeout=60) as r:
                if r.status == 200 and have:          # сервер не умеет докачку: начинаем файл заново
                    have = 0
                    part.unlink(missing_ok=True)
                with part.open("ab") as f:
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                        if on_chunk:
                            on_chunk(len(chunk))
            attempt = 0
        except (OSError, urllib.error.URLError) as error:
            attempt += 1
            if attempt > retries:
                raise RuntimeError(f"{target.name}: не качается после {retries} попыток ({error})") from error
            time.sleep(min(60, 2 ** attempt))
    if part.stat().st_size != size:
        raise RuntimeError(f"{target.name}: размер {part.stat().st_size}, ждали {size}")
    os.replace(part, target)


def write_progress(dest: Path, data: dict) -> None:
    tmp = dest / "progress.json.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, dest / "progress.json")


def run(dest: Path, link: str, api: str = API, pult: Pult | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    files = list_files(link, api)
    total = sum(f["size"] for f in files)
    done = sum(f["size"] for f in files if (dest / f["name"]).is_file() and (dest / f["name"]).stat().st_size == f["size"])
    partial = sum((dest / (f["name"] + ".part")).stat().st_size for f in files if (dest / (f["name"] + ".part")).exists())
    need = total - done - partial
    free = shutil.disk_usage(dest).free
    if need > free:
        msg = f"Не хватает места: нужно ещё {need / GB:.1f} ГБ, свободно {free / GB:.1f} ГБ на диске {dest.anchor}"
        print(msg)
        if pult:
            pult.say(msg, "error", force=True)
        return 2
    print(f"{SOURCE_NOTE}. Частей: {len(files)}, всего {total / GB:.1f} ГБ, осталось {(need) / GB:.1f} ГБ. Папка: {dest}")
    if pult:
        pult.say(f"Качаю базу Букварикса: {len(files)} частей, {total / GB:.1f} ГБ. Компьютер не выключай; "
                 f"после перерыва продолжу с того же места.", force=True)
    got = done + partial
    state = {"source": SOURCE_NOTE, "link": link, "files": len(files), "total": total, "started": time.time()}

    def tick(n: int) -> None:
        nonlocal got
        got += n
        if pult:
            pult.say(f"База Букварикса: {got / total * 100:.0f}% ({got / GB:.1f} из {total / GB:.1f} ГБ)")

    base = download_base(api)
    for i, f in enumerate(files, 1):
        target = dest / f["name"]
        if target.is_file() and target.stat().st_size == f["size"]:
            continue
        write_progress(dest, {**state, "current": f["name"], "index": i, "got": got, "updated": time.time()})
        try:
            fetch_file(f"{base}/{f['weblink']}", target, f["size"], on_chunk=tick)
        except RuntimeError:
            base = download_base(api)      # адрес раздачи мог смениться: берём новый и пробуем ещё раз
            fetch_file(f"{base}/{f['weblink']}", target, f["size"], on_chunk=tick)
    (dest / "DONE.json").write_text(json.dumps({**state, "finished": time.time(),
                                               "names": [f["name"] for f in files]}, ensure_ascii=False, indent=1),
                                    encoding="utf-8")
    write_progress(dest, {**state, "got": total, "done": True, "updated": time.time()})
    print(f"Готово: {dest}")
    if pult:
        pult.say(f"База Букварикса скачана: {total / GB:.1f} ГБ. Дальше её сожмём в части «Темы».", "ok", force=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass
    p = argparse.ArgumentParser(description="Скачать базу ключевых слов Букварикса с докачкой")
    p.add_argument("--dest", help="куда качать (по умолчанию <дом Studio>/data/bukvarix)")
    p.add_argument("--link", help="ссылка на папку в облаке, вида NZyu/saCDZpUEX (по умолчанию — со страницы Букварикса)")
    p.add_argument("--list", action="store_true", help="только показать части и размер")
    p.add_argument("--background", action="store_true", help="запустить в фоне и выйти")
    args = p.parse_args(argv)
    home = studio_home()
    dest = Path(args.dest).expanduser() if args.dest else home / "data" / "bukvarix"
    link = args.link or current_link()
    if args.list:
        files = list_files(link)
        for f in files:
            print(f"{f['name']}\t{f['size'] / GB:.2f} ГБ")
        print(f"Всего {sum(f['size'] for f in files) / GB:.1f} ГБ, частей {len(files)}. {SOURCE_NOTE}")
        return 0
    if args.background:
        dest.mkdir(parents=True, exist_ok=True)
        log = (dest / "fetch.log").open("ab")
        kwargs: dict = {"stdout": log, "stderr": log, "stdin": subprocess.DEVNULL, "close_fds": True}
        if os.name == "nt":
            kwargs["creationflags"] = 0x00000008 | 0x00000200
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--dest", str(dest), "--link", link], **kwargs)
        print(f"Скачивание идёт в фоне. Прогресс: {dest / 'progress.json'} и Пульт. Журнал: {dest / 'fetch.log'}")
        return 0
    return run(dest, link, pult=Pult(home))


if __name__ == "__main__":
    sys.exit(main())
