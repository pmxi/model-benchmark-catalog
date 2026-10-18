import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCatalog, filterResults, benchmarkCoverage, sourceTimeline, numericSeries, scoreLabel, csvForResults} from '../website/data.mjs';

const raw = {
  organizations: [{id: 1, name: 'OpenAI'}, {id: 2, name: 'Anthropic'}],
  models: [{id: 1, name: 'Model A', developer_id: 1}, {id: 2, name: 'Model B', developer_id: 2}],
  benchmarks: [{id: 1, name: 'Benchmark A'}, {id: 2, name: 'Benchmark B'}],
  measures: [{id: 1, name: 'accuracy', benchmark_id: 1, unit: 'percent'}, {id: 2, name: 'pass@5', benchmark_id: 1, unit: 'percent'}, {id: 3, name: 'accuracy', benchmark_id: 2, unit: 'percent'}, {id: 4, name: 'Unspecified score', benchmark_id: 1, unit: null}],
  sources: [{id: 1, title: 'Release A', url: 'https://example.test/a', publisher_id: 1, published_at: '2025-02-01'}, {id: 2, title: 'Release B', url: 'https://example.test/b', publisher_id: 2, published_at: null}],
  assertions: [
    {id: 1, model_id: 1, benchmark_measure_id: 1, value_numeric: 80, conditions: '5-shot'},
    {id: 2, model_id: 1, benchmark_measure_id: 1, value_numeric: 85, conditions: '10-shot'},
    {id: 3, model_id: 2, benchmark_measure_id: 4, value_numeric: .9, conditions: null},
    {id: 4, model_id: 2, benchmark_measure_id: 1, value_numeric: null, conditions: null},
    {id: 5, model_id: 2, benchmark_measure_id: 2, value_numeric: 99, conditions: null},
    {id: 6, model_id: 1, benchmark_measure_id: 3, value_numeric: 98, conditions: null},
  ],
  citations: [{id: 1, score_assertion_id: 1, source_id: 1}, {id: 2, score_assertion_id: 1, source_id: 2}, {id: 3, score_assertion_id: 4, source_id: 1, excerpt: '≥ 90%'}],
};
const catalog = prepareCatalog(raw);

test('citations do not multiply results or benchmark coverage', () => {
  assert.equal(catalog.results.length, 6);
  assert.equal(catalog.results[0].citations.length, 2);
  assert.deepEqual(benchmarkCoverage(catalog.results)[0], {id: 1, name: 'Benchmark A', results: 5, models: 2});
});

test('score chart separates measures, units and missing scores while keeping repeated models', () => {
  const values = numericSeries(catalog.results, {benchmark: '1', measure: '1', unit: 'percent'});
  assert.deepEqual(values.map(row => row.id), [2, 1]);
  assert.equal(new Set(values.map(row => row.model_id)).size, 1);
  assert.deepEqual(numericSeries(catalog.results, {benchmark: '1', measure: '4', unit: '__unknown__'}).map(r => r.id), [3]);
});

test('organization and search filters compose and support empty matches', () => {
  assert.deepEqual(filterResults(catalog.results, {organization: '2', query: 'benchmark a', kind: 'evidence'}).map(r => r.id), [4]);
  assert.equal(filterResults(catalog.results, {query: 'no such model'}).length, 0);
  assert.deepEqual(filterResults(catalog.results, {query: 'release b'}).map(r => r.id), [1]);
});

test('unknown publication dates are not invented for the source chart', () => {
  const timeline = sourceTimeline(raw.sources, raw.organizations);
  assert.equal(timeline.undated, 1);
  assert.deepEqual(timeline.years, [{year: '2025', counts: {1: 1}}]);
});

test('missing scores are not displayed as zero and CSV retains source URLs', () => {
  assert.equal(scoreLabel(catalog.results[3]), 'See evidence');
  assert.equal(scoreLabel({...catalog.results[0], value_numeric: 0}), '0%');
  assert.equal(scoreLabel(catalog.results[0]), '80%');
  const csv = csvForResults([catalog.results[0]]);
  assert.equal(csv.split('\r\n').length, 2);
  assert.ok(csv.includes('https://example.test/a | https://example.test/b'));
  assert.ok(csv.includes('"5-shot"'));
});

test('CSV preserves qualified source wording while leaving the numeric score empty', () => {
  const csv = csvForResults([catalog.results[3]]);
  assert.ok(csv.includes('source_excerpts'));
  assert.ok(csv.includes('≥ 90%'));
  assert.equal(csv.split('\r\n')[1].split(',')[5], '""');
  assert.ok(!csv.includes('value_text'));
});

test('score labels, filters, and CSV take the unit from the referenced measure', () => {
  const changed = prepareCatalog({...raw, measures: raw.measures.map(m => m.id === 1 ? {...m, unit: 'points'} : m)});
  assert.equal(scoreLabel(changed.results[0]), '80 points');
  assert.equal(scoreLabel(changed.results[1]), '85 points');
  assert.equal(scoreLabel(changed.results[2]), '0.9');
  assert.deepEqual(filterResults(changed.results, {unit: 'points'}).map(r => r.id), [1, 2, 4]);
  assert.equal(csvForResults([changed.results[0]]).split('\r\n')[1].split(',')[6], '"points"');
});
