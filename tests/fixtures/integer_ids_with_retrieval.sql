-- AI model and benchmark catalog: SQLite schema.
-- Create an empty database with: sqlite3 new_catalog.sqlite < schema.sql
-- Enable foreign keys on EVERY SQLite connection; the PRAGMA is connection-local.
PRAGMA foreign_keys = ON;

BEGIN;

-- IDs are database-local integers assigned by SQLite when omitted on INSERT.
-- Relation names are singular. Identity records contain only the minimum fields
-- needed to match a report; sourced metadata attributes can be added later.
CREATE TABLE organization (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0)
) STRICT;

CREATE TABLE model (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    developer_id INTEGER REFERENCES organization(id)
) STRICT;

CREATE TABLE benchmark (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

-- A measure is a benchmark-specific task/subset + metric + aggregation rule.
-- Use distinct measures when their meaning changes. Model snapshots and
-- benchmark versions remain in recorded labels. NULL higher_is_better means
-- not established.
CREATE TABLE benchmark_measure (
    id INTEGER PRIMARY KEY,
    benchmark_id INTEGER NOT NULL REFERENCES benchmark(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    task TEXT,
    subset TEXT,
    metric TEXT NOT NULL CHECK (length(trim(metric)) > 0),
    aggregation_rule TEXT,
    unit TEXT CHECK (unit IS NULL OR length(trim(unit)) > 0),
    higher_is_better INTEGER CHECK (higher_is_better IN (0, 1))
) STRICT;

-- A source identifies a document, not a URL. One URL can change over time and
-- one document can have multiple URLs. Publication date may be date-only.
CREATE TABLE source (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    publisher_id INTEGER REFERENCES organization(id),
    published_at TEXT,
    coverage_note TEXT
) STRICT;

-- When a snapshot is available, snapshot_location must point to retrievable
-- bytes and content_hash is their lowercase SHA-256. Some publishers block
-- archiving; leave BOTH fields NULL rather than claiming a snapshot exists.
-- fetched_at uses UTC ISO 8601 with whole seconds, e.g. 2026-10-06T20:00:00Z.
CREATE TABLE source_retrieval (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES source(id),
    fetched_at TEXT NOT NULL
        CHECK (fetched_at GLOB '????-??-??T??:??:??Z'),
    requested_url TEXT NOT NULL CHECK (length(trim(requested_url)) > 0),
    final_url TEXT NOT NULL CHECK (length(trim(final_url)) > 0),
    snapshot_location TEXT CHECK (snapshot_location IS NULL OR length(trim(snapshot_location)) > 0),
    content_hash TEXT
        CHECK (content_hash IS NULL OR
            (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
    CHECK ((snapshot_location IS NULL) = (content_hash IS NULL))
) STRICT;

-- A source-independent proposition about a model's result on a measure.
-- Exactly one value representation is used: a number, or a text expression for
-- bounds, ranges, combined results, and other values not yet parsed safely.
-- unit describes the stored value's scale (e.g. percent). conditions preserves
-- qualifications that affect the claim. Unknown conditions imply no guarantee
-- of comparable setups or a shared underlying experiment.
CREATE TABLE score_assertion (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES model(id),
    benchmark_measure_id INTEGER NOT NULL REFERENCES benchmark_measure(id),
    value_numeric REAL,
    value_text TEXT CHECK (value_text IS NULL OR length(trim(value_text)) > 0),
    unit TEXT CHECK (unit IS NULL OR length(trim(unit)) > 0),
    conditions TEXT CHECK (conditions IS NULL OR length(trim(conditions)) > 0),
    CHECK ((value_numeric IS NULL) <> (value_text IS NULL))
) STRICT;

-- One occurrence of an assertion in a retrieved source. Multiple citations can
-- support the same assertion. excerpt can hold a labeled table transcription
-- and the original source excerpt; note holds extraction commentary.
CREATE TABLE score_citation (
    id INTEGER PRIMARY KEY,
    score_assertion_id INTEGER NOT NULL REFERENCES score_assertion(id),
    source_retrieval_id INTEGER NOT NULL REFERENCES source_retrieval(id),
    locator TEXT NOT NULL CHECK (length(trim(locator)) > 0),
    excerpt TEXT,
    note TEXT
) STRICT;

CREATE INDEX model_developer_idx ON model(developer_id);
CREATE INDEX benchmark_measure_benchmark_idx ON benchmark_measure(benchmark_id);
CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX source_retrieval_source_time_idx ON source_retrieval(source_id, fetched_at);
CREATE INDEX score_assertion_comparison_idx
    ON score_assertion(model_id, benchmark_measure_id);
CREATE INDEX score_assertion_measure_idx ON score_assertion(benchmark_measure_id);
CREATE INDEX score_citation_assertion_idx ON score_citation(score_assertion_id);
CREATE INDEX score_citation_retrieval_idx ON score_citation(source_retrieval_id);
COMMIT;
