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

CREATE TABLE model_version (
    id TEXT PRIMARY KEY NOT NULL,
    model_id TEXT NOT NULL REFERENCES model(id),
    identifier TEXT NOT NULL CHECK (length(trim(identifier)) > 0),
    UNIQUE (model_id, identifier),
    UNIQUE (id, model_id)
) STRICT;

CREATE TABLE benchmark (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

CREATE TABLE benchmark_version (
    id TEXT PRIMARY KEY NOT NULL,
    benchmark_id TEXT NOT NULL REFERENCES benchmark(id),
    identifier TEXT NOT NULL CHECK (length(trim(identifier)) > 0),
    UNIQUE (benchmark_id, identifier),
    UNIQUE (id, benchmark_id)
) STRICT;

-- A measure is a benchmark-specific task/subset + metric + aggregation rule.
-- A measure is version-independent unless its meaning changes; then create a
-- distinct measure. NULL higher_is_better means not established.
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

-- One row is one score as reported by one retrieved source. Never deduplicate
-- by model/measure/value. Preserve raw wording even after resolving IDs.
-- A NULL normalized ID means the identity has not been resolved. Composite
-- foreign keys ensure a version/measure belongs to the named parent.
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
    model_version_id TEXT,
    benchmark_id TEXT REFERENCES benchmark(id),
    benchmark_version_id TEXT,
    benchmark_measure_id TEXT,
    value_numeric REAL,
    reported_configuration_text TEXT,
    reported_evaluator_name TEXT,
    reported_evaluation_date TEXT,
    qualifier_text TEXT,
    extraction_note TEXT,
    CHECK (model_version_id IS NULL OR model_id IS NOT NULL),
    CHECK (benchmark_version_id IS NULL OR benchmark_id IS NOT NULL),
    CHECK (benchmark_measure_id IS NULL OR benchmark_id IS NOT NULL),
    FOREIGN KEY (model_version_id, model_id)
        REFERENCES model_version(id, model_id),
    FOREIGN KEY (benchmark_version_id, benchmark_id)
        REFERENCES benchmark_version(id, benchmark_id),
    FOREIGN KEY (benchmark_measure_id, benchmark_id)
        REFERENCES benchmark_measure(id, benchmark_id)
) STRICT;

-- No configuration row is needed when the report provides no setting.
-- A missing setting means unreported in the catalog; explicitly_unknown means
-- the source itself says it is unknown. Do not deduplicate configurations.
CREATE TABLE evaluation_configuration (
    id TEXT PRIMARY KEY NOT NULL,
    score_observation_id TEXT NOT NULL UNIQUE REFERENCES score_observation(id)
) STRICT;

CREATE TABLE configuration_setting (
    id TEXT PRIMARY KEY NOT NULL,
    evaluation_configuration_id TEXT NOT NULL REFERENCES evaluation_configuration(id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL
        CHECK (status IN ('reported', 'explicitly_unknown', 'inapplicable')),
    value_text TEXT,
    source_text TEXT,
    UNIQUE (evaluation_configuration_id, name),
    CHECK (
        (status = 'reported' AND value_text IS NOT NULL AND length(trim(value_text)) > 0)
        OR (status <> 'reported' AND value_text IS NULL)
    )
) STRICT;

-- An evaluation is an identifiable underlying study or experiment. It may
-- summarize many trials; it is not necessarily one execution. The note states
-- the evidence for identifying it, rather than allowing an empty placeholder.
CREATE TABLE evaluation (
    id TEXT PRIMARY KEY NOT NULL,
    identity_note TEXT NOT NULL CHECK (length(trim(identity_note)) > 0),
    evaluator_id TEXT REFERENCES organization(id),
    evaluated_at TEXT,
    description TEXT
) STRICT;

CREATE TABLE observation_evaluation (
    score_observation_id TEXT NOT NULL REFERENCES score_observation(id),
    evaluation_id TEXT NOT NULL REFERENCES evaluation(id),
    basis TEXT NOT NULL CHECK (length(trim(basis)) > 0),
    PRIMARY KEY (score_observation_id, evaluation_id)
) STRICT;

-- A supported reporting/copying relationship, never inferred from equal scores.
CREATE TABLE observation_derivation (
    observation_id TEXT NOT NULL REFERENCES score_observation(id),
    derived_from_observation_id TEXT NOT NULL REFERENCES score_observation(id),
    basis TEXT NOT NULL CHECK (length(trim(basis)) > 0),
    PRIMARY KEY (observation_id, derived_from_observation_id),
    CHECK (observation_id <> derived_from_observation_id)
) STRICT;

-- Prevent indirect cycles in the derivation graph on insert and link changes.
CREATE TRIGGER observation_derivation_no_cycle_insert
BEFORE INSERT ON observation_derivation
BEGIN
    SELECT RAISE(ABORT, 'observation derivation cycle')
    WHERE NEW.observation_id IN (
        WITH RECURSIVE ancestor(id) AS (
            SELECT NEW.derived_from_observation_id
            UNION
            SELECT d.derived_from_observation_id
            FROM observation_derivation AS d JOIN ancestor AS a
                ON d.observation_id = a.id
        )
        SELECT id FROM ancestor
    );
END;

CREATE TRIGGER observation_derivation_no_cycle_update
BEFORE UPDATE OF observation_id, derived_from_observation_id ON observation_derivation
BEGIN
    SELECT RAISE(ABORT, 'observation derivation cycle')
    WHERE NEW.observation_id IN (
        WITH RECURSIVE ancestor(id) AS (
            SELECT NEW.derived_from_observation_id
            UNION
            SELECT d.derived_from_observation_id
            FROM observation_derivation AS d JOIN ancestor AS a
                ON d.observation_id = a.id
        )
        SELECT id FROM ancestor
    );
END;

CREATE INDEX model_developer_idx ON model(developer_id);
CREATE INDEX model_version_model_idx ON model_version(model_id);
CREATE INDEX benchmark_version_benchmark_idx ON benchmark_version(benchmark_id);
CREATE INDEX benchmark_measure_benchmark_idx ON benchmark_measure(benchmark_id);
CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX source_retrieval_source_time_idx ON source_retrieval(source_id, fetched_at);
CREATE INDEX score_observation_retrieval_idx ON score_observation(source_retrieval_id);
CREATE INDEX score_observation_comparison_idx
    ON score_observation(model_id, benchmark_measure_id);
CREATE INDEX score_observation_model_version_idx ON score_observation(model_version_id);
CREATE INDEX score_observation_benchmark_version_idx ON score_observation(benchmark_version_id);
CREATE INDEX configuration_setting_configuration_idx
    ON configuration_setting(evaluation_configuration_id);
CREATE INDEX evaluation_evaluator_idx ON evaluation(evaluator_id);
CREATE INDEX observation_evaluation_evaluation_idx ON observation_evaluation(evaluation_id);
CREATE INDEX observation_derivation_parent_idx
    ON observation_derivation(derived_from_observation_id);

COMMIT;
