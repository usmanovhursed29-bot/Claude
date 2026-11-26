"""Проверки скачивания полной базы Букварикса: докачка после обрыва на подставном облаке."""
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bukvarix_fetch  # noqa: E402

FILES = {"keywords.part01.rar": b"Rar!" + b"a" * 3000, "keywords.part02.rar": b"b" * 1500}


class FakeCloud(BaseHTTPRequestHandler):
    drops = 1   # первая отдача файла рвётся посередине: проверяем докачку

    def log_message(self, *a):
        pass

    def do_POST(self):
        port = self.server.server_address[1]
        self.reply(json.dumps({"body": {"weblink_get": [{"url": f"http://127.0.0.1:{port}/dl"}]}}).encode())

    def do_GET(self):
        if self.path.startswith("/api/v2/folder"):
            body = {"body": {"list": [{"name": n, "size": len(b), "weblink": f"AB/cd/{n}", "type": "file"}
                                      for n, b in FILES.items()] + [{"name": "sub", "type": "folder"}]}}
            return self.reply(json.dumps(body).encode())
        name = self.path.rsplit("/", 1)[-1]
        data = FILES[name]
        start = int(self.headers.get("Range", "bytes=0-").split("=")[1].split("-")[0] or 0)
        chunk = data[start:]
        self.send_response(206)
        self.send_header("Content-Length", str(len(chunk)))
        self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        self.end_headers()
        if FakeCloud.drops and len(chunk) > 100:
            FakeCloud.drops -= 1
            self.wfile.write(chunk[:100])
            self.wfile.flush()
            self.connection.close()        # обрыв на сотом байте
            return
        self.wfile.write(chunk)

    def reply(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FetchTest(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeCloud)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.api = f"http://127.0.0.1:{self.httpd.server_address[1]}/api/v2"
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def test_downloads_with_resume(self):
        dest = Path(self.tmp.name) / "bukvarix"
        with mock.patch("builtins.print"), mock.patch("time.sleep"):
            self.assertEqual(0, bukvarix_fetch.run(dest, "AB/cd", api=self.api))
        for name, data in FILES.items():
            self.assertEqual(data, (dest / name).read_bytes())
        self.assertTrue((dest / "DONE.json").is_file())
        self.assertTrue(json.loads((dest / "progress.json").read_text(encoding="utf-8"))["done"])
        self.assertEqual([], list(dest.glob("*.part")))

    def test_finds_main_base_link(self):
        html = ('<td>Яндекс</td><a href="https://cloud.mail.ru/public/XXXX/old">x</a>'
                '<td>База ключевых слов</td><a href="https://cloud.mail.ru/public/NZyu/saCDZpUEX">Облако</a>'
                '<a href="https://cloud.mail.ru/public/vHwS/7nMpeS3a2">Облако</a>')
        self.assertEqual("NZyu/saCDZpUEX", bukvarix_fetch.find_link(html))

    def test_home_from_profile(self):
        nekurs = Path(self.tmp.name) / "nekurs"
        nekurs.mkdir()
        (nekurs / "profile.md").write_text("# Профиль\n- Studio: D:\\studio\n", encoding="utf-8")
        with mock.patch.dict("os.environ", {"NEKURS_HOME": str(nekurs)}, clear=False):
            import os
            os.environ.pop("STUDIO_HOME", None)
            self.assertEqual(Path("D:\\studio"), bukvarix_fetch.studio_home())


if __name__ == "__main__":
    unittest.main()
