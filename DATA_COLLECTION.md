# Data collection guidance

- Prioritize established benchmarks with clearly reported numeric results. Exhaustive collection of every launch-post claim is unnecessary.
- Verify the evaluation setup. A modified benchmark is a distinct variant, even when the source uses a familiar name. Do not group its results with the standard benchmark.
- Custom variants and one-off internal evaluations are optional, lower-priority additions. Name them clearly and preserve their defining context if included.
- Record exact scores when provided. Do not invent precision for bounds, approximations, or qualitative claims, or let rare exceptions drive schema complexity.
- Preserve qualifications such as “surpassing 99%” or “less than 40%” in `score_citation.excerpt`; use `locator` to identify the relevant passage or chart and `note` for interpretation. Leave `value_numeric` null when no single exact score can be extracted; a numeric threshold is not an exact score.
- Keep model configurations and benchmark versions distinguishable. Shared names alone do not establish comparable evaluations.
- Store the unit on `benchmark_measure`. Scores referencing it must use the same scale; document any conversion in the citation note.

## Resolve identities before inserting

Search the existing catalog for the full name, abbreviation, spelling variants, and evaluation setup before creating a benchmark or measure. Reuse a canonical record when these refer to the same evaluation. Punctuation, abbreviations, source-specific wording, and “no tools” versus “without tools” do not create new benchmarks. A genuinely different version, dataset, or evaluation protocol still needs a distinct record.

Use one consistent measure name and scale for the same metric. “Percent” is a unit, not a metric; “reported score” should not become a separate measure when the source establishes that it is accuracy. Keep specific tools, scaffolds, and other execution details in `score_assertion.conditions`, and retain original source wording in citations. Do not infer an unspecified setup from a bare benchmark name; inspect the source and its images first.

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
