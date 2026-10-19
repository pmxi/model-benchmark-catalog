from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from website.server import create_server, database_snapshot
from website.build import build_site


ROOT = Path(__file__).resolve().parents[1]


class CatalogServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "catalog.sqlite"
        with closing(sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(self.path)) as destination:
                source.backup(destination)

    def test_snapshot_preserves_all_data_without_writing_source(self):
        before = self.path.read_bytes()
        with closing(sqlite3.connect(":memory:")) as snapshot:
            snapshot.deserialize(database_snapshot(self.path))
            with closing(sqlite3.connect(self.path)) as source:
                self.assertEqual(list(source.iterdump()), list(snapshot.iterdump()))
            self.assertEqual([("ok",)], snapshot.execute("PRAGMA integrity_check").fetchall())
            self.assertEqual([], snapshot.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual(before, self.path.read_bytes())

    def test_snapshot_includes_committed_wal_data_and_needs_no_sidecar(self):
        with closing(sqlite3.connect(self.path)) as source:
            source.execute("PRAGMA journal_mode = WAL")
            source.execute("INSERT INTO model(name) VALUES ('Committed WAL model')")
            source.commit()
            snapshot = database_snapshot(self.path)
            self.assertEqual(snapshot[18:20], b"\x01\x01")
            with closing(sqlite3.connect(":memory:")) as db:
                db.deserialize(snapshot)
                self.assertEqual(1, db.execute(
                    "SELECT count(*) FROM model WHERE name = 'Committed WAL model'"
                ).fetchone()[0])

    def test_build_contains_only_public_assets_and_a_valid_database(self):
        output = Path(self.directory.name) / "model-benchmark-catalog"
        build_site(output, self.path)
        self.assertTrue((output / "index.html").is_file())
        self.assertTrue((output / "catalog.mjs").is_file())
        self.assertTrue((output / "vendor/sql.js/sql-wasm.wasm").is_file())
        self.assertTrue((output / "vendor/sql.js/LICENSE").is_file())
        self.assertTrue((output / ".nojekyll").is_file())
        self.assertFalse((output / "server.py").exists())
        self.assertFalse((output / "README.md").exists())
        self.assertFalse((output / ".git").exists())
        with closing(sqlite3.connect(output / "catalog.sqlite")) as db:
            self.assertEqual([("ok",)], db.execute("PRAGMA integrity_check").fetchall())
        with self.assertRaises(ValueError):
            build_site(ROOT, self.path)

    def test_missing_database_is_not_created(self):
        path = Path(self.directory.name) / "missing.sqlite"
        with self.assertRaises(sqlite3.OperationalError):
            database_snapshot(path)
        self.assertFalse(path.exists())

    def test_http_reads_current_data_and_only_serves_known_assets(self):
        server = create_server(self.path, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with urlopen(base + "/catalog.sqlite") as response:
                first = response.read()
                self.assertEqual("no-store", response.headers["Cache-Control"])
            with sqlite3.connect(self.path) as db:
                db.execute("INSERT INTO model(name) VALUES ('A newly collected model')")
            with urlopen(base + "/catalog.sqlite") as response:
                second = response.read()
            with closing(sqlite3.connect(":memory:")) as db:
                db.deserialize(first)
                count = db.execute("SELECT count(*) FROM model").fetchone()[0]
                db.deserialize(second)
                self.assertEqual(count + 1, db.execute("SELECT count(*) FROM model").fetchone()[0])
            with urlopen(base + "/vendor/sql.js/sql-wasm.wasm") as response:
                self.assertEqual("application/wasm", response.headers["Content-Type"])
                self.assertEqual(b"\x00asm", response.read()[:4])
            with urlopen(base + "/") as response:
                self.assertIn(b"app.mjs", response.read())
            for path in ("/api/catalog", "/server.py", "/../README.md", "/.openai/hosting.json"):
                with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                    urlopen(base + path)
                self.assertEqual(404, error.exception.code)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
