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
| `benchmark` | A benchmark identity based on the recorded name, which may include a version, and a required defining URL. |
| `benchmark_measure` | A named measure within a benchmark, with an optional unit and score direction. |
| `source` | A document or page, with its URL, publisher, publication date, and coverage note. |
| `score_assertion` | A model, benchmark measure, required numeric value and known conditions, independent of its supporting sources. |
| `score_citation` | Evidence linking an assertion directly to a source, including locator, original wording, and extraction commentary. |

Versions currently remain in recorded names; evaluation conditions remain in assertion text. Separate version, configuration, experiment, and report-derivation tables can be introduced when there is a concrete need to populate and query them.

An assertion requires an exact score in `value` (`REAL NOT NULL`). Extract numeric scores separately from configuration labels and annotations, and split paired evaluations into separate assertions. Claims without a single exact value are excluded from the score table and preserved in source coverage notes and `data/excluded_score_claims.json`. The benchmark and unit are reached through `benchmark_measure_id`, so neither is repeated on the assertion.

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

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) is the source of truth. Read and write catalog data directly in SQLite. As checked Saturday, October 17, 2026 at 11:26 PM EDT, the catalog contains 128 source documents, 213 model records, 377 benchmarks, 499 measures, and 1,385 numeric score assertions supported by 1,388 citations, across 12 organizations. It includes the earlier OpenAI/Anthropic collection and the completed Google, xAI, Meta, DeepSeek, Alibaba/Qwen, Moonshot/Kimi, Z.ai/GLM, MiniMax, Baidu, and ByteDance batches. The latest batch added 542 scores across 91 distinct model records. Coverage is selective and some source documents have no transcribed score.

Each citation retains the exact reported value, model and benchmark wording, and source location, and links directly to the document and its URL in `source`. Many posts put benchmark results only in images; those values have been omitted unless they were read and verified. Source records carry coverage notes for known gaps. This is a substantial first pass, **not an exhaustive inventory** of every release or every chart cell.

Reuse an assertion when model, measure, value, and recorded conditions match. GPT-5's stored 88% Aider Polyglot assertion currently has two citations. Claims without an extracted exact numeric score are excluded from score_assertion and retained with their evidence in source coverage notes and data/excluded_score_claims.json.

The normalized model and benchmark IDs are provisional exact-name groupings. Matching IDs do not establish that evaluation configurations, benchmark versions, or score units are comparable. Where a unit or configuration was not recorded, it remains unknown. Source URLs, citation locators, and excerpts provide the preserved evidence; there are no snapshot or content-hash columns.

## Website and GitHub Pages

The viewer is a static site. It downloads `catalog.sqlite` and queries it in memory
using the bundled [sql.js](https://sql.js.org/) 1.15.1 JavaScript/WebAssembly runtime.
SQLite remains the source of truth: there is no JSON export, hosted API, or browser
storage to synchronize. All runtime assets are served with the site.

The interface provides compact tables of results, models, and sources, filters,
sortable result columns, source evidence dialogs, and CSV export. All matching
results remain available without paging. The benchmark explorer narrows results
to one benchmark measure. Units come from that measure; sorting across different
measures does not establish comparability. Excluded claims remain in the evidence
archive. The interface uses system fonts and a neutral palette.

### Local preview

Run from the repository root (Python 3.11 or later):

```sh
uv run --no-project python website/server.py
```

Open [the local catalog viewer](http://127.0.0.1:8765). The preview serves the same
static assets as Pages, plus a fresh, consistent SQLite snapshot on each request.
Refresh picks up local database edits without a build. Use `--db /absolute/path/catalog.sqlite`
or `--port 8766` to select another database or port. The source database is opened
read-only; committed WAL data is included in the standalone snapshot.

To preview the exact deployment artifact:

```sh
uv run --no-project python -m website.build
uv run --no-project python -m http.server 8765 --bind 127.0.0.1 --directory _site
```

The build packages the public assets and a standalone SQLite snapshot in `_site/`.
It does not export or transform the catalog into another data format. Rebuild to
include database edits in this static preview. Relative URLs support both an
account site and a project path such as `/model-benchmark-catalog/`.

### Deployment

In the GitHub repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
The [Pages workflow](.github/workflows/pages.yml) tests and packages the site on
pull requests and pushes to `main`, then deploys successful `main` builds. It can
also be run manually. No npm install or external CDN is needed.

Commit and push database updates to publish them. On the public site, Refresh
reloads the latest deployed database; it cannot see unpublished local edits.
The displayed load time is when this browser loaded the data, not a data collection
timestamp. The entire database is publicly downloadable with the site.

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
3. Find or add the assertion, retaining its known conditions. Store an exact number. If none is available, preserve the claim in source coverage notes or the excluded-claims archive instead of inserting an assertion.
4. Add a citation to that assertion and source, preserving the locator and original wording. Reuse an existing citation when the same evidence is already recorded.

Use parameterized SQL in scripts. Every table uses `id INTEGER PRIMARY KEY`, with integer foreign keys. Omit `id` when inserting a new row and use `INSERT ... RETURNING id` (or the connection's last-insert ID) to obtain the generated ID. Reuse IDs from lookup results when referring to existing rows. IDs are local to this database; do not generate them from names or assume they match IDs in another database. Duplicate detection still requires the lookups described above.

## Schema changes and version history

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) and [model-benchmark-catalog/schema.sql](schema.sql) are tracked together in Git. Apply schema changes directly to the existing database and update `schema.sql` in the same change. Do not maintain migration scripts; previous database versions are available in Git history.

`schema.sql` defines an empty database and cannot reconstruct the collected data. Preserve existing records when changing the database, and check its integrity and foreign-key relationships afterward.

Benchmark URLs are required. Prefer the official benchmark project, dataset, repository, or paper, using a version-specific page when available. For a custom variant or internal evaluation without a dedicated page, use the source document describing that evaluation. A shared URL does not make different variants or evaluation settings comparable.

Run the schema, static packaging, local preview, and browser data regression tests with:

```sh
uv run --no-project python -m unittest discover -s tests -v
node --test tests/*.mjs
```

## Query

For example, inspect a reported score and its provenance with:

```sh
sqlite3 -header -column catalog.sqlite '
  SELECT m.name AS model, b.name AS benchmark, bm.name AS measure,
         a.value, bm.unit, a.conditions,
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
