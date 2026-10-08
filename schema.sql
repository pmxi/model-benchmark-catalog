-- AI model and benchmark catalog: SQLite schema.
-- Apply to a new database with: sqlite3 catalog.sqlite < schema.sql
-- Enable foreign keys on EVERY SQLite connection; the PRAGMA is connection-local.
PRAGMA foreign_keys = ON;

BEGIN;

-- IDs are stable, opaque TEXT values supplied by the importer. Relation names are
-- singular. Identity records contain only the minimum fields needed to match a
-- report; sourced metadata attributes can be added as typed relations later.
CREATE TABLE organization (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0)
) STRICT;

CREATE TABLE model (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    developer_id TEXT REFERENCES organization(id)
) STRICT;

CREATE TABLE benchmark (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

-- A measure is a benchmark-specific task/subset + metric + aggregation rule.
-- Use distinct measures when their meaning changes. Model snapshots and
-- benchmark versions remain in recorded labels. NULL higher_is_better means
-- not established.
CREATE TABLE benchmark_measure (
    id TEXT PRIMARY KEY NOT NULL,
    benchmark_id TEXT NOT NULL REFERENCES benchmark(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    task TEXT,
    subset TEXT,
    metric TEXT NOT NULL CHECK (length(trim(metric)) > 0),
    aggregation_rule TEXT,
    unit TEXT CHECK (unit IS NULL OR length(trim(unit)) > 0),
    higher_is_better INTEGER CHECK (higher_is_better IN (0, 1)),
    UNIQUE (id, benchmark_id)
) STRICT;

-- A source identifies a document, not a URL. One URL can change over time and
-- one document can have multiple URLs. Publication date may be date-only.
CREATE TABLE source (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    publisher_id TEXT REFERENCES organization(id),
    published_at TEXT,
    coverage_note TEXT
) STRICT;

-- When a snapshot is available, snapshot_location must point to retrievable
-- bytes and content_hash is their lowercase SHA-256. Some publishers block
-- archiving; leave BOTH fields NULL rather than claiming a snapshot exists.
-- fetched_at uses UTC ISO 8601 with whole seconds, e.g. 2026-10-06T20:00:00Z.
CREATE TABLE source_retrieval (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL REFERENCES source(id),
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

-- Links a model name to a source that names it, including launch posts with no
-- score. The relationship alone does not prove that every named model launched
-- on the source's publication date; some articles include comparison models.
CREATE TABLE model_mention (
    id TEXT PRIMARY KEY NOT NULL,
    source_retrieval_id TEXT NOT NULL REFERENCES source_retrieval(id),
    reported_model_name TEXT NOT NULL CHECK (length(trim(reported_model_name)) > 0),
    model_id TEXT REFERENCES model(id)
) STRICT;

-- A source may mention a benchmark without reporting a readable numeric score.
-- Score observations themselves also establish benchmark use; this relation is
-- for mentions that would otherwise be lost from the catalog.
CREATE TABLE benchmark_mention (
    id TEXT PRIMARY KEY NOT NULL,
    source_retrieval_id TEXT NOT NULL REFERENCES source_retrieval(id),
    reported_benchmark_name TEXT NOT NULL
        CHECK (length(trim(reported_benchmark_name)) > 0),
    source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) > 0),
    benchmark_id TEXT REFERENCES benchmark(id)
) STRICT;

-- One row is one score as reported by one retrieved source. Never deduplicate
-- by model/measure/value. Preserve raw wording even after resolving IDs.
-- A NULL normalized ID means the identity has not been resolved. The composite
-- foreign key ensures the measure belongs to the named benchmark.
CREATE TABLE score_observation (
    id TEXT PRIMARY KEY NOT NULL,
    source_retrieval_id TEXT NOT NULL REFERENCES source_retrieval(id),
    source_locator TEXT NOT NULL CHECK (length(trim(source_locator)) > 0),
    source_excerpt TEXT,
    reported_model_name TEXT NOT NULL CHECK (length(trim(reported_model_name)) > 0),
    reported_benchmark_name TEXT NOT NULL CHECK (length(trim(reported_benchmark_name)) > 0),
    reported_measure_name TEXT NOT NULL CHECK (length(trim(reported_measure_name)) > 0),
    reported_value_text TEXT NOT NULL CHECK (length(trim(reported_value_text)) > 0),
    model_id TEXT REFERENCES model(id),
    benchmark_id TEXT REFERENCES benchmark(id),
    benchmark_measure_id TEXT,
    value_numeric REAL,
    reported_configuration_text TEXT,
    reported_evaluator_name TEXT,
    reported_evaluation_date TEXT,
    qualifier_text TEXT,
    extraction_note TEXT,
    CHECK (benchmark_measure_id IS NULL OR benchmark_id IS NOT NULL),
    FOREIGN KEY (benchmark_measure_id, benchmark_id)
        REFERENCES benchmark_measure(id, benchmark_id)
) STRICT;

CREATE INDEX model_developer_idx ON model(developer_id);
CREATE INDEX benchmark_measure_benchmark_idx ON benchmark_measure(benchmark_id);
CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX source_retrieval_source_time_idx ON source_retrieval(source_id, fetched_at);
CREATE INDEX model_mention_retrieval_idx ON model_mention(source_retrieval_id);
CREATE INDEX model_mention_model_idx ON model_mention(model_id);
CREATE INDEX benchmark_mention_retrieval_idx ON benchmark_mention(source_retrieval_id);
CREATE INDEX benchmark_mention_benchmark_idx ON benchmark_mention(benchmark_id);
CREATE INDEX score_observation_retrieval_idx ON score_observation(source_retrieval_id);
CREATE INDEX score_observation_comparison_idx
    ON score_observation(model_id, benchmark_measure_id);
COMMIT;
