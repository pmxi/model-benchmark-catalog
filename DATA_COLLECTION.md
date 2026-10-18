# Data collection guidance

- Prioritize established benchmarks with clearly reported numeric results. Exhaustive collection of every launch-post claim is unnecessary.
- Verify the evaluation setup. A modified benchmark is a distinct variant, even when the source uses a familiar name. Do not group its results with the standard benchmark.
- Custom variants and one-off internal evaluations are optional, lower-priority additions. Name them clearly and preserve their defining context if included.
- Record exact scores when provided. Do not invent precision for bounds, approximations, or qualitative claims, or let rare exceptions drive schema complexity.
- Preserve qualifications such as “surpassing 99%” or “less than 40%” in `score_citation.excerpt`; use `locator` to identify the relevant passage or chart and `note` for interpretation. `value` is required (`REAL NOT NULL`). Do not create a score assertion when no single exact score can be extracted; a numeric threshold is not an exact score. Preserve excluded claims in source coverage notes and `data/excluded_score_claims.json`.
- Keep model configurations and benchmark versions distinguishable. Shared names alone do not establish comparable evaluations.
- Store the unit on `benchmark_measure`. Scores referencing it must use the same scale; document any conversion in the citation note.

## Resolve identities before inserting

Search the existing catalog for the full name, abbreviation, spelling variants, and evaluation setup before creating a benchmark or measure. Reuse a canonical record when these refer to the same evaluation. Punctuation, abbreviations, source-specific wording, and “no tools” versus “without tools” do not create new benchmarks. A genuinely different version, dataset, or evaluation protocol still needs a distinct record.

Use one consistent measure name and scale for the same metric. “Percent” is a unit, not a metric; “reported score” should not become a separate measure when the source establishes that it is accuracy. Encode the reported shot count in the measure name (for example, `0-shot accuracy` and `5-shot accuracy`); it defines the comparison group, not an assertion condition. Keep specific tools, scaffolds, chain-of-thought prompting, and other execution details in `score_assertion.conditions`, and retain original source wording in citations. Do not infer an unspecified setup from a bare benchmark name; inspect the source and its images first.

### Bad example: nine HLE entries for two variants

The catalog incorrectly created all of these benchmark records:

- `HLE` (empty)
- `HLE (no tools)`
- `HLE (w/ search, Python)`
- `Humanity’s Last Exam`
- `Humanity’s Last Exam (no tools)`
- `Humanity’s Last Exam (with tools)`
- `Humanity’s Last Exam no tools`
- `Humanity’s Last Exam with tools`
- `Humanity’s Last Exam without tools`

This fragmented one benchmark family across nine dropdown entries, hid comparable results from each other, and left an empty entry. Measures named `accuracy`, `accuracy, without tools`, `accuracy, with tools`, `accuracy with browsing and Python`, `reported score`, and `percent` fragmented it further. Copying source labels verbatim into identity fields caused this failure.

The corrected catalog uses exactly two canonical records for these collected evaluations: **Humanity’s Last Exam (no tools)** and **Humanity’s Last Exam (with tools)**. Both use the measure `accuracy`, unit `percent`, and higher-is-better direction. The formerly bare full-name record was split using its recorded measure setup, not guessed from its name. Search/Python and browsing/Python details remain in assertion conditions; original labels remain in citations. Consolidation preserved all 29 assertions, their numeric values, model associations, and citations. Grouping the tool-assisted results does not establish identical tool environments.

Before completing a collection batch, inspect the resulting benchmark list as a user would. Check aliases and empty records, reconcile equivalent measures, and verify that consolidation has not lost assertions or citations. A populated table and valid foreign keys alone do not establish data quality.

### Bad example: ARC-AGI-2 versus ARC-AGI-2 (Verified)

The catalog incorrectly treated `ARC-AGI-2` and `ARC-AGI-2 (Verified)` as separate benchmarks. It also stored `Verified accuracy`, `accuracy`, `reported score`, and `percent` as separate measures for these results. Verification status is a property of a reported result, not a new benchmark version or metric.

The correction uses one **ARC-AGI-2** benchmark with measure `accuracy`, unit `percent`, and higher-is-better direction. All ten existing assertions and their citations were retained. Results explicitly labeled Verified retain that qualification in `score_assertion.conditions`; unlabeled results are not automatically classified as unverified.

Preserve the evaluation split separately from verification status. ARC Prize's [official testing policy](https://arcprize.org/policy) distinguishes public, semi-private, and private evaluation sets; its verified frontier-model leaderboard uses the semi-private set. Do not infer an individual score's split solely from a copied “Verified” label. In this correction, the split remains explicitly unrecorded until supported by the score's source. Actual differences in evaluation sets must remain distinguishable when comparing results.

### Required numeric scores

Every score assertion must have a real numeric value. Extract exact numbers separately from effort labels, footnote markers, denominators, and percentile annotations; these do not justify a missing score. For example, `54.2% (high)` is value `54.2`, unit `percent`, with high reasoning effort in conditions. Split paired scores into assertions with their respective evaluation settings; preserve genuine subset differences. Store raw exam points with their scale instead of substituting an approximate percentile. Relative changes must have explicitly relative measures and units, never be presented as absolute accuracy. Bounds, ranges, and qualitative claims belong in source coverage notes or the excluded-claims archive, not in score assertions.

### Bad example: MMLU shot counts hidden in conditions

GPT-4's MMLU result was stored as `accuracy, 5-shot`, while Llama and Grok results used `accuracy` with `5-shot` or `0-shot` in conditions. Selecting `accuracy` hid GPT-4 and mixed different shot protocols in the same comparison. Moving all of them into plain `accuracy` would preserve that mistake.

Use **`0-shot accuracy`** and **`5-shot accuracy`**, unit `percent`, higher-is-better, as distinct MMLU measures. GPT-4's 86.4% belongs to `5-shot accuracy`, alongside other explicitly five-shot results. Move the shot count out of conditions; retain chain-of-thought, precision, token budgets, and other execution details there. Preserve original metric wording and supporting evidence in citations. A shared shot count alone does not imply identical evaluation protocols.

Do not guess missing shot counts. The correction classified 35 MMLU assertions with recorded shot counts (26 five-shot and 9 zero-shot); 15 accuracy assertions remain under `accuracy (shot count unspecified)` pending evidence. Three separately reported `pass@1` assertions retain their measure. All 53 scores and their citations were preserved.

`Instruction tuned`, `Base pretrained`, and `Post-trained chat model` describe the model, not the evaluation run. Do not repeat these labels in conditions; distinguish the corresponding models by their model records and retain source wording in citations. Runtime settings such as bf16 precision or thinking mode still belong in conditions.

Before completing a batch, inspect both measure names and conditions for shot counts. Results with the same reported shot protocol must use the same canonical measure; results with different or unknown shot counts must not be silently combined.
