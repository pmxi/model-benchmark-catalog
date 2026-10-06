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

## Storage format

The storage format is still open. For text files tracked in Git, one CSV file per relation could make changes reviewable. RFC 4180 provides a baseline for CSV syntax, but the project would also need explicit conventions for UTF-8 encoding, headers, line endings, null values, IDs, column types, and foreign keys. CSV on the Web (CSVW) metadata is one possible way to describe that schema. A queryable database could be generated from the source files.

See [model-benchmark-catalog/SCHEMA.md](SCHEMA.md) for the proposed logical schema.
