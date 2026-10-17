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
    const model = models.get(assertion.model_id);
    const measure = measures.get(assertion.benchmark_measure_id);
    return {...assertion, model, measure, benchmark: benchmarks.get(measure.benchmark_id),
      developer: organizations.get(model.developer_id), citations: evidence.get(assertion.id) ?? []};
  });
  return {...raw, results, indexes: {organizations, models, benchmarks, measures, sources}};
}

export function filterResults(results, {organization = '', query = '', benchmark = '', measure = '', unit = '', kind = ''} = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return results.filter(row =>
    (!organization || row.model.developer_id === Number(organization)) &&
    (!benchmark || row.benchmark.id === Number(benchmark)) &&
    (!measure || row.measure.id === Number(measure)) &&
    (!unit || (row.unit ?? '__unknown__') === unit) &&
    (!kind || (kind === 'numeric' ? row.value_numeric !== null : row.value_text !== null)) &&
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
  if (row.value_text !== null) return row.value_text;
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 6}).format(row.value_numeric);
  return row.unit === 'percent' ? `${number}%` : row.unit ? `${number} ${row.unit}` : number;
}

export function numericSeries(results, {benchmark, measure, unit, organization = '', query = ''}) {
  // One bar per assertion, never "best score per model" or a citation-expanded join.
  return filterResults(results, {benchmark, measure, unit, organization, query, kind: 'numeric'})
    .sort((a, b) => b.value_numeric - a.value_numeric || a.model.name.localeCompare(b.model.name));
}

export function csvForResults(results) {
  const escape = value => {
    let text = value == null ? '' : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [['assertion_id', 'model', 'developer', 'benchmark', 'measure', 'value_numeric', 'value_text', 'unit', 'conditions', 'source_urls'],
    ...results.map(row => [row.id, row.model.name, row.developer?.name, row.benchmark.name, row.measure.name,
      row.value_numeric, row.value_text, row.unit, row.conditions, [...new Set(row.citations.map(c => c.source.url))].join(' | ')])]
    .map(row => row.map(escape).join(',')).join('\r\n');
}
