-- Upgrade the original eight-table catalog from text IDs to integer IDs.
-- Back up first. Run on a fresh connection, stopping and rolling back on error:
-- sqlite3 -bail catalog.sqlite < migrations/001_integer_ids.sql
-- Each original rowid becomes its public ID; references are resolved against
-- the original tables before any are dropped. No content-based deduplication.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
PRAGMA legacy_alter_table = OFF;

BEGIN IMMEDIATE;

-- Fail before changing catalog tables if this is not the text-ID schema,
-- including when the migration has already been applied.
CREATE TEMP TABLE _integer_id_migration_check (
    ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _integer_id_migration_check
SELECT COUNT(*) = 8
FROM main.sqlite_schema AS s, pragma_table_info(s.name) AS c
WHERE s.type = 'table'
  AND s.name IN ('organization', 'model', 'benchmark', 'benchmark_measure', 'source', 'source_retrieval', 'score_assertion', 'score_citation')
  AND c.name = 'id' AND c.type = 'TEXT' AND c.pk = 1;

-- Do not silently turn dangling optional references into NULL during the copy.
INSERT INTO _integer_id_migration_check
SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check);

CREATE TABLE _new_organization (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0)
) STRICT;

CREATE TABLE _new_model (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    developer_id INTEGER REFERENCES _new_organization(id)
) STRICT;

CREATE TABLE _new_benchmark (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

-- A measure is a benchmark-specific task/subset + metric + aggregation rule.
-- Use distinct measures when their meaning changes. Model snapshots and
-- benchmark versions remain in recorded labels. NULL higher_is_better means
-- not established.
CREATE TABLE _new_benchmark_measure (
    id INTEGER PRIMARY KEY,
    benchmark_id INTEGER NOT NULL REFERENCES _new_benchmark(id),
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
CREATE TABLE _new_source (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    publisher_id INTEGER REFERENCES _new_organization(id),
    published_at TEXT,
    coverage_note TEXT
) STRICT;

-- When a snapshot is available, snapshot_location must point to retrievable
-- bytes and content_hash is their lowercase SHA-256. Some publishers block
-- archiving; leave BOTH fields NULL rather than claiming a snapshot exists.
-- fetched_at uses UTC ISO 8601 with whole seconds, e.g. 2026-10-06T20:00:00Z.
CREATE TABLE _new_source_retrieval (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES _new_source(id),
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
CREATE TABLE _new_score_assertion (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES _new_model(id),
    benchmark_measure_id INTEGER NOT NULL REFERENCES _new_benchmark_measure(id),
    value_numeric REAL,
    value_text TEXT CHECK (value_text IS NULL OR length(trim(value_text)) > 0),
    unit TEXT CHECK (unit IS NULL OR length(trim(unit)) > 0),
    conditions TEXT CHECK (conditions IS NULL OR length(trim(conditions)) > 0),
    CHECK ((value_numeric IS NULL) <> (value_text IS NULL))
) STRICT;

-- One occurrence of an assertion in a retrieved source. Multiple citations can
-- support the same assertion. excerpt can hold a labeled table transcription
-- and the original source excerpt; note holds extraction commentary.
CREATE TABLE _new_score_citation (
    id INTEGER PRIMARY KEY,
    score_assertion_id INTEGER NOT NULL REFERENCES _new_score_assertion(id),
    source_retrieval_id INTEGER NOT NULL REFERENCES _new_source_retrieval(id),
    locator TEXT NOT NULL CHECK (length(trim(locator)) > 0),
    excerpt TEXT,
    note TEXT
) STRICT;

INSERT INTO _new_organization (id, name, url)
SELECT old.rowid, old.name, old.url
FROM organization AS old;

INSERT INTO _new_model (id, name, developer_id)
SELECT old.rowid, old.name, parent_0.rowid
FROM model AS old
LEFT JOIN organization AS parent_0 ON parent_0.id = old.developer_id;

INSERT INTO _new_benchmark (id, name)
SELECT old.rowid, old.name
FROM benchmark AS old;

INSERT INTO _new_benchmark_measure (id, benchmark_id, name, task, subset, metric, aggregation_rule, unit, higher_is_better)
SELECT old.rowid, parent_0.rowid, old.name, old.task, old.subset, old.metric, old.aggregation_rule, old.unit, old.higher_is_better
FROM benchmark_measure AS old
LEFT JOIN benchmark AS parent_0 ON parent_0.id = old.benchmark_id;

INSERT INTO _new_source (id, title, publisher_id, published_at, coverage_note)
SELECT old.rowid, old.title, parent_0.rowid, old.published_at, old.coverage_note
FROM source AS old
LEFT JOIN organization AS parent_0 ON parent_0.id = old.publisher_id;

INSERT INTO _new_source_retrieval (id, source_id, fetched_at, requested_url, final_url, snapshot_location, content_hash)
SELECT old.rowid, parent_0.rowid, old.fetched_at, old.requested_url, old.final_url, old.snapshot_location, old.content_hash
FROM source_retrieval AS old
LEFT JOIN source AS parent_0 ON parent_0.id = old.source_id;

INSERT INTO _new_score_assertion (id, model_id, benchmark_measure_id, value_numeric, value_text, unit, conditions)
SELECT old.rowid, parent_0.rowid, parent_1.rowid, old.value_numeric, old.value_text, old.unit, old.conditions
FROM score_assertion AS old
LEFT JOIN model AS parent_0 ON parent_0.id = old.model_id
LEFT JOIN benchmark_measure AS parent_1 ON parent_1.id = old.benchmark_measure_id;

INSERT INTO _new_score_citation (id, score_assertion_id, source_retrieval_id, locator, excerpt, note)
SELECT old.rowid, parent_0.rowid, parent_1.rowid, old.locator, old.excerpt, old.note
FROM score_citation AS old
LEFT JOIN score_assertion AS parent_0 ON parent_0.id = old.score_assertion_id
LEFT JOIN source_retrieval AS parent_1 ON parent_1.id = old.source_retrieval_id;

-- Check copy counts before replacing any original table.
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_organization) = (SELECT COUNT(*) FROM organization);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_model) = (SELECT COUNT(*) FROM model);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_benchmark) = (SELECT COUNT(*) FROM benchmark);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_benchmark_measure) = (SELECT COUNT(*) FROM benchmark_measure);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_source) = (SELECT COUNT(*) FROM source);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_source_retrieval) = (SELECT COUNT(*) FROM source_retrieval);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_score_assertion) = (SELECT COUNT(*) FROM score_assertion);
INSERT INTO _integer_id_migration_check
SELECT (SELECT COUNT(*) FROM _new_score_citation) = (SELECT COUNT(*) FROM score_citation);

-- Drop children first so foreign-key enforcement can stay enabled.
DROP TABLE score_citation;
DROP TABLE score_assertion;
DROP TABLE source_retrieval;
DROP TABLE source;
DROP TABLE benchmark_measure;
DROP TABLE benchmark;
DROP TABLE model;
DROP TABLE organization;

-- SQLite updates references to the new tables as they are renamed.
ALTER TABLE _new_organization RENAME TO organization;
ALTER TABLE _new_model RENAME TO model;
ALTER TABLE _new_benchmark RENAME TO benchmark;
ALTER TABLE _new_benchmark_measure RENAME TO benchmark_measure;
ALTER TABLE _new_source RENAME TO source;
ALTER TABLE _new_source_retrieval RENAME TO source_retrieval;
ALTER TABLE _new_score_assertion RENAME TO score_assertion;
ALTER TABLE _new_score_citation RENAME TO score_citation;

CREATE INDEX model_developer_idx ON model(developer_id);
CREATE INDEX benchmark_measure_benchmark_idx ON benchmark_measure(benchmark_id);
CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX source_retrieval_source_time_idx ON source_retrieval(source_id, fetched_at);
CREATE INDEX score_assertion_comparison_idx
    ON score_assertion(model_id, benchmark_measure_id);
CREATE INDEX score_assertion_measure_idx ON score_assertion(benchmark_measure_id);
CREATE INDEX score_citation_assertion_idx ON score_citation(score_assertion_id);
CREATE INDEX score_citation_retrieval_idx ON score_citation(source_retrieval_id);

INSERT INTO _integer_id_migration_check
SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check);
INSERT INTO _integer_id_migration_check
SELECT COUNT(*) = 1 AND MIN(integrity_check) = 'ok'
FROM pragma_integrity_check;

DROP TABLE _integer_id_migration_check;
COMMIT;
