-- SQLite schema for the AI model and benchmark catalog.
-- Create an empty database with: sqlite3 new_catalog.sqlite < schema.sql
-- Enable foreign keys on EVERY SQLite connection; the PRAGMA is connection-local.
PRAGMA foreign_keys = ON;

BEGIN;

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

CREATE TABLE source (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0),
    publisher_id INTEGER REFERENCES organization(id),
    published_at TEXT,
    coverage_note TEXT
) STRICT;

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

CREATE TABLE score_citation (
    id INTEGER PRIMARY KEY,
    score_assertion_id INTEGER NOT NULL REFERENCES score_assertion(id),
    source_id INTEGER NOT NULL REFERENCES source(id),
    locator TEXT NOT NULL CHECK (length(trim(locator)) > 0),
    excerpt TEXT,
    note TEXT
) STRICT;

CREATE INDEX model_developer_idx ON model(developer_id);
CREATE INDEX benchmark_measure_benchmark_idx ON benchmark_measure(benchmark_id);
CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX score_assertion_comparison_idx
    ON score_assertion(model_id, benchmark_measure_id);
CREATE INDEX score_assertion_measure_idx ON score_assertion(benchmark_measure_id);
CREATE INDEX score_citation_assertion_idx ON score_citation(score_assertion_id);
CREATE INDEX score_citation_source_idx ON score_citation(source_id);
COMMIT;
