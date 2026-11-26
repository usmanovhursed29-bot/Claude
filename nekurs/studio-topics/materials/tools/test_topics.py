"""Проверки «Тем»: карта из гайда целая, поиск ниш, запросы через API (фальшивый сервер), таблица тем с источником."""
import gzip
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import topics  # noqa: E402


def niche(i, name, group, flag="ok", demand=1000, giants=0.5, questions=0.2, money=0.1, small=100, queries=()):
    return {"id": i, "name": name, "group": group, "flag": flag, "demand_all": demand * 2, "demand": demand, "nq": 10,
            "money": money, "giants": giants, "small_clicks": small, "questions": questions,
            "winners": [{"site": "zub.ru", "clicks": 90, "top3": 3}], "queries": list(queries), "heads": list(queries[:2])}


MAP = {"meta": {"source": topics.SOURCE, "map_built": "2026-11-08", "exported": "2026-11-16", "base": "тест"},
       "niches": [
           niche(10, "Стоматология", "Здоровье и медицина", demand=5000, giants=0.27, questions=0.35,
                 queries=("сколько зубов у человека", "удаление зуба мудрости", "брекеты цена", "как лечат кариес")),
           niche(5, "Новости", "Новости, праздники, общество", demand=90000, giants=0.9, questions=0.0, money=0.0, small=9000,
                 queries=("новости сегодня", "зубр в беловежской пуще")),
           niche(7, "Мебель", "Покупки и одежда", demand=3000, giants=0.4, questions=0.1, money=0.3, queries=("купить диван",)),
           niche(8, "Входы в кабинеты", "Справочное", flag="junk", demand=99999, queries=("личный кабинет",)),
       ]}


class FakeApi(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        seed = q["q"][0]
        if q.get("api_key") != ["free"]:
            self.send_response(401)
            self.end_headers()
            return
        data = {"брекеты": [["брекеты", 1, 7, 824435, 53435], ["брекеты цена", 2, 12, 90000, 9000], ["брекеты редко", 2, 13, 50, 3]],
                "брекеты цена": [["брекеты цена", 2, 12, 95000, 9100], ["сколько стоят брекеты", 3, 21, 40000, 4000]]}.get(seed, [])
        body = json.dumps({"data": data}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=UTF-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "studio"
        self.map = Path(self.tmp.name) / "niches.json.gz"
        with gzip.open(self.map, "wb") as f:
            f.write(json.dumps(MAP, ensure_ascii=False).encode("utf-8"))
        self.env = mock.patch.dict(os.environ, {"STUDIO_HOME": str(self.home)})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def run_cmd(self, *argv):
        with mock.patch("builtins.print") as out:
            code = topics.main(["--map", str(self.map), *argv])
        return code, "\n".join(" ".join(map(str, c.args)) for c in out.call_args_list)


class BundledMapTest(unittest.TestCase):
    def test_map_from_guide_is_whole(self):
        data = topics.load_map(str(topics.BUNDLED_MAP))
        self.assertGreater(len(data["niches"]), 1000)
        self.assertIn("Букварикс", data["meta"]["source"])
        flags = {n["flag"] for n in data["niches"]}
        self.assertLessEqual(flags, {"ok", "junk"})  # 18+ и казино в карту не попадают
        n = data["niches"][0]
        for key in ("id", "name", "group", "demand_all", "demand", "money", "giants", "small_clicks", "questions",
                    "winners", "queries", "heads"):
            self.assertIn(key, n)
        self.assertLess(topics.BUNDLED_MAP.stat().st_size, 5 * 1024 * 1024)  # лимит файла в клубе


class MapTest(Base):
    def test_best_for_reels_skips_junk_and_giants(self):
        code, out = self.run_cmd("map", "--csv", str(self.home / "k.csv"))
        self.assertEqual(0, code)
        rows = (self.home / "k.csv").read_text(encoding="utf-8-sig").splitlines()
        self.assertTrue(rows[1].startswith("10;Стоматология"), rows)  # вопросы и мало гигантов — наверху
        self.assertNotIn("Входы в кабинеты", "\n".join(rows))
        self.assertTrue(rows[-1].startswith("# " + topics.SOURCE))

    def test_words_find_own_niche_first(self):
        code, out = self.run_cmd("map", "зуб", "брекет", "--csv", str(self.home / "w.csv"))
        rows = (self.home / "w.csv").read_text(encoding="utf-8-sig").splitlines()
        self.assertIn("совпадений", rows[0])
        self.assertTrue(rows[1].startswith("10;"))  # своя ниша первая, «зубр» в новостях — ниже

    def test_single_hits_dropped_when_strong_niches_exist(self):
        data = json.loads(json.dumps(MAP))
        for i in (11, 12):
            data["niches"].append(niche(i, f"Зубы {i}", "Здоровье и медицина", queries=("лечение зуба", "зуб болит")))
        with gzip.open(self.map, "wb") as f:
            f.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        self.run_cmd("map", "зуб", "--csv", str(self.home / "w.csv"))
        text = (self.home / "w.csv").read_text(encoding="utf-8-sig")
        self.assertIn("Зубы 11", text)
        self.assertNotIn("Новости", text)  # одно случайное совпадение («зубр») — шум

    def test_niche_details(self):
        code, out = self.run_cmd("niche", "10")
        self.assertIn("Стоматология", out)
        self.assertIn("zub.ru", out)
        self.assertIn(topics.SOURCE, out)
        with mock.patch("builtins.print"), self.assertRaises(SystemExit):
            topics.main(["--map", str(self.map), "niche", "999"])


class FetchTest(Base):
    def setUp(self):
        super().setUp()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeApi)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.api = mock.patch.object(topics, "API", f"http://127.0.0.1:{self.httpd.server_address[1]}/v1/keywords/")
        self.api.start()
        self.sleep = mock.patch.object(topics.time, "sleep")
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        self.api.stop()
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def test_merge_sort_filter_and_source(self):
        code, out = self.run_cmd("fetch", "брекеты", "брекеты цена", "--niche", "10")
        self.assertEqual(0, code)
        lines = (self.home / "data" / "topics" / "niche-10.tsv").read_text(encoding="utf-8").splitlines()
        self.assertEqual("запрос\tточная частота\tобщая частота\tслов", lines[0])
        self.assertEqual("брекеты\t53435\t824435\t1", lines[1])
        self.assertEqual("брекеты цена\t9100\t95000\t2", lines[2])  # из двух ответов берём большее
        self.assertEqual("сколько стоят брекеты\t4000\t40000\t3", lines[3])
        self.assertNotIn("брекеты редко", "\n".join(lines))  # точная частота меньше 10
        self.assertTrue(lines[-1].startswith("# " + topics.SOURCE))

    def test_cities_and_junk_dropped_drop_words_too(self):
        def fake(seed, limit):
            return [["ремонт мебели", 2, 13, 900, 600], ["ремонт мебели в москве", 4, 22, 400, 300],
                    ["ремонт мебели спб", 3, 17, 200, 100], ["ремонт духового шкафа", 3, 21, 300, 250],
                    ["ремонт мебели вакансии", 3, 22, 90, 50], ["ремонт мебели оквэд", 3, 19, 40, 30]]
        with mock.patch.object(topics, "api_get", side_effect=fake):
            code, out = self.run_cmd("fetch", "ремонт мебели", "--niche", "1", "--drop", "духов")
        self.assertEqual(0, code)
        text = (self.home / "data" / "topics" / "niche-1.tsv").read_text(encoding="utf-8")
        self.assertEqual(["ремонт мебели"], [l.split("\t")[0] for l in text.splitlines()[1:] if not l.startswith("#")])
        self.assertIn("с городом 2", text)
        self.assertIn("по --drop 1", text)
        with mock.patch.object(topics, "api_get", side_effect=fake):
            self.run_cmd("fetch", "ремонт мебели", "--niche", "2", "--cities")
        self.assertIn("ремонт мебели в москве", (self.home / "data" / "topics" / "niche-2.tsv").read_text(encoding="utf-8"))

    def test_phrase_needs_all_words_in_one_query(self):
        n = {"name": "Ремонт авто", "queries": ["ремонт авто", "мебель для дачи"], "heads": []}
        self.assertEqual(0, topics.match_score(n, ["ремонт мебел"]))
        self.assertEqual(2, topics.match_score(n, ["ремонт", "мебел"]))

    def test_refused_key_is_explained(self):
        with mock.patch.object(topics, "api_get", side_effect=SystemExit("Букварикс не пустил к API (код 401)")):
            with mock.patch("builtins.print"), self.assertRaises(SystemExit):
                topics.main(["fetch", "брекеты"])


class SheetTest(Base):
    def write(self, text):
        path = self.home / "out" / "topics" / "30-tem.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_good_sheet_gets_source_line(self):
        rows = ["тема;спрос;запросы;формат"] + [f"\"Сколько стоят брекеты, часть {i}\";{1000 + i};брекеты цена;разбор" for i in range(30)]
        path = self.write("\n".join(rows) + "\n")
        code, out = self.run_cmd("sheet", str(path))
        self.assertEqual(0, code)
        self.assertTrue(path.read_text(encoding="utf-8").rstrip().endswith("# " + topics.SOURCE))
        code, _ = self.run_cmd("sheet", str(path))  # второй раз источник не дублируется
        self.assertEqual(1, path.read_text(encoding="utf-8").count(topics.SOURCE))

    def test_short_or_broken_sheet_fails(self):
        path = self.write("тема,спрос\nКак лечат кариес,много\n")
        code, out = self.run_cmd("sheet", str(path))
        self.assertEqual(1, code)
        self.assertIn("тем 1, а нужно 30", out)
        self.assertIn("не число", out)


if __name__ == "__main__":
    unittest.main()
