"""Check the current schema and the Git-tracked catalog database."""

from pathlib import Path
import sqlite3
import unittest


ROOT = Path(__file__).resolve().parents[1]


def structure(db):
    tables = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
    )]
    result = {}
    for table in tables:
        indexes = sorted(db.execute(f"PRAGMA index_list('{table}')").fetchall(), key=lambda row: row[1])
        result[table] = {
            "columns": db.execute(f"PRAGMA table_info('{table}')").fetchall(),
            "references": db.execute(f"PRAGMA foreign_key_list('{table}')").fetchall(),
            "indexes": [(row[1:], db.execute(f"PRAGMA index_info('{row[1]}')").fetchall())
                        for row in indexes],
        }
    return result


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript((ROOT / "schema.sql").read_text())

    def test_catalog_structure_matches_schema_and_is_consistent(self):
        catalog = sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
        self.addCleanup(catalog.close)
        self.assertEqual(structure(self.db), structure(catalog))
        self.assertEqual([("ok",)], catalog.execute("PRAGMA integrity_check").fetchall())
        self.assertEqual([], catalog.execute("PRAGMA foreign_key_check").fetchall())

    def test_benchmark_urls_are_required_and_not_empty(self):
        for url in ("https://example.test/benchmark",):
            row = self.db.execute(
                "INSERT INTO benchmark(name, url) VALUES (?, ?) RETURNING id, url",
                ("Benchmark", url),
            ).fetchone()
            self.assertIsInstance(row[0], int)
            self.assertEqual(url, row[1])
        for url in (None, "", "   "):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("INSERT INTO benchmark(name, url) VALUES (?, ?)", ("Benchmark", url))

    def test_score_requires_a_real_value_on_insert_and_update(self):
        self.db.execute("INSERT INTO model(id, name) VALUES (1, 'Model')")
        self.db.execute("INSERT INTO benchmark(id, name, url) VALUES (1, 'Test', 'https://example.test')")
        self.db.execute("INSERT INTO benchmark_measure(id, benchmark_id, name) VALUES (1, 1, 'accuracy')")
        for value in (None, 'not a score'):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("INSERT INTO score_assertion(model_id, benchmark_measure_id, value) VALUES (1, 1, ?)", (value,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO score_assertion(model_id, benchmark_measure_id) VALUES (1, 1)")
        self.db.execute("INSERT INTO score_assertion(id, model_id, benchmark_measure_id, value) VALUES (1, 1, 1, 0)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE score_assertion SET value = NULL WHERE id = 1")

    def test_hle_uses_canonical_variants_preserving_real_subsets(self):
        catalog = sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
        self.addCleanup(catalog.close)
        variants = catalog.execute("""
            SELECT id, name FROM benchmark
            WHERE lower(name) LIKE '%humanity%' OR lower(name) LIKE '%hle%'
        """).fetchall()
        self.assertEqual({name for _, name in variants}, {
            "Humanity’s Last Exam (no tools)", "Humanity’s Last Exam (with tools)",
            "Humanity’s Last Exam (text-only, no tools)",
            "Humanity’s Last Exam (text-only, with tools)",
        })
        self.assertEqual(len(variants), 4)
        for benchmark_id, _ in variants:
            measures = catalog.execute("""
                SELECT id, name, unit, higher_is_better FROM benchmark_measure
                WHERE benchmark_id = ?
            """, (benchmark_id,)).fetchall()
            self.assertEqual([row[1:] for row in measures], [("accuracy", "percent", 1)])
            self.assertGreater(catalog.execute(
                "SELECT count(*) FROM score_assertion WHERE benchmark_measure_id = ?",
                (measures[0][0],),
            ).fetchone()[0], 0)

    def test_arc_agi_2_verification_does_not_create_benchmark_or_measure_aliases(self):
        catalog = sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
        self.addCleanup(catalog.close)
        variants = catalog.execute(
            "SELECT id, name FROM benchmark WHERE name LIKE 'ARC-AGI-2%'"
        ).fetchall()
        self.assertEqual([name for _, name in variants], ["ARC-AGI-2"])
        measures = catalog.execute(
            "SELECT name, unit, higher_is_better FROM benchmark_measure WHERE benchmark_id = ?",
            (variants[0][0],),
        ).fetchall()
        self.assertEqual(measures, [("accuracy", "percent", 1)])
        # Original verified labels must survive consolidation at assertion level.
        for assertion_id in (134, 269, 573, 574, 615, 616):
            conditions = catalog.execute(
                "SELECT conditions FROM score_assertion WHERE id = ?", (assertion_id,),
            ).fetchone()[0]
            self.assertIn("source labels this result Verified", conditions)
            self.assertIn("evaluation split not recorded", conditions)

    def test_mmlu_shot_protocols_are_measures(self):
        catalog = sqlite3.connect((ROOT / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
        self.addCleanup(catalog.close)
        rows = catalog.execute("""
            SELECT a.id, bm.name, bm.unit, bm.higher_is_better, a.value, a.conditions
            FROM score_assertion a
            JOIN benchmark_measure bm ON bm.id = a.benchmark_measure_id
            JOIN benchmark b ON b.id = bm.benchmark_id WHERE b.name = 'MMLU'
        """).fetchall()
        self.assertEqual(len(rows), 53)
        by_id = {r[0]: r[1:] for r in rows}
        # GPT-4 and five-shot Llama must be visible in the same comparison;
        # the same Llama's zero-shot evaluation must remain separate.
        self.assertEqual(by_id[819][:4], ('5-shot accuracy', 'percent', 1, 86.4))
        self.assertEqual(by_id[1039][0], '5-shot accuracy')
        self.assertEqual(by_id[1044][0], '0-shot accuracy')
        self.assertIn('chain-of-thought', by_id[1044][4])
        self.assertIn('chain-of-thought', by_id[35][4])
        self.assertIn('chain-of-thought', by_id[36][4])
        self.assertEqual(by_id[336][0], 'accuracy (shot count unspecified)')
        for _, measure, _, _, _, conditions in rows:
            self.assertNotRegex(conditions or '', r'\b[05]-shot\b')
            self.assertNotIn('Instruction tuned', conditions or '')
            self.assertNotIn('Base pretrained', conditions or '')

    def test_foreign_keys_reject_missing_benchmarks_and_referenced_deletions(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO benchmark_measure(benchmark_id, name) VALUES (1, 'Accuracy')"
            )
        self.db.execute("INSERT INTO benchmark(id, name, url) VALUES (1, 'Benchmark', 'https://example.test/benchmark')")
        self.db.execute(
            "INSERT INTO benchmark_measure(benchmark_id, name) VALUES (1, 'Accuracy')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM benchmark WHERE id = 1")
