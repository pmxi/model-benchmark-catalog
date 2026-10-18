# Data collection guidance

- Prioritize established benchmarks with clearly reported numeric results. Exhaustive collection of every launch-post claim is unnecessary.
- Verify the evaluation setup. A modified benchmark is a distinct variant, even when the source uses a familiar name. Do not group its results with the standard benchmark.
- Custom variants and one-off internal evaluations are optional, lower-priority additions. Name them clearly and preserve their defining context if included.
- Record exact scores when provided. Do not invent precision for bounds, approximations, or qualitative claims, or let rare exceptions drive schema complexity.
- Preserve qualifications such as “surpassing 99%” or “less than 40%” in `score_citation.excerpt`; use `locator` to identify the relevant passage or chart and `note` for interpretation. Leave `value_numeric` null when no single exact score can be extracted; a numeric threshold is not an exact score.
- Keep model configurations and benchmark versions distinguishable. Shared names alone do not establish comparable evaluations.
- Store the unit on `benchmark_measure`. Scores referencing it must use the same scale; document any conversion in the citation note.
