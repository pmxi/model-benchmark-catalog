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
| `benchmark` | A benchmark identity based on the recorded name, which may include a version, and an optional URL. |
| `benchmark_measure` | A named measure within a benchmark, with an optional unit and score direction. |
| `source` | A document or page, with its URL, publisher, publication date, and coverage note. |
| `score_assertion` | A model, benchmark measure, optional numeric value and known conditions, independent of its supporting sources. |
| `score_citation` | Evidence linking an assertion directly to a source, including locator, original wording, and extraction commentary. |

Versions currently remain in recorded names; evaluation conditions remain in assertion text. Separate version, configuration, experiment, and report-derivation tables can be introduced when there is a concrete need to populate and query them.

An assertion stores an exact score in `value_numeric` when one can be extracted. Otherwise it remains `NULL`, with the original result and its qualifications preserved in citation excerpts. Bounds and unresolved composite results are not plotted as exact scores. The benchmark and unit are reached through `benchmark_measure_id`, so neither is repeated on the assertion.

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

Reuse an assertion when model, measure, value, and recorded conditions match. GPT-5's stored 88% Aider Polyglot assertion currently has two citations. Results without an extracted exact numeric score remain available through their citations.

The normalized model and benchmark IDs are provisional exact-name groupings. Matching IDs do not establish that evaluation configurations, benchmark versions, or score units are comparable. Where a unit or configuration was not recorded, it remains unknown. Source URLs, citation locators, and excerpts provide the preserved evidence; there are no snapshot or content-hash columns.

## Local website

Run the viewer from `model-benchmark-catalog/`:

```sh
uv run --no-project python website/server.py
```

Open [the local catalog viewer](http://127.0.0.1:8765). [model-benchmark-catalog/website/server.py](website/server.py) uses Python's standard library and reads the current SQLite database in read-only mode. The interface is plain HTML, CSS, and JavaScript, with no build step, third-party packages, external assets, or hosting integration. Use the refresh button to read database edits; no data export or rebuild is necessary. An alternate database or port can be selected with `--db /absolute/path/catalog.sqlite --port 8766`.

The viewer provides benchmark coverage and source-publication graphs, a score explorer, searchable result/model/source lists, source evidence dialogs, and CSV export of the filtered results. Score graphs use one benchmark measure and unit at a time, preserve multiple assertions for the same model, and exclude results without an exact numeric score from bars. Matching measure labels do not prove that evaluation conditions are comparable. Missing units and conditions remain visibly unknown.

## Write directly to SQLite

Each researcher or agent can open its own connection to the same local database. Enable foreign keys and a busy timeout on every connection:

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
```

Collect evidence before starting a transaction. Then use `BEGIN IMMEDIATE` to acquire the write lock, look up existing identities and assertions, insert the needed rows and citations, and `COMMIT`. Use `ROLLBACK` on failure. Keep transactions short; if a lock timeout occurs, roll back and retry the whole transaction. The lookup and insert must be in the same transaction to avoid competing writers creating duplicates.

When recording a score:

1. Find or add its model, benchmark, and benchmark measure. Record the unit on the measure; scores must use that scale.
2. Find or add its source document with its URL and known publication date.
3. Find or add the assertion, retaining its known conditions. Store an exact number when available; otherwise leave `value_numeric` null and preserve the reported wording in the citation.
4. Add a citation to that assertion and source, preserving the locator and original wording. Reuse an existing citation when the same evidence is already recorded.

Use parameterized SQL in scripts. Every table uses `id INTEGER PRIMARY KEY`, with integer foreign keys. Omit `id` when inserting a new row and use `INSERT ... RETURNING id` (or the connection's last-insert ID) to obtain the generated ID. Reuse IDs from lookup results when referring to existing rows. IDs are local to this database; do not generate them from names or assume they match IDs in another database. Duplicate detection still requires the lookups described above.

## Schema changes and version history

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) and [model-benchmark-catalog/schema.sql](schema.sql) are tracked together in Git. Apply schema changes directly to the existing database and update `schema.sql` in the same change. Do not maintain migration scripts; previous database versions are available in Git history.

`schema.sql` defines an empty database and cannot reconstruct the collected data. Preserve existing records when changing the database, and check its integrity and foreign-key relationships afterward.

Benchmark URLs are optional: use `NULL` when unknown and a nonempty string when recorded.

Run the schema, local API, and graph-data regression tests with:

```sh
uv run --no-project python -m unittest discover -s tests -v
node --test tests/test_viewer.mjs
```

## Query

For example, inspect a reported score and its provenance with:

```sh
sqlite3 -header -column catalog.sqlite '
  SELECT m.name AS model, b.name AS benchmark, bm.name AS measure,
         a.value_numeric, bm.unit, a.conditions,
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
