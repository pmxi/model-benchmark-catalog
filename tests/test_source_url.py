"""Regression coverage for removing retrievals without losing source evidence."""

from pathlib import Path
import sqlite3
import unittest

from test_integer_ids import insert_graph, schema_objects


ROOT = Path(__file__).resolve().parents[1]
OLD_SCHEMA = (ROOT / "tests/fixtures/integer_ids_with_retrieval.sql").read_text()
MIGRATION = (ROOT / "migrations/002_source_url.sql").read_text()


class SourceUrlMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(OLD_SCHEMA)
        self.ids = insert_graph(self.db, "one")
        insert_graph(self.db, "two", text_score=True, anonymous=True)
        self.db.execute(
            "INSERT INTO score_citation(score_assertion_id, source_retrieval_id, locator) VALUES (?, ?, ?)",
            (self.ids["score_assertion"], self.ids["source_retrieval"], "Second mention"),
        )
        # Include a source with no cited scores.
        source = self.db.execute("INSERT INTO source(title) VALUES ('Unscored post') RETURNING id").fetchone()[0]
        self.db.execute(
            "INSERT INTO source_retrieval(source_id, fetched_at, requested_url, final_url) VALUES (?, ?, ?, ?)",
            (source, "2026-10-06T20:00:00Z", "https://example.test/old", "https://example.test/final"),
        )
        self.db.commit()

    def test_preserves_ids_content_links_and_uncited_sources(self):
        expected_sources = self.db.execute(
            "SELECT s.id, s.title, r.final_url, s.publisher_id, s.published_at, s.coverage_note "
            "FROM source s JOIN source_retrieval r ON r.source_id=s.id ORDER BY s.id"
        ).fetchall()
        expected_citations = self.db.execute(
            "SELECT c.id, c.score_assertion_id, r.source_id, c.locator, c.excerpt, c.note "
            "FROM score_citation c JOIN source_retrieval r ON r.id=c.source_retrieval_id ORDER BY c.id"
        ).fetchall()
        untouched = {t: self.db.execute(f"SELECT * FROM {t} ORDER BY id").fetchall()
                     for t in ("organization", "model", "benchmark", "benchmark_measure", "score_assertion")}
        self.db.executescript(MIGRATION)
        self.assertEqual(expected_sources, self.db.execute("SELECT * FROM source ORDER BY id").fetchall())
        self.assertEqual(expected_citations, self.db.execute("SELECT * FROM score_citation ORDER BY id").fetchall())
        for table, expected in untouched.items():
            self.assertEqual(expected, self.db.execute(f"SELECT * FROM {table} ORDER BY id").fetchall())
        self.assertEqual([], self.db.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual([("ok",)], self.db.execute("PRAGMA integrity_check").fetchall())
        self.assertEqual([], self.db.execute("PRAGMA table_info(source_retrieval)").fetchall())
        fresh = sqlite3.connect(":memory:")
        self.addCleanup(fresh.close)
        fresh.executescript((ROOT / "schema.sql").read_text())
        self.assertEqual(schema_objects(fresh), schema_objects(self.db))

    def test_rejects_multiple_retrievals_and_rolls_back(self):
        self.db.execute(
            "INSERT INTO source_retrieval(source_id, fetched_at, requested_url, final_url) VALUES (?, ?, ?, ?)",
            (self.ids["source"], "2026-10-07T20:00:00Z", "https://example.test/changed", "https://example.test/changed"),
        )
        self.db.commit()
        before = list(self.db.iterdump())
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(MIGRATION)
        self.db.rollback()
        self.assertEqual(before, list(self.db.iterdump()))

    def test_rejects_missing_retrieval(self):
        self.db.execute("INSERT INTO source(title) VALUES ('Missing URL')")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(MIGRATION)
        self.db.rollback()
        self.assertEqual((4,), self.db.execute("SELECT COUNT(*) FROM source").fetchone())

    def test_rejects_rerun(self):
        self.db.executescript(MIGRATION)
        before = list(self.db.iterdump())
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.executescript(MIGRATION)
        self.db.rollback()
        self.assertEqual(before, list(self.db.iterdump()))


if __name__ == "__main__":
    unittest.main()
