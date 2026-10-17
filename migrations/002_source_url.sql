-- Store one URL on each source and link citations directly to sources.
-- Back up first, then use a fresh connection that stops on the first error:
-- sqlite3 -bail catalog.sqlite < migrations/002_source_url.sql
-- Retrieval timestamps, requested URLs, and snapshot metadata are removed.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
PRAGMA legacy_alter_table = OFF;

BEGIN IMMEDIATE;

CREATE TEMP TABLE _source_url_migration_check (
    ok INTEGER NOT NULL CHECK (ok = 1)
);
-- Require the preceding schema and reject a rerun before modifying any table.
INSERT INTO _source_url_migration_check
SELECT EXISTS (SELECT 1 FROM pragma_table_info('source') WHERE name = 'id' AND type = 'INTEGER')
   AND NOT EXISTS (SELECT 1 FROM pragma_table_info('source') WHERE name = 'url')
   AND EXISTS (SELECT 1 FROM pragma_table_info('score_citation') WHERE name = 'source_retrieval_id');
INSERT INTO _source_url_migration_check
SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check);
-- Do not silently choose a URL if a different catalog has ambiguous evidence.
INSERT INTO _source_url_migration_check
SELECT NOT EXISTS (
    SELECT s.id FROM source AS s
    LEFT JOIN source_retrieval AS r ON r.source_id = s.id
    GROUP BY s.id HAVING COUNT(r.id) <> 1
);

CREATE TABLE _new_source (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0),
    publisher_id INTEGER REFERENCES organization(id),
    published_at TEXT,
    coverage_note TEXT
) STRICT;

CREATE TABLE _new_score_citation (
    id INTEGER PRIMARY KEY,
    score_assertion_id INTEGER NOT NULL REFERENCES score_assertion(id),
    source_id INTEGER NOT NULL REFERENCES _new_source(id),
    locator TEXT NOT NULL CHECK (length(trim(locator)) > 0),
    excerpt TEXT,
    note TEXT
) STRICT;

INSERT INTO _new_source (id, title, url, publisher_id, published_at, coverage_note)
SELECT s.id, s.title, r.final_url, s.publisher_id, s.published_at, s.coverage_note
FROM source AS s JOIN source_retrieval AS r ON r.source_id = s.id;

INSERT INTO _new_score_citation (id, score_assertion_id, source_id, locator, excerpt, note)
SELECT c.id, c.score_assertion_id, r.source_id, c.locator, c.excerpt, c.note
FROM score_citation AS c JOIN source_retrieval AS r ON r.id = c.source_retrieval_id;

INSERT INTO _source_url_migration_check
SELECT (SELECT COUNT(*) FROM _new_source) = (SELECT COUNT(*) FROM source)
   AND (SELECT COUNT(*) FROM _new_score_citation) = (SELECT COUNT(*) FROM score_citation);

DROP TABLE score_citation;
DROP TABLE source_retrieval;
DROP TABLE source;
ALTER TABLE _new_source RENAME TO source;
ALTER TABLE _new_score_citation RENAME TO score_citation;

CREATE INDEX source_publisher_idx ON source(publisher_id);
CREATE INDEX score_citation_assertion_idx ON score_citation(score_assertion_id);
CREATE INDEX score_citation_source_idx ON score_citation(source_id);

INSERT INTO _source_url_migration_check
SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check);
INSERT INTO _source_url_migration_check
SELECT COUNT(*) = 1 AND MIN(integrity_check) = 'ok' FROM pragma_integrity_check;
DROP TABLE _source_url_migration_check;
COMMIT;
