from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from website.server import create_server, load_catalog


ROOT = Path(__file__).resolve().parents[1]


class CatalogServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "catalog.sqlite"
        with closing(sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(self.path)) as destination:
                source.backup(destination)

    def test_returns_every_assertion_once_with_direct_source_links(self):
        before = self.path.read_bytes()
        data = load_catalog(self.path)
        self.assertEqual(len(data["assertions"]), len({row["id"] for row in data["assertions"]}))
        sources = {row["id"]: row for row in data["sources"]}
        self.assertTrue(all(row["url"] for row in sources.values()))
        self.assertTrue(all(c["source_id"] in sources for c in data["citations"]))
        self.assertNotIn("retrievals", data)
        self.assertEqual(before, self.path.read_bytes())

    def test_missing_database_is_not_created(self):
        path = Path(self.directory.name) / "missing.sqlite"
        with self.assertRaises(sqlite3.OperationalError):
            load_catalog(path)
        self.assertFalse(path.exists())

    def test_http_reads_current_data_and_only_serves_known_assets(self):
        server = create_server(self.path, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with urlopen(base + "/api/catalog") as response:
                first = json.load(response)
                self.assertEqual("no-store", response.headers["Cache-Control"])
            with sqlite3.connect(self.path) as db:
                db.execute("INSERT INTO model(name) VALUES ('A newly collected model')")
            with urlopen(base + "/api/catalog") as response:
                second = json.load(response)
            self.assertEqual(len(first["models"]) + 1, len(second["models"]))
            with urlopen(base + "/") as response:
                self.assertIn(b"app.mjs", response.read())
            for path in ("/catalog.sqlite", "/server.py", "/../README.md", "/.openai/hosting.json"):
                with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                    urlopen(base + path)
                self.assertEqual(404, error.exception.code)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
