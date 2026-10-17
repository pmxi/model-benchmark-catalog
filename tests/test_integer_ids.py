"""Data-preservation and failure-path tests for the one-time ID migration."""

from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
OLD_SCHEMA = (ROOT / "tests/fixtures/text_ids.sql").read_text()
SCHEMA = (ROOT / "tests/fixtures/integer_ids_with_retrieval.sql").read_text()
MIGRATION = (ROOT / "migrations/001_integer_ids.sql").read_text()
TABLES = (
    "organization", "model", "benchmark", "benchmark_measure", "source",
    "source_retrieval", "score_assertion", "score_citation",
)


def insert_graph(db, suffix, *, legacy=False, text_score=False, anonymous=False):
    """Use repeated names to ensure migration follows IDs, not content matches."""
    ids = {}

    def add(table, **values):
        if legacy:
            values = {"id": f"{table}_{suffix}", **values}
        columns = ", ".join(values)
        placeholders = ", ".join("?" for _ in values)
        ids[table] = db.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING id",
            tuple(values.values()),
        ).fetchone()[0]
        return ids[table]

    organization = add("organization", name="Same publisher", url="https://example.test")
    model = add("model", name="Same model", developer_id=None if anonymous else organization)
    benchmark = add("benchmark", name="Same benchmark")
    measure = add(
        "benchmark_measure", benchmark_id=benchmark, name="accuracy",
        task="reasoning", subset="hard", metric="accuracy", aggregation_rule="mean",
        unit="percent", higher_is_better=None if anonymous else 1,
    )
    source = add(
        "source", title="Same title", publisher_id=None if anonymous else organization,
        published_at="2026-10-06", coverage_note="Chart cells omitted — verify later.",
    )
    retrieval = add(
        "source_retrieval", source_id=source, fetched_at="2026-10-06T20:00:00Z",
        requested_url="https://example.test/report", final_url="https://example.test/report/",
        snapshot_location=None if anonymous else "/archive/report.html",
        content_hash=None if anonymous else "a" * 64,
    )
    assertion = add(
        "score_assertion", model_id=model, benchmark_measure_id=measure,
        value_numeric=None if text_score else 88.5,
        value_text="≥ 90%" if text_score else None,
        unit="percent", conditions=None if anonymous else "5-shot; no tools",
    )
    add(
        "score_citation", score_assertion_id=assertion, source_retrieval_id=retrieval,
        locator="Table 1, row 2", excerpt="Original wording\nwith a second line.",
        note=None if anonymous else "Manually checked.",
    )
    return ids


def rows(db):
    return {table: db.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() for table in TABLES}


def schema_objects(db):
    # ALTER TABLE quotes renamed identifiers; ignore this formatting difference.
    return [
        (kind, name, " ".join(sql.replace('"', '').split()))
        for kind, name, sql in db.execute(
            "SELECT type, name, sql FROM sqlite_schema "
            "WHERE sql IS NOT NULL ORDER BY type, name"
        )
    ]


class IntegerIdMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(OLD_SCHEMA)
        first = insert_graph(self.db, "z", legacy=True)
        insert_graph(self.db, "a", legacy=True, text_score=True)
        insert_graph(self.db, "m", legacy=True, anonymous=True)
        self.db.execute(
            "INSERT INTO score_citation VALUES (?, ?, ?, ?, ?, ?)",
            ("second_citation", first["score_assertion"], first["source_retrieval"],
             "Appendix", "A second citation of the same assertion.", None),
        )
        # Exercise sparse IDs whose ordering differs from the old text keys.
        for table in TABLES:
            self.db.execute(f"UPDATE {table} SET rowid = rowid * 10 + 7")
        self.db.commit()

    def test_preserves_every_value_and_relationship(self):
        mappings = {
            table: dict(self.db.execute(f"SELECT id, rowid FROM {table}"))
            for table in TABLES
        }
        expected = {}
        for table in TABLES:
            columns = [r[1] for r in self.db.execute(f"PRAGMA table_info({table})")]
            references = {r[3]: r[2] for r in self.db.execute(f"PRAGMA foreign_key_list({table})")}
            references["id"] = table
            expected[table] = sorted(
                tuple(mappings[references[column]][value]
                      if column in references and value is not None else value
                      for column, value in zip(columns, row))
                for row in self.db.execute(f"SELECT * FROM {table}")
            )

        self.db.executescript(MIGRATION)
        self.assertEqual(expected, rows(self.db))
        self.assertEqual([], self.db.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual([("ok",)], self.db.execute("PRAGMA integrity_check").fetchall())
        self.assertEqual((1,), self.db.execute("PRAGMA foreign_keys").fetchone())
        self.assertEqual([], self.db.execute("SELECT name FROM sqlite_temp_schema").fetchall())

    def test_matches_fresh_schema_and_generates_ids(self):
        self.db.executescript(MIGRATION)
        fresh = sqlite3.connect(":memory:")
        self.addCleanup(fresh.close)
        fresh.executescript(SCHEMA)
        self.assertEqual(schema_objects(fresh), schema_objects(self.db))
        for db in (fresh, self.db):
            maxima = {t: db.execute(f"SELECT COALESCE(MAX(id), 0) FROM {t}").fetchone()[0] for t in TABLES}
            generated = insert_graph(db, "new")
            for table, value in generated.items():
                self.assertIsInstance(value, int)
                self.assertGreater(value, maxima[table])
                self.assertEqual((value,), db.execute(f"SELECT rowid FROM {table} WHERE id = ?", (value,)).fetchone())
            self.assertEqual([], db.execute("PRAGMA foreign_key_check").fetchall())

    def test_constraints_remain_enforced(self):
        self.db.executescript(MIGRATION)
        for sql in (
            "INSERT INTO model(name, developer_id) VALUES ('orphan', 99999)",
            "INSERT INTO model(name, developer_id) VALUES ('text key', 'openai')",
            "UPDATE score_assertion SET value_numeric = NULL, value_text = NULL",
            "UPDATE score_assertion SET value_numeric = 1, value_text = '1'",
            "UPDATE source_retrieval SET content_hash = NULL WHERE snapshot_location IS NOT NULL",
        ):
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_rejects_rerun_without_changes(self):
        self.db.executescript(MIGRATION)
        before, objects = rows(self.db), schema_objects(self.db)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(MIGRATION)
        self.db.rollback()
        self.assertEqual(before, rows(self.db))
        self.assertEqual(objects, schema_objects(self.db))

    def test_rejects_dangling_optional_reference(self):
        self.db.execute("PRAGMA foreign_keys = OFF")
        self.db.execute("UPDATE model SET developer_id = 'missing'")
        self.db.commit()
        before, objects = rows(self.db), schema_objects(self.db)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(MIGRATION)
        self.db.rollback()
        self.assertEqual(before, rows(self.db))
        self.assertEqual(objects, schema_objects(self.db))

    def test_cli_failure_after_copy_rolls_back(self):
        # Force a late failure to verify the documented -bail workflow restores
        # original tables even after their replacements have been populated.
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.sqlite"
            with sqlite3.connect(path) as target:
                self.db.backup(target)
            broken = MIGRATION.replace(
                "COMMIT;", "INSERT INTO _missing_table VALUES (1);\nCOMMIT;"
            )
            result = subprocess.run(
                ["sqlite3", "-bail", str(path)], input=broken,
                text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(0, result.returncode)
            self.assertIn("_missing_table", result.stderr)
            with sqlite3.connect(path) as reopened:
                self.assertEqual(rows(self.db), rows(reopened))
                self.assertEqual(schema_objects(self.db), schema_objects(reopened))


if __name__ == "__main__":
    unittest.main()
