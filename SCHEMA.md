# Proposed relational schema

This document specifies a **logical schema** for the catalog described in [model-benchmark-catalog/README.md](README.md). It is a design proposal, not yet a migration or a choice of storage engine. Relation names are singular. IDs below are stable, opaque identifiers; `*_id` denotes a foreign key unless stated otherwise.

## Design rules

1. A `score_observation` records **what one source reported**, even when another source reports the same number. Do not deduplicate reports by value.
2. Keep the source's wording alongside normalized references. A missing model version, benchmark version, or evaluation setting remains unknown; never create a shared “unknown” entity.
3. An observation's evidence is the retrieved source itself, its locator, and its exact score text. The retrieval record carries `fetched_at` and a preserved snapshot. Publication and evaluation dates are separate.
4. Normalizing a name, linking reports, identifying an evaluation, and selecting a preferred score are editorial judgments. They must not overwrite the original observation.
5. Any field used as a factual assertion should be backed by its source. The core below focuses on score evidence; sourced model and benchmark metadata need typed extensions before those facts are populated at scale.

## Identity and measurement

| Relation | Required fields | Other fields and constraints |
| --- | --- | --- |
| `organization` | `id`, `name` | `website` optional. Roles such as developer, evaluator, or publisher come from relationships, not a single exclusive type. |
| `model` | `id`, `name` | `developer_id` → `organization` optional. A **named release**, rather than an entire family or an inferred checkpoint. Names need not be globally unique. |
| `model_version` | `id`, `model_id`, `identifier` | `model_id` → `model`. Unique (`model_id`, `identifier`). Only create when a checkpoint or snapshot is identifiable. |
| `benchmark` | `id`, `name` | Stable benchmark identity. Names need not be globally unique. |
| `benchmark_version` | `id`, `benchmark_id`, `identifier` | `benchmark_id` → `benchmark`. Unique (`benchmark_id`, `identifier`). A documented dataset or specification release. |
| `benchmark_measure` | `id`, `benchmark_id`, `name`, `metric`, `unit`, `higher_is_better` | `benchmark_id` → `benchmark`; optional `task`, `subset`, and `aggregation_rule`. A measure defines one interpretable quantity. Give distinct IDs to different subsets, metrics, aggregation rules, or scales. `higher_is_better` may be unknown. |

`benchmark_measure` is attached to the benchmark rather than requiring a benchmark version: a source may state the measure but omit the version. If a measure's meaning changes across versions, create a distinct measure or add a version-specific definition with evidence. A future alias history can map mutable API names to snapshots over time; an alias is not a `model_version`.

## Source and retrieval

| Relation | Required fields | Other fields and constraints |
| --- | --- | --- |
| `source` | `id`, `title` | `publisher_id` → `organization` and `published_at` optional. Identifies a document or page, rather than a URL string. Publication time may be date-only or unknown. |
| `source_retrieval` | `id`, `source_id`, `fetched_at`, `requested_url`, `final_url`, `snapshot_location`, `content_hash` | `source_id` → `source`. `fetched_at` is a UTC instant. The snapshot must be recoverable; the hash verifies content but is not a substitute for it. Retain new retrievals when the page changes. |

If a source is a PDF or other artifact, `snapshot_location` points to its preserved bytes. URL changes do not imply a new `source`; different documents at one URL do not automatically share a `source` ID.

## Reported score

| Relation | Required fields | Other fields and constraints |
| --- | --- | --- |
| `score_observation` | `id`, `source_retrieval_id`, `source_locator`, `reported_model_name`, `reported_benchmark_name`, `reported_measure_name`, `reported_value_text` | `source_retrieval_id` → `source_retrieval`; nullable `model_id`, `model_version_id`, `benchmark_id`, `benchmark_version_id`, `benchmark_measure_id`, and `value_numeric`; optional `reported_configuration_text`, `reported_evaluator_name`, `reported_evaluation_date`, `qualifier_text`, and `extraction_note`. |

The original strings are required because a source can name a model or metric ambiguously. Normalized IDs may be null until resolved. If `model_version_id` is present, its parent must equal `model_id`; likewise for benchmark version and measure. These cross-reference checks should be enforced by the database or import validation. `value_numeric` is a parsed value in the measure's declared unit, never a replacement for `reported_value_text`. A range, rank, or nonnumeric value may have no `value_numeric`.

Each separately reported score gets its own row. Distinct retrievals of a changed page can produce distinct observations. Re-fetching unchanged content does not by itself require a duplicate observation; the original retrieval and observation remain immutable.

The source locator should be specific enough to find the value again: for example, `Table 2 / row Model X / column MMLU-Pro`. An optional short excerpt can supplement the locator. A score can only enter a normalized comparison after its model, benchmark, and measure mappings have been reviewed.

## Evaluation context and report relationships

| Relation | Required fields | Other fields and constraints |
| --- | --- | --- |
| `evaluation_configuration` | `id`, `score_observation_id` | `score_observation_id` → `score_observation`, unique. Groups settings reported for this observation; no row is needed when no setting was reported. |
| `configuration_setting` | `id`, `evaluation_configuration_id`, `name`, `status` | `status` ∈ {`reported`, `explicitly_unknown`, `inapplicable`}; `value_text` required only for `reported`; optional `source_text`. Unique (`evaluation_configuration_id`, `name`). Names should use a controlled vocabulary, such as `shots`, `tools_enabled`, `sampling_temperature`, `samples_per_question`, `reasoning_budget`, or `harness`. |
| `evaluation` | `id` | Optional `evaluator_id` → `organization`, `evaluated_at`, and `description`. Create only when the underlying evaluation can be identified from evidence. It may summarize many runs or seeds; its name does not imply one execution. |
| `observation_evaluation` | `score_observation_id`, `evaluation_id`, `basis` | Foreign keys to both relations; composite primary key. `basis` records why the link is believed. Multiple observations may refer to the same evaluation. |
| `observation_derivation` | `observation_id`, `derived_from_observation_id`, `basis` | Both IDs → `score_observation`; composite primary key. Reject self-links and cycles. Add only for supported reporting or copying relationships, not matching numbers alone. |

Absent `configuration_setting` means **not reported in the catalog**, while `explicitly_unknown` means the source explicitly says it is unknown. Never merge two configurations merely because their listed settings happen to match. `basis` should cite the relevant source locator or a recorded curatorial rationale; a future implementation can replace free text with a dedicated evidence relation.

## Derived comparison view

A model-by-measure view should group observations by normalized `model_id` and `benchmark_measure_id`, with optional filters for model version, benchmark version, source, date, and configuration. It should expose all eligible observations with their source and retrieval time. If a single score is displayed, its selection rule must be explicit and deterministic; the selected observation ID and alternatives should remain accessible.

## Open implementation decisions

- Select a storage representation and write executable constraints. CSV plus schema metadata and a generated SQL database are candidates.
- Define stable ID generation and import validation rules.
- Add typed, sourced relations for frequently queried model and benchmark metadata, such as release date or context window, rather than an unconstrained generic claim table.
- Define a controlled vocabulary and typed parsing for configuration settings and statistical details (confidence intervals, standard deviations, and rounding precision).
- Define an evidence-backed review workflow for name mappings, derivation links, and preferred-score rules.
