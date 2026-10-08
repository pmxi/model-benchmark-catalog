"""Build catalog.sqlite from schema.sql and research/*.json using only the stdlib.

Run with: uv run python build_db.py
The command refuses to replace an existing database. Move it aside first when
intentionally rebuilding; extracted research inputs are kept in Git.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "catalog.sqlite"
RESEARCH_DIR = ROOT / "research"


def stable_id(prefix: str, *parts: str) -> str:
    raw = "\x1f".join(parts).encode("utf-8")
    return f"{prefix}_{hashlib.sha256(raw).hexdigest()[:20]}"


def normalized_url(url: str) -> str:
    return url.rstrip("/")


def company_for(url: str) -> tuple[str, str, str]:
    host = urlparse(url).hostname or ""
    if host == "openai.com" or host.endswith(".openai.com"):
        return "openai", "OpenAI", "https://openai.com"
    if host == "anthropic.com" or host.endswith(".anthropic.com"):
        return "anthropic", "Anthropic", "https://www.anthropic.com"
    raise ValueError(f"Unexpected source host: {url}")


def parsed_number(raw: str) -> float | None:
    # Only unambiguous single numbers are normalized. Ranges, ratios, Elo
    # differences, and statistical notation retain the exact source text only.
    match = re.fullmatch(r"\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%?\s*", raw)
    return float(match.group(1)) if match else None


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing {label}: {value!r}")
    return value.strip()


def add_score_evidence(
    db: sqlite3.Connection,
    score: dict,
    model_id: str,
    measure_id: str,
    retrieval_id: str,
) -> None:
    """Store a proposition once and attach each source occurrence separately."""
    name = require_text(score.get("model"), "score model")
    benchmark = require_text(score.get("benchmark"), "benchmark")
    measure = require_text(score.get("measure"), "measure")
    value = score.get("value")
    raw_value = require_text(str(value) if value is not None else None, "score value")
    locator = require_text(score.get("locator"), "source locator")
    number = parsed_number(raw_value)
    value_text = raw_value if number is None else None
    unit = score.get("unit")
    if unit == "%":
        unit = "percent"
    if number is not None and raw_value.endswith("%"):
        if unit not in (None, "percent"):
            raise ValueError(f"Conflicting score unit {unit!r}: {raw_value}")
        unit = "percent"
    conditions = "\n".join(
        f"{label}: {score[key]}"
        for key, label in (("configuration", "Configuration"), ("qualifier", "Qualifier"))
        if score.get(key)
    ) or None
    # Equal recorded propositions can share citations, without establishing
    # that their underlying evaluations or omitted settings are identical.
    proposition = (model_id, measure_id, number, value_text, unit, conditions)
    assertion_id = stable_id(
        "ast", json.dumps(proposition, ensure_ascii=False, separators=(",", ":"))
    )
    db.execute(
        """INSERT INTO score_assertion
           (id, model_id, benchmark_measure_id, value_numeric, value_text, unit, conditions)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING""",
        (assertion_id, *proposition),
    )
    # Preserve the source labels and exact score spelling as one readable
    # transcription instead of dedicated reported_* columns. This is labeled
    # as a transcription, not presented as a contiguous verbatim quotation.
    transcription = [
        "Reported row (transcription):",
        f"Model: {name}",
        f"Benchmark: {benchmark}",
        f"Measure: {measure}",
        f"Value: {raw_value}",
    ]
    if score.get("unit"):
        transcription.append(f"Unit: {score['unit']}")
    if conditions:
        transcription.append(conditions)
    if score.get("excerpt"):
        transcription.extend(("", "Source excerpt:", str(score["excerpt"])))
    citation_id = stable_id(
        "cit", assertion_id, retrieval_id, name, benchmark, measure, raw_value, locator
    )
    db.execute(
        """INSERT INTO score_citation
           (id, score_assertion_id, source_retrieval_id, locator, excerpt, note)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING""",
        (citation_id, assertion_id, retrieval_id, locator,
         "\n".join(transcription), score.get("note")),
    )


def main() -> None:
    if DB_PATH.exists():
        raise SystemExit(f"Refusing to replace existing {DB_PATH}")
    files = sorted(RESEARCH_DIR.glob("*.json"))
    if not files:
        raise SystemExit("No research/*.json files")
    retrieval_log = json.loads((ROOT / "retrieval_log.json").read_text())
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys = ON")
    try:
        db.executescript((ROOT / "schema.sql").read_text())
        with db:
            for file in files:
                data = json.loads(file.read_text())
                for post in data["posts"]:
                    url = normalized_url(require_text(post.get("url"), "post URL"))
                    retrieval = retrieval_log.get(url)
                    if not retrieval or not retrieval.get("verified"):
                        raise ValueError(f"No verified retrieval for {url}")
                    fetched_at = retrieval["fetched_at"]
                    company_id, company_name, company_url = company_for(url)
                    db.execute(
                        "INSERT OR IGNORE INTO organization(id, name, url) VALUES (?, ?, ?)",
                        (company_id, company_name, company_url),
                    )
                    source_id = stable_id("src", url)
                    source_title = require_text(post.get("title"), "post title")
                    notes = [
                        post.get(key)
                        for key in ("coverage_note", "coverage_notes", "notes", "note")
                        if post.get(key)
                    ]
                    if post.get("image_table_unextracted"):
                        notes.append("Benchmark image table has not been fully transcribed.")
                    coverage_note = " ".join(str(note) for note in notes) or None
                    db.execute(
                        """INSERT INTO source(id, title, publisher_id, published_at, coverage_note)
                           VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(id) DO UPDATE SET
                             coverage_note = COALESCE(source.coverage_note, excluded.coverage_note)""",
                        (source_id, source_title, company_id, post.get("date"), coverage_note),
                    )
                    retrieval_id = stable_id("ret", url, fetched_at)
                    db.execute(
                        """INSERT OR IGNORE INTO source_retrieval
                           (id, source_id, fetched_at, requested_url, final_url)
                           VALUES (?, ?, ?, ?, ?)""",
                        (retrieval_id, source_id, fetched_at, url, url),
                    )
                    for name in post.get("models", []):
                        name = require_text(name, "model name")
                        model_id = stable_id("mod", company_id, name.casefold())
                        db.execute(
                            "INSERT OR IGNORE INTO model(id, name, developer_id) VALUES (?, ?, ?)",
                            (model_id, name, company_id),
                        )
                    for mention in post.get("benchmark_mentions", []):
                        benchmark_name = require_text(
                            mention.get("benchmark"), "mentioned benchmark"
                        )
                        benchmark_id = stable_id("ben", benchmark_name.casefold())
                        db.execute(
                            "INSERT OR IGNORE INTO benchmark(id, name) VALUES (?, ?)",
                            (benchmark_id, benchmark_name),
                        )
                    for score in post.get("scores", []):
                        name = require_text(score.get("model"), "score model")
                        canonical_name = require_text(
                            score.get("normalized_model") or name, "normalized model"
                        )
                        benchmark_name = require_text(score.get("benchmark"), "benchmark")
                        measure_name = require_text(score.get("measure"), "measure")
                        model_id = stable_id("mod", company_id, canonical_name.casefold())
                        benchmark_id = stable_id("ben", benchmark_name.casefold())
                        measure_id = stable_id("mea", benchmark_id, measure_name.casefold())
                        db.execute(
                            "INSERT OR IGNORE INTO model(id, name, developer_id) VALUES (?, ?, ?)",
                            (model_id, canonical_name, company_id),
                        )
                        db.execute(
                            "INSERT OR IGNORE INTO benchmark(id, name) VALUES (?, ?)",
                            (benchmark_id, benchmark_name),
                        )
                        # The raw score text is authoritative. The metric name
                        # is a provisional source label. A missing unit stays
                        # unknown; no cross-post comparability is implied.
                        db.execute(
                            """INSERT OR IGNORE INTO benchmark_measure
                               (id, benchmark_id, name, metric, unit)
                               VALUES (?, ?, ?, ?, ?)""",
                            (
                                measure_id, benchmark_id, measure_name,
                                measure_name, score.get("unit"),
                            ),
                        )
                        if score.get("unit"):
                            db.execute(
                                "UPDATE benchmark_measure SET unit = ? WHERE id = ? AND unit IS NULL",
                                (score["unit"], measure_id),
                            )
                        add_score_evidence(db, score, model_id, measure_id, retrieval_id)
        problems = db.execute("PRAGMA foreign_key_check").fetchall()
        if problems:
            raise RuntimeError(f"Foreign key errors: {problems[:5]}")
        for table in ("model", "benchmark", "source", "score_assertion", "score_citation"):
            count = db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            print(f"{table}: {count}")
        print(f"Wrote {DB_PATH}")
    except Exception:
        db.close()
        DB_PATH.unlink(missing_ok=True)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
