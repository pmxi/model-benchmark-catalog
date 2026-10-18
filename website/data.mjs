// Pure data helpers shared by the interface and its regression tests.
export function prepareCatalog(raw) {
  const index = key => new Map(raw[key].map(row => [row.id, row]));
  const organizations = index('organizations');
  const models = index('models');
  const benchmarks = index('benchmarks');
  const measures = index('measures');
  const sources = index('sources');
  const evidence = new Map();
  for (const citation of raw.citations) {
    if (!evidence.has(citation.score_assertion_id)) evidence.set(citation.score_assertion_id, []);
    evidence.get(citation.score_assertion_id).push({...citation, source: sources.get(citation.source_id)});
  }
  const results = raw.assertions.map(assertion => {
    if (typeof assertion.value !== 'number' || !Number.isFinite(assertion.value)) {
      throw new Error(`Assertion ${assertion.id} requires a finite numeric score.`);
    }
    const model = models.get(assertion.model_id);
    const measure = measures.get(assertion.benchmark_measure_id);
    return {...assertion, model, measure, benchmark: benchmarks.get(measure.benchmark_id),
      developer: organizations.get(model.developer_id), citations: evidence.get(assertion.id) ?? []};
  });
  return {...raw, results, indexes: {organizations, models, benchmarks, measures, sources}};
}

export function filterResults(results, {organization = '', query = '', benchmark = '', measure = '', unit = ''} = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return results.filter(row =>
    (!organization || row.model.developer_id === Number(organization)) &&
    (!benchmark || row.benchmark.id === Number(benchmark)) &&
    (!measure || row.measure.id === Number(measure)) &&
    (!unit || (row.measure.unit ?? '__unknown__') === unit) &&
    (!needle || [row.model.name, row.benchmark.name, row.measure.name, row.developer?.name,
      row.conditions, ...row.citations.map(c => c.source?.title)].join(' ').toLocaleLowerCase().includes(needle))
  );
}

export function benchmarkCoverage(results) {
  const groups = new Map();
  for (const row of results) {
    if (!groups.has(row.benchmark.id)) groups.set(row.benchmark.id, {id: row.benchmark.id, name: row.benchmark.name, results: 0, models: new Set()});
    const group = groups.get(row.benchmark.id);
    group.results++;
    group.models.add(row.model.id);
  }
  return [...groups.values()].map(row => ({...row, models: row.models.size}))
    .sort((a, b) => b.results - a.results || a.name.localeCompare(b.name));
}

export function sourceTimeline(sources, organizations) {
  const years = new Map();
  let undated = 0;
  for (const source of sources) {
    if (!/^\d{4}(?:-|$)/.test(source.published_at ?? '')) { undated++; continue; }
    const year = source.published_at.slice(0, 4);
    if (!years.has(year)) years.set(year, {year, counts: {}});
    const counts = years.get(year).counts;
    counts[source.publisher_id ?? 'unknown'] = (counts[source.publisher_id ?? 'unknown'] ?? 0) + 1;
  }
  const series = [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
  return {years: series, undated, organizations};
}

export function scoreLabel(row) {
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 6}).format(row.value);
  return row.measure.unit === 'percent' ? `${number}%` : row.measure.unit ? `${number} ${row.measure.unit}` : number;
}

export function numericSeries(results, {benchmark, measure, unit, organization = '', query = ''}) {
  // One bar per assertion, never "best score per model" or a citation-expanded join.
  return filterResults(results, {benchmark, measure, unit, organization, query})
    .sort((a, b) => b.value - a.value || a.model.name.localeCompare(b.model.name));
}

export function csvForResults(results) {
  const escape = value => {
    let text = value == null ? '' : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [['assertion_id', 'model', 'developer', 'benchmark', 'measure', 'value', 'unit', 'conditions', 'source_urls', 'source_excerpts'],
    ...results.map(row => [row.id, row.model.name, row.developer?.name, row.benchmark.name, row.measure.name,
      row.value, row.measure.unit, row.conditions, [...new Set(row.citations.map(c => c.source.url))].join(' | '),
      row.citations.map(c => c.excerpt ?? '').join('\n\n')])]
    .map(row => row.map(escape).join(',')).join('\r\n');
}
