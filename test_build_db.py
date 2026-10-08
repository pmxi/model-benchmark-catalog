"""Behavior checks for assertion identity and citation preservation.

Run with: uv run python -m unittest test_build_db.py
"""

import sqlite3
import unittest

from build_db import ROOT, add_score_evidence


class ScoreEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript((ROOT / "schema.sql").read_text())
        self.db.execute("INSERT INTO model(id, name) VALUES ('m', 'Model')")
        self.db.execute("INSERT INTO benchmark(id, name) VALUES ('b', 'Benchmark')")
        self.db.execute(
            "INSERT INTO benchmark_measure(id, benchmark_id, name, metric) "
            "VALUES ('measure', 'b', 'Accuracy', 'accuracy')"
        )
        self.db.executemany(
            "INSERT INTO source(id, title) VALUES (?, ?)",
            [("s1", "Launch post"), ("s2", "Independent report")],
        )
        self.db.executemany(
            """INSERT INTO source_retrieval
               (id, source_id, fetched_at, requested_url, final_url)
               VALUES (?, ?, ?, 'https://example.com/report', 'https://example.com/report')""",
            [("r1", "s1", "2026-10-06T12:00:00Z"),
             ("r2", "s2", "2026-10-06T12:00:00Z"),
             ("r3", "s1", "2026-10-07T12:00:00Z")],
        )

    def add(self, retrieval="r1", **changes):
        score = dict(model="Model", benchmark="Benchmark", measure="Accuracy",
                     value="50%", locator="Table 1, row Model", excerpt="Model scored 50%.")
        score.update(changes)
        add_score_evidence(self.db, score, "m", "measure", retrieval)

    def count(self, table):
        return self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

    def test_shared_assertion_keeps_each_citation_and_original_wording(self):
        self.add()
        self.add("r2", model="Model alias", value="50.0%", excerpt="Alias: 50.0%")
        self.add()  # Re-importing the same occurrence is idempotent.
        self.assertEqual(self.count("score_assertion"), 1)
        self.assertEqual(self.count("score_citation"), 2)
        self.assertEqual(
            self.db.execute("SELECT value_numeric, value_text, unit FROM score_assertion").fetchone(),
            (50.0, None, "percent"),
        )
        excerpt = self.db.execute(
            "SELECT excerpt FROM score_citation WHERE source_retrieval_id='r2'"
        ).fetchone()[0]
        self.assertIn("Model: Model alias", excerpt)
        self.assertIn("Value: 50.0%", excerpt)
        self.assertIn("Source excerpt:\nAlias: 50.0%", excerpt)

    def test_later_retrieval_adds_evidence_for_same_assertion(self):
        self.add()
        self.add("r3")
        self.assertEqual(self.count("score_assertion"), 1)
        self.assertEqual(self.count("score_citation"), 2)

    def test_conditions_and_value_units_are_part_of_the_assertion(self):
        self.add()
        self.add(configuration="tools enabled")
        self.add(configuration="tools disabled")
        self.add(qualifier="relative improvement")
        self.add(value="50")  # Unknown unit is not percent.
        self.assertEqual(self.count("score_assertion"), 5)
        self.assertEqual(self.count("score_citation"), 5)

    def test_text_result_and_extraction_note_survive(self):
        self.add(value=">99%", note="Bound, not an exact score.")
        self.assertEqual(
            self.db.execute("SELECT value_numeric, value_text FROM score_assertion").fetchone(),
            (None, ">99%"),
        )
        self.assertEqual(
            self.db.execute("SELECT note FROM score_citation").fetchone()[0],
            "Bound, not an exact score.",
        )

    def test_invalid_values_and_dangling_citations_are_rejected(self):
        for number, text in ((None, None), (50.0, "50%")):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(
                    """INSERT INTO score_assertion
                       (id, model_id, benchmark_measure_id, value_numeric, value_text)
                       VALUES ('invalid', 'm', 'measure', ?, ?)""", (number, text)
                )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO score_citation
                   (id, score_assertion_id, source_retrieval_id, locator)
                   VALUES ('invalid', 'missing', 'r1', 'Table 1')"""
            )


if __name__ == "__main__":
    unittest.main()
