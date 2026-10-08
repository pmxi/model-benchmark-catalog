# AI model and benchmark catalog

This project aims to catalog major AI models, major benchmarks, and published evaluation results. It will **aggregate results reported by others**, not run benchmarks itself. Sources may include model developers, independent evaluators, benchmark maintainers, papers, and other public reports.

The goal is to make reported results easy to find and compare without hiding where a number came from or implying that unlike evaluations are directly comparable.

## Core idea

Separate **assertions**, **sources**, and **citations**:

- An assertion states that a model achieved a value on a benchmark measure under the recorded conditions.
- A source identifies a document, such as a model launch post. A source retrieval records when that document was read and at which URL.
- A citation connects an assertion to a source retrieval, with a locator, excerpt, and any extraction note.

Multiple citations can support the same assertion. Different values or conditions remain separate assertions. Matching recorded propositions do not establish that reports describe the same experiment or that unknown settings match.

Preserve a source snapshot or relevant excerpt where practical, since a URL and retrieval time alone cannot reconstruct a page after it changes. Keep publication time and retrieval time separate.

A comparison matrix is a **view over assertions**. A cell may contain several reported results. If a view selects one, it should state its selection rule and let readers inspect the alternatives, citations, and evaluation conditions.

## Current relations

Relation names are singular. Keep the schema limited to structures the catalog uses; add relations when concrete data or queries require them.

| Relation | Purpose |
| --- | --- |
| `organization` | Model developers, evaluators, publishers, and benchmark maintainers. |
| `model` | A model identity based on the recorded name, which may include a snapshot identifier. |
| `benchmark` | A benchmark identity based on the recorded name, which may include a version. |
| `benchmark_measure` | The specific quantity scored, including the task or subset, metric, unit, and aggregation rule. |
| `source` | The identity of a document or page, which may have more than one URL. |
| `source_retrieval` | A fetched instance of a source, with retrieval time, requested and final URLs, and a snapshot reference or content hash. |
| `score_assertion` | A model, benchmark measure, numeric or textual value, value unit, and known conditions, independent of its supporting sources. |
| `score_citation` | Evidence linking an assertion to a source retrieval, including locator, original wording, and extraction commentary. |

Versions currently remain in recorded names; evaluation conditions remain in assertion text. Separate version, configuration, experiment, and report-derivation tables can be introduced when there is a concrete need to populate and query them.

An assertion stores exactly one of `value_numeric` and `value_text`. Simple percentages become numbers with unit `percent`; bounds, ranges, and combined results remain text until they can be parsed safely. The benchmark is reached through `benchmark_measure_id`, so it is not repeated on the assertion.

Original model, benchmark, measure, and score wording lives in the citation's `excerpt`, as a labeled row transcription followed by the original source excerpt when available. The transcription is not presented as a contiguous verbatim quotation. Dedicated `reported_*` columns are unnecessary on the assertion.

Unknown details remain unknown; two assertions with missing settings are not thereby known to have equivalent configurations. Distinguish unknown settings from settings explicitly marked inapplicable.

Likewise, do not infer that matching scores came from the same evaluation. Statistical uncertainty, rounding precision, and confidence in extraction are different concepts and should not be collapsed into one field.

## Data quality principles

- Attribute factual datapoints to a source and retrieval time, including model and benchmark metadata where those facts are collected.
- Preserve conflicting reports and corrections rather than overwriting earlier assertions or citations.
- Record who published a result separately from who performed the evaluation, when known.
- Make benchmark version, measure definition, and evaluation conditions visible when comparing scores.
- Keep original source wording in citations, distinct from normalized identities and editorial choices used in a comparison view.

## Current data

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) is a populated SQLite database built from the text research files in [model-benchmark-catalog/research/](research/). The current pass covers OpenAI and Anthropic launch material through October 6, 2026. It includes 89 source documents, 122 model records, 364 benchmark labels, and 851 score assertions supported by 852 citations. These counts include a linked GPT-4 technical report and posts that have no transcribed numeric scores.

Each citation retains the exact reported value, model and benchmark wording, and source location, and links to the source URL and retrieval timestamp. The [retrieval log](retrieval_log.json) records when each URL was checked. Many posts put benchmark results only in images; those values have been omitted unless they were read and verified. Source records carry coverage notes for known gaps. This is a substantial first pass, **not an exhaustive inventory** of every release or every chart cell.

The importer shares an assertion when model, measure, parsed value, unit, and recorded conditions match. GPT-5's 88% AIME 2025 result currently has two citations. All 71 results that cannot be represented by a single number remain textual assertions.

The normalized model and benchmark IDs are provisional exact-name groupings. Matching IDs do not establish that evaluation configurations, benchmark versions, or score units are comparable. Where a unit or configuration was not recorded, it remains unknown. The database does not yet contain source snapshots; the URL, locator, excerpt, and retrieval time remain available, and snapshot fields are null.

## Use and rebuild

See [model-benchmark-catalog/schema.sql](schema.sql) for the SQLite schema and [model-benchmark-catalog/build_db.py](build_db.py) for the importer. The research JSON files are the editable data source; `catalog.sqlite` is a generated query artifact. To rebuild, move the existing database aside and run `uv run python build_db.py`. The importer refuses to overwrite an existing database.

For example, inspect a reported score and its provenance with:

```sh
sqlite3 -header -column catalog.sqlite '
  SELECT m.name AS model, b.name AS benchmark, bm.name AS measure,
         a.value_numeric, a.value_text, a.unit, a.conditions,
         s.title AS source, r.final_url, r.fetched_at, c.locator
  FROM score_assertion AS a
  JOIN model AS m ON m.id = a.model_id
  JOIN benchmark_measure AS bm ON bm.id = a.benchmark_measure_id
  JOIN benchmark AS b ON b.id = bm.benchmark_id
  JOIN score_citation AS c ON c.score_assertion_id = a.id
  JOIN source_retrieval AS r ON r.id = c.source_retrieval_id
  JOIN source AS s ON s.id = r.source_id
  LIMIT 10;'
```

This query returns one row per citation. For leaderboards, rank assertions before joining their citations so repeated support does not duplicate a result.

Run the importer behavior checks with `uv run python -m unittest test_build_db.py`.
