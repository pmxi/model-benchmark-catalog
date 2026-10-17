# AI model and benchmark catalog

This project aims to catalog major AI models, major benchmarks, and published evaluation results. It will **aggregate results reported by others**, not run benchmarks itself. Sources may include model developers, independent evaluators, benchmark maintainers, papers, and other public reports.

The goal is to make reported results easy to find and compare without hiding where a number came from or implying that unlike evaluations are directly comparable.

## Core idea

Separate **assertions**, **sources**, and **citations**:

- An assertion states that a model achieved a value on a benchmark measure under the recorded conditions.
- A source identifies a document, such as a model launch post, and stores its URL.
- A citation connects an assertion directly to a source, with a locator, excerpt, and any extraction note.

Multiple citations can support the same assertion. Different values or conditions remain separate assertions. Matching recorded propositions do not establish that reports describe the same experiment or that unknown settings match.

Preserve relevant excerpts where practical, since a URL alone cannot reconstruct a page after it changes. The catalog stores publication dates but does not track retrieval events or archived snapshots.

A comparison matrix is a **view over assertions**. A cell may contain several reported results. If a view selects one, it should state its selection rule and let readers inspect the alternatives, citations, and evaluation conditions.

## Current relations

Relation names are singular. Keep the schema limited to structures the catalog uses; add relations when concrete data or queries require them.

| Relation | Purpose |
| --- | --- |
| `organization` | Model developers, evaluators, publishers, and benchmark maintainers. |
| `model` | A model identity based on the recorded name, which may include a snapshot identifier. |
| `benchmark` | A benchmark identity based on the recorded name, which may include a version. |
| `benchmark_measure` | The specific quantity scored, including the task or subset, metric, unit, and aggregation rule. |
| `source` | A document or page, with its URL, publisher, publication date, and coverage note. |
| `score_assertion` | A model, benchmark measure, numeric or textual value, value unit, and known conditions, independent of its supporting sources. |
| `score_citation` | Evidence linking an assertion directly to a source, including locator, original wording, and extraction commentary. |

Versions currently remain in recorded names; evaluation conditions remain in assertion text. Separate version, configuration, experiment, and report-derivation tables can be introduced when there is a concrete need to populate and query them.

An assertion stores exactly one of `value_numeric` and `value_text`. Simple percentages become numbers with unit `percent`; bounds, ranges, and combined results remain text until they can be parsed safely. The benchmark is reached through `benchmark_measure_id`, so it is not repeated on the assertion.

Original model, benchmark, measure, and score wording lives in the citation's `excerpt`, as a labeled row transcription followed by the original source excerpt when available. The transcription is not presented as a contiguous verbatim quotation. Dedicated `reported_*` columns are unnecessary on the assertion.

Unknown details remain unknown; two assertions with missing settings are not thereby known to have equivalent configurations. Distinguish unknown settings from settings explicitly marked inapplicable.

Likewise, do not infer that matching scores came from the same evaluation. Statistical uncertainty, rounding precision, and confidence in extraction are different concepts and should not be collapsed into one field.

## Data quality principles

- Attribute factual datapoints to a source, including model and benchmark metadata where those facts are collected.
- Preserve conflicting reports and corrections rather than overwriting earlier assertions or citations.
- Record who published a result separately from who performed the evaluation, when known.
- Make benchmark version, measure definition, and evaluation conditions visible when comparing scores.
- Keep original source wording in citations, distinct from normalized identities and editorial choices used in a comparison view.

## Current data

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) is the source of truth. Read and write catalog data directly in SQLite. The current pass covers OpenAI and Anthropic launch material through October 6, 2026. It includes 89 source documents, 122 model records, 364 benchmark labels, and 851 score assertions supported by 852 citations. These counts include a linked GPT-4 technical report and posts that have no transcribed numeric scores.

Each citation retains the exact reported value, model and benchmark wording, and source location, and links directly to the document and its URL in `source`. Many posts put benchmark results only in images; those values have been omitted unless they were read and verified. Source records carry coverage notes for known gaps. This is a substantial first pass, **not an exhaustive inventory** of every release or every chart cell.

Reuse an assertion when model, measure, value, unit, and recorded conditions match. GPT-5's stored 88% Aider Polyglot assertion currently has two citations. All 71 results that cannot be represented by a single number remain textual assertions.

The normalized model and benchmark IDs are provisional exact-name groupings. Matching IDs do not establish that evaluation configurations, benchmark versions, or score units are comparable. Where a unit or configuration was not recorded, it remains unknown. Source URLs, citation locators, and excerpts provide the preserved evidence; there are no snapshot or content-hash columns.

## Write directly to SQLite

Each researcher or agent can open its own connection to the same local database. Enable foreign keys and a busy timeout on every connection:

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
```

Collect evidence before starting a transaction. Then use `BEGIN IMMEDIATE` to acquire the write lock, look up existing identities and assertions, insert the needed rows and citations, and `COMMIT`. Use `ROLLBACK` on failure. Keep transactions short; if a lock timeout occurs, roll back and retry the whole transaction. The lookup and insert must be in the same transaction to avoid competing writers creating duplicates.

When recording a score:

1. Find or add its model, benchmark, and benchmark measure.
2. Find or add its source document with its URL and known publication date.
3. Find or add the assertion, retaining its unit and known conditions. Store a number or a text value, never both.
4. Add a citation to that assertion and source, preserving the locator and original wording. Reuse an existing citation when the same evidence is already recorded.

Use parameterized SQL in scripts. Every table uses `id INTEGER PRIMARY KEY`, with integer foreign keys. Omit `id` when inserting a new row and use `INSERT ... RETURNING id` (or the connection's last-insert ID) to obtain the generated ID. Reuse IDs from lookup results when referring to existing rows. IDs are local to this database; do not generate them from names or assume they match IDs in another database. Duplicate detection still requires the lookups described above.

## Schema and backups

[model-benchmark-catalog/schema.sql](schema.sql) defines an empty database. It cannot reconstruct the collected data. Apply future schema changes to the existing database through SQL migrations and keep the schema definition in sync.

Before a migration, create a consistent backup using SQLite's backup command:

```sh
sqlite3 catalog.sqlite ".backup 'catalog.backup.sqlite'"
```

Keep working in the existing database as records are added or corrected. The earlier collection files are available in Git history.

### Integer ID migration

The checked-in database already includes both migrations. To upgrade an older copy with text IDs, first create the backup above, then run from `model-benchmark-catalog/`:

```sh
sqlite3 -bail catalog.sqlite < migrations/001_integer_ids.sql
sqlite3 -bail catalog.sqlite < migrations/002_source_url.sql
```

[model-benchmark-catalog/migrations/001_integer_ids.sql](migrations/001_integer_ids.sql) rebuilds the eight catalog tables in one transaction, preserving each old row's internal SQLite `rowid` as its new public ID and translating every foreign key. All other fields, constraints, and named indexes are preserved. Foreign-key enforcement stays enabled. The migration checks for the original text primary keys and valid references before copying, and checks integrity before committing. It rejects a second application.

Use a fresh connection and stop on the first error (`-bail` does this for the CLI). Closing a failed CLI connection rolls back the transaction; programmatic callers must roll back on error. The migration does not retain the old text IDs in the live schema; keep the backup if external references need translating. The backup's `id` and `rowid` columns provide that mapping. Restore the backup to undo the migration before making further edits.

The rebuild leaves freed pages available for reuse. Optionally run `sqlite3 catalog.sqlite 'VACUUM;'` after migration to reclaim that space.

### Source URL migration

For a copy that already has integer IDs but still has `source_retrieval`, apply only [model-benchmark-catalog/migrations/002_source_url.sql](migrations/002_source_url.sql). It copies each retrieval's `final_url` to `source.url`, replaces `score_citation.source_retrieval_id` with `source_id`, and drops the retrieval table and its metadata. Existing source and citation IDs remain unchanged. The migration requires exactly one retrieval per source, rejects a rerun, and runs in a single transaction with foreign keys enabled. Back up before applying it, as described above.

Run the migration regression tests with:

```sh
uv run --no-project python -m unittest discover -s tests -v
```

## Query

For example, inspect a reported score and its provenance with:

```sh
sqlite3 -header -column catalog.sqlite '
  SELECT m.name AS model, b.name AS benchmark, bm.name AS measure,
         a.value_numeric, a.value_text, a.unit, a.conditions,
         s.title AS source, s.url, c.locator
  FROM score_assertion AS a
  JOIN model AS m ON m.id = a.model_id
  JOIN benchmark_measure AS bm ON bm.id = a.benchmark_measure_id
  JOIN benchmark AS b ON b.id = bm.benchmark_id
  JOIN score_citation AS c ON c.score_assertion_id = a.id
  JOIN source AS s ON s.id = c.source_id
  LIMIT 10;'
```

This query returns one row per citation. For leaderboards, rank assertions before joining their citations so repeated support does not duplicate a result.

Check database consistency with:

```sh
sqlite3 catalog.sqlite 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

The expected output is `ok`, with no foreign-key violations.
