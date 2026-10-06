# AI model and benchmark catalog

This project aims to catalog major AI models, major benchmarks, and published evaluation results. It will **aggregate results reported by others**, not run benchmarks itself. Sources may include model developers, independent evaluators, benchmark maintainers, papers, and other public reports.

The goal is to make reported results easy to find and compare without hiding where a number came from or implying that unlike evaluations are directly comparable.

## Core idea

Store each **score observation** as a distinct, source-attributed record: a particular source reported a particular value for a model and benchmark measure under the conditions it described. Multiple sources can report different values for the same model and benchmark. They can also repeat the same underlying result with different rounding, labels, or qualifications. Preserve those reports separately.

Every observation should identify the source, the location within it (such as a table and row), and when that source was retrieved. Preserve a source snapshot or relevant excerpt where practical, since a URL and retrieval time alone cannot reconstruct a page after it changes. Keep publication time, evaluation time, and retrieval time separate.

A comparison matrix is a **view over observations**, not the primary data model. A cell may contain several reported results. If a view selects one, it should state its selection rule and let readers inspect the alternatives, provenance, and evaluation conditions.

## Proposed conceptual relations

Relation names are singular. This is a starting point for schema design, not a finalized database definition.

| Relation | Purpose |
| --- | --- |
| `organization` | Model developers, evaluators, publishers, and benchmark maintainers. |
| `model` | A named model release. |
| `model_version` | An identifiable checkpoint or API snapshot, when known. Mutable API aliases need mapping history rather than being treated as fixed versions. |
| `benchmark` | A benchmark's identity. |
| `benchmark_version` | A known release of its dataset or evaluation specification; it may be unknown for a reported result. |
| `benchmark_measure` | The specific quantity scored, including the task or subset, metric, unit, and aggregation rule. |
| `source` | The identity of a document or page, which may have more than one URL. |
| `source_retrieval` | A fetched instance of a source, with retrieval time, requested and final URLs, and a snapshot reference or content hash. |
| `benchmark_mention` | A benchmark named in a source even when no readable score was available. |
| `score_observation` | What a source actually reports: model identity as given, measure, exact reported value, normalized numeric value when possible, source locator, and known conditions. |
| `evaluation_configuration` | Reported prompting, tools, harness, sampling, reasoning budget, and other conditions, including partial information. |
| `evaluation` | An optional record for an identifiable underlying evaluation when evidence supports one. |
| `observation_derivation` | A supported relationship showing that one report derives from another. |

The schema should keep the source's original model name and score text even when they are mapped to normalized model IDs and numeric values. Unknown details must remain unknown; two observations with missing settings are not thereby known to have equivalent configurations. Distinguish unknown settings from settings explicitly marked inapplicable.

Likewise, do not infer that matching scores came from the same evaluation. Linking observations to one evaluation or marking one report as derived from another is a revisable, evidence-backed judgment. Statistical uncertainty, rounding precision, and confidence in extraction are different concepts and should not be collapsed into one field.

## Data quality principles

- Attribute factual datapoints to a source and retrieval time, including model and benchmark metadata where those facts are collected.
- Preserve conflicting reports and corrections rather than overwriting earlier observations.
- Record who published a result separately from who performed the evaluation, when known.
- Make benchmark version, measure definition, and evaluation conditions visible when comparing scores.
- Keep raw source observations distinct from normalized identities and editorial choices used in a comparison view.

## Current data

[model-benchmark-catalog/catalog.sqlite](catalog.sqlite) is a populated SQLite database built from the text research files in [model-benchmark-catalog/research/](research/). The current pass covers OpenAI and Anthropic launch material through October 6, 2026. It includes 89 source documents, 122 model records, 364 benchmark labels, 852 score observations, and 43 benchmark mentions without a score. These counts include a linked GPT-4 technical report and posts that have no transcribed numeric scores.

Each observation retains the exact reported value, model and benchmark wording, source location, source URL, and a retrieval timestamp. The [retrieval log](retrieval_log.json) records when each URL was checked. Many posts put benchmark results only in images; those values have been omitted unless they were read and verified. Source records carry coverage notes for known gaps. This is a substantial first pass, **not an exhaustive inventory** of every release or every chart cell.

The normalized model and benchmark IDs are provisional exact-name groupings. Matching IDs do not establish that evaluation configurations, benchmark versions, or score units are comparable. Where a unit or configuration was not recorded, it remains unknown. The database does not yet contain source snapshots; the URL, locator, excerpt, and retrieval time remain available, and snapshot fields are null.

## Use and rebuild

See [model-benchmark-catalog/schema.sql](schema.sql) for the SQLite schema and [model-benchmark-catalog/build_db.py](build_db.py) for the importer. The research JSON files are the editable data source; `catalog.sqlite` is a generated query artifact. To rebuild, move the existing database aside and run `uv run python build_db.py`. The importer refuses to overwrite an existing database.

For example, inspect a reported score and its provenance with:

```sh
sqlite3 -header -column catalog.sqlite '
  SELECT m.name AS model, b.name AS benchmark, o.reported_measure_name AS measure,
         o.reported_value_text AS score, s.title AS source, r.final_url, r.fetched_at,
         o.source_locator
  FROM score_observation AS o
  JOIN model AS m ON m.id = o.model_id
  JOIN benchmark AS b ON b.id = o.benchmark_id
  JOIN source_retrieval AS r ON r.id = o.source_retrieval_id
  JOIN source AS s ON s.id = r.source_id
  LIMIT 10;'
```
