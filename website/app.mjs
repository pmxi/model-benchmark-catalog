import {prepareCatalog, filterResults, benchmarkCoverage, sourceTimeline, scoreLabel, numericSeries, csvForResults} from './data.mjs';

const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const n = value => new Intl.NumberFormat('en-US').format(value);
const safeUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const orgClass = organization => organization?.name?.toLowerCase() === 'openai' ? 'openai' : organization?.name?.toLowerCase() === 'anthropic' ? 'anthropic' : 'unknown';
const orgColor = organization => ({openai: '#5575cb', anthropic: '#40968c', unknown: '#9ca3af'}[orgClass(organization)]);
const orgLabel = organization => `<span class="org-dot ${orgClass(organization)}"></span>${h(organization?.name ?? 'Unknown')}`;
const dateLabel = date => {
  if (!date) return 'Date not recorded';
  const parsed = new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
  return Number.isNaN(parsed.valueOf()) ? h(date) : new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(parsed);
};
const views = {
  overview: ['THE BIG PICTURE', 'The model landscape.', 'Explore what’s been reported. Follow every number back to its source.', 'Overview'],
  explorer: ['LOOK CLOSER', 'Explore the benchmarks.', 'Inspect reported scores for a specific measure, with the evidence one click away.', 'Benchmark explorer'],
  results: ['THE COMPLETE RECORD', 'Every reported result.', 'Search, filter, and inspect individual assertions. Multiple reports remain visible.', 'All results'],
  models: ['THE MODEL INDEX', 'Meet the models.', 'Browse recorded model identities and the benchmarks on which they appear.', 'Models'],
  sources: ['FOLLOW THE EVIDENCE', 'Back to the source.', 'Launch posts, reports, and the original wording behind the numbers.', 'Sources'],
};
let catalog;
let state = {view: 'overview', organization: '', query: '', benchmark: '', measure: '', unit: '', sort: 'high', kind: '', page: 1};
let downloadRows = [];
let toastTimer;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').hidden = true, 3500);
}

function scope() {
  // Overview and general tables must not inherit explorer-specific filters.
  const all = filterResults(catalog.results, {organization: state.organization, query: state.query});
  const modelIds = new Set(all.map(row => row.model.id));
  const benchmarkIds = new Set(all.map(row => row.benchmark.id));
  const sourceIds = new Set(all.flatMap(row => row.citations.map(c => c.source_id)));
  const needle = state.query.trim().toLowerCase();
  const matches = text => String(text ?? '').toLowerCase().includes(needle);
  return {
    results: all,
    models: catalog.models.filter(m => (!state.organization || m.developer_id === Number(state.organization)) && (!needle || matches(m.name) || modelIds.has(m.id))),
    benchmarks: catalog.benchmarks.filter(b => (!state.organization || benchmarkIds.has(b.id)) && (!needle || matches(b.name) || benchmarkIds.has(b.id))),
    sources: catalog.sources.filter(s => (!state.organization || s.publisher_id === Number(state.organization)) && (!needle || matches(`${s.title} ${s.url} ${s.coverage_note ?? ''}`) || sourceIds.has(s.id))),
  };
}

function empty(title = 'No matching results', detail = 'Try another search or clear the organization filter.') {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">⌕</div><h2>${h(title)}</h2><p>${h(detail)}</p>${state.query || state.organization ? '<button class="button" data-action="clear">Clear filters</button>' : ''}</div>`;
}

function legend(organizations = catalog.organizations) {
  return `<div class="legend">${organizations.map(o => `<span><i class="${orgClass(o)}"></i>${h(o.name)}</span>`).join('')}</div>`;
}

function panelHead(title, subtitle, trailing = '') {
  return `<div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div>${trailing}</div>`;
}

function resultRows(rows, compact = false) {
  if (!rows.length) return empty();
  return `<div class="table-wrap"><table><thead><tr><th>MODEL</th><th>BENCHMARK${compact ? '' : ' / MEASURE'}</th><th>REPORTED SCORE</th>${compact ? '' : '<th>CONDITIONS</th>'}<th>EVIDENCE</th></tr></thead><tbody>${rows.map(row => `<tr>
    <td><button class="table-link" data-result="${row.id}" title="${h(row.model.name)}">${h(row.model.name)}</button><small>${orgLabel(row.developer)}</small></td>
    <td><button class="table-link" data-benchmark="${row.benchmark.id}" title="${h(row.benchmark.name)}">${h(row.benchmark.name)}</button>${compact ? '' : `<small title="${h(row.measure.name)}">${h(row.measure.name)}</small>`}</td>
    <td class="score">${h(scoreLabel(row))}${row.value_numeric === null ? '<small>No exact numeric score</small>' : !row.measure.unit ? '<small>Unit not recorded</small>' : ''}</td>
    ${compact ? '' : `<td><span class="pill ${row.conditions ? 'green' : ''}" title="${h(row.conditions ?? '')}">${row.conditions ? 'Recorded' : 'Not recorded'}</span></td>`}
    <td><button class="text-button" data-result="${row.id}">${n(row.citations.length)} citation${row.citations.length === 1 ? '' : 's'} <span aria-hidden="true">↗</span></button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function timelineMarkup(sources) {
  const timeline = sourceTimeline(sources, catalog.organizations);
  if (!timeline.years.length) return empty('No dated sources', 'Publication dates have not been recorded for these sources.');
  const years = timeline.years;
  const totals = years.map(y => Object.values(y.counts).reduce((sum, value) => sum + value, 0));
  const maximum = Math.max(...totals, 4);
  const top = Math.ceil(maximum / 4) * 4;
  const plot = {x: 29, y: 12, w: 365, h: 162};
  const slot = plot.w / years.length;
  const width = Math.min(slot * .55, 30);
  const groups = [...catalog.organizations, {id: 'unknown', name: 'Unknown'}];
  const grid = Array.from({length: 5}, (_, i) => {
    const y = plot.y + plot.h - (i / 4) * plot.h;
    return `<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y}" y2="${y}"/><text x="21" y="${y + 3}" text-anchor="end">${top * i / 4}</text>`;
  }).join('');
  const bars = years.map((year, i) => {
    let total = 0;
    const x = plot.x + slot * (i + .5);
    return groups.map(group => {
      const count = year.counts[group.id] ?? 0;
      const height = count / top * plot.h;
      const y = plot.y + plot.h - (total + count) / top * plot.h;
      total += count;
      return `<rect class="year-bar" x="${x - width / 2}" y="${y}" width="${width}" height="${height}" fill="${orgColor(group)}" rx="2"><title>${h(`${year.year} · ${group.name}: ${count} sources`)}</title></rect>`;
    }).join('') + `<text x="${x}" y="196" text-anchor="middle">${year.year}</text>`;
  }).join('');
  return `<div class="timeline-wrap"><svg class="timeline" viewBox="0 0 410 212" role="img" aria-label="Source documents by publication year">${grid}${bars}</svg></div>
    <div class="chart-foot"><span>Source documents by publication year</span><span>${timeline.undated ? `${timeline.undated} undated` : 'All dates recorded'}</span></div>
    <details class="chart-data"><summary>View chart data</summary><div class="table-wrap"><table><thead><tr><th>YEAR</th>${groups.filter(g => sources.some(s => (s.publisher_id ?? 'unknown') === g.id)).map(g => `<th>${h(g.name)}</th>`).join('')}</tr></thead><tbody>${years.map(y => `<tr><td>${y.year}</td>${groups.filter(g => sources.some(s => (s.publisher_id ?? 'unknown') === g.id)).map(g => `<td>${y.counts[g.id] ?? 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

function overview() {
  const data = scope();
  downloadRows = data.results;
  const coverage = benchmarkCoverage(data.results).slice(0, 8);
  const numeric = data.results.filter(r => r.value_numeric !== null).length;
  const cited = new Set(data.results.flatMap(r => r.citations.map(c => c.id))).size;
  const stats = [
    ['Models', data.models.length, `${new Set(data.results.map(r => r.model_id)).size} with reported results`, '◇'],
    ['Benchmarks', data.benchmarks.length, `${new Set(data.results.map(r => r.benchmark.id)).size} with reported results`, '▥'],
    ['Reported results', data.results.length, `${n(numeric)} numeric · ${n(data.results.length - numeric)} evidence only`, '↗'],
    ['Source documents', data.sources.length, `${n(cited)} supporting citations`, '▤'],
  ];
  const recent = [...data.results].sort((a, b) => newestSource(b).localeCompare(newestSource(a)) || b.id - a.id).slice(0, 5);
  return `<div class="stats">${stats.map(([label, value, foot, icon]) => `<div class="stat"><span class="stat-icon" aria-hidden="true">${icon}</span><div class="stat-label">${label}</div><div class="stat-number">${n(value)}</div><div class="stat-foot">${foot}</div></div>`).join('')}</div>
    <div class="grid-2">
      <section class="panel">${panelHead('Where the evidence is', 'Benchmarks with the most reported results', '<span class="tag">TOP 8</span>')}<div class="panel-body">${coverage.length ? `<div class="coverage-bars">${coverage.map(row => `<button class="coverage-bar" data-benchmark="${row.id}" aria-label="Explore ${h(row.name)}, ${row.results} reported results" title="${h(row.name)} · ${row.models} models"><span class="coverage-name">${h(row.name)}</span><span class="track"><span style="width:${row.results / coverage[0].results * 100}%"></span></span><span class="coverage-count">${n(row.results)}</span></button>`).join('')}</div><div class="chart-foot"><span>One result per assertion</span><span>Select a benchmark to explore ↗</span></div>` : empty()}</div></section>
      <section class="panel">${panelHead('A growing record', 'Publication history of the collected sources') }<div class="panel-body">${legend()}${timelineMarkup(data.sources)}</div></section>
    </div>
    <div class="overview-bottom"><section class="panel">${panelHead('From the latest sources', 'Results ordered by source publication date', '<a class="text-button" href="#results">View all ↗</a>')}${resultRows(recent, true)}</section>
      <aside class="panel dataset-note"><div class="eyebrow">READ THE FINE PRINT</div><h2>Every score<br>has a story.</h2><p>These are published claims. Settings, units, and benchmark versions can differ—even when the model names match.</p><p>Open a result to inspect its conditions and original source wording.</p><a href="#explorer">Explore with context <span>↗</span></a></aside></div>`;
}

function newestSource(row) { return row.citations.map(c => c.source?.published_at ?? '').sort().at(-1) ?? ''; }

function selectedOption(value, label, selected) { return `<option value="${h(value)}"${String(value) === String(selected) ? ' selected' : ''}>${h(label)}</option>`; }

function explorer() {
  if (!state.benchmark) state.benchmark = String(catalog.benchmarks.find(b => b.name === 'GPQA Diamond')?.id ?? catalog.benchmarks[0]?.id ?? '');
  const benchmark = catalog.indexes.benchmarks.get(Number(state.benchmark));
  const measures = catalog.measures.filter(m => m.benchmark_id === Number(state.benchmark));
  const counts = new Map(measures.map(m => [m.id, catalog.results.filter(r => r.measure.id === m.id && r.value_numeric !== null).length]));
  measures.sort((a, b) => counts.get(b.id) - counts.get(a.id) || a.name.localeCompare(b.name));
  if (!measures.some(m => m.id === Number(state.measure))) state.measure = String(measures[0]?.id ?? '');
  const measure = catalog.indexes.measures.get(Number(state.measure));
  const units = measure ? [measure.unit ?? '__unknown__'] : [];
  state.unit = units[0] ?? '';
  let series = measure ? numericSeries(catalog.results, state) : [];
  if (state.sort === 'low') series = [...series].reverse();
  if (state.sort === 'name') series = [...series].sort((a, b) => a.model.name.localeCompare(b.model.name) || b.value_numeric - a.value_numeric);
  const matching = filterResults(catalog.results, {...state, kind: ''});
  const evidenceOnly = matching.filter(r => r.value_numeric === null);
  downloadRows = matching;
  const allCoverage = new Map(benchmarkCoverage(catalog.results).map(row => [row.id, row.results]));
  const min = Math.min(0, ...series.map(r => r.value_numeric));
  const max = Math.max(state.unit === 'percent' ? 100 : 1, ...series.map(r => r.value_numeric));
  const extent = max - min;
  const zero = (0 - min) / extent * 100;
  const direction = measure?.higher_is_better == null ? 'Direction not recorded' : measure.higher_is_better ? 'Higher is better' : 'Lower is better';
  return `<div class="explorer-controls">
    <label class="select-field">BENCHMARK<select id="benchmark-select">${[...catalog.benchmarks].sort((a, b) => a.name.localeCompare(b.name)).map(b => selectedOption(b.id, `${b.name} (${allCoverage.get(b.id) ?? 0})`, state.benchmark)).join('')}</select></label>
    <label class="select-field">MEASURE<select id="measure-select"${!measures.length ? ' disabled' : ''}>${measures.length ? measures.map(m => selectedOption(m.id, m.name, state.measure)).join('') : '<option>No measures recorded</option>'}</select></label>
    <label class="select-field">SCORE UNIT<select disabled aria-label="Unit defined by the measure">${units.length ? units.map(unit => selectedOption(unit, unit === '__unknown__' ? 'Unknown unit' : unit, state.unit)).join('') : '<option>No scores</option>'}</select></label>
    <label class="select-field">ORDER BY<select id="sort-select">${[['high', 'Value: high to low'], ['low', 'Value: low to high'], ['name', 'Model name']].map(([v, l]) => selectedOption(v, l, state.sort)).join('')}</select></label>
    </div>
    <div class="comparison-note"><span aria-hidden="true">ⓘ</span><div><strong>Reported scores, with their context.</strong> Each bar is one assertion on the selected measure and unit. Different evaluation settings may still apply. Repeated models are separate reports.${state.unit === '__unknown__' ? ' Units are unknown here; matching scale is not established.' : ''}</div></div>
    <section class="panel">${panelHead(h(benchmark?.name ?? 'Benchmark'), `${n(series.length)} numeric results · ${n(new Set(series.map(r => r.model_id)).size)} models · ${direction}`, legend())}
    ${series.length ? `<div class="score-chart"><div class="axis-row"><span>MODEL / CONDITIONS</span><div class="axis-ticks">${Array.from({length: 5}, (_, i) => `<span>${n(Math.round((min + extent * i / 4) * 10) / 10)}${state.unit === 'percent' ? '%' : ''}</span>`).join('')}</div><span style="text-align:right">SCORE</span></div>${series.map(row => {
      const location = (row.value_numeric - min) / extent * 100;
      return `<button class="score-row" data-result="${row.id}" aria-label="${h(row.model.name)}, ${h(scoreLabel(row))}. Inspect evidence" title="${h(row.conditions ?? 'Conditions not recorded')}"><span class="model-name"><span class="org-dot ${orgClass(row.developer)}"></span>${h(row.model.name)}<small>${h(row.conditions ?? 'Conditions not recorded')}</small></span><span class="score-track"><span class="zero-line" style="left:${zero}%"></span><span class="score-fill ${orgClass(row.developer)}" style="left:${Math.min(location, zero)}%;width:${Math.abs(location - zero)}%"></span></span><span class="value">${h(scoreLabel(row))}</span></button>`;
    }).join('')}</div>` : empty('No numeric scores in this selection', 'Choose another measure, unit, or organization. Results without an exact numeric score appear below.')}
    <div class="text-results-note">${evidenceOnly.length ? `${n(evidenceOnly.length)} result${evidenceOnly.length === 1 ? '' : 's'} without an exact numeric score; see evidence below.` : 'Select any bar to inspect its conditions, source links, and excerpts.'}</div></section>
    ${evidenceOnly.length ? `<section class="panel section-gap">${panelHead('Results requiring source context', 'Open the evidence for bounds, ranges, and combined results.')}${resultRows(evidenceOnly)}</section>` : ''}`;
}

function pageRows(rows, size = 25) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * size;
  return {rows: rows.slice(start, start + size), footer: `<div class="pagination"><span>${rows.length ? `${n(start + 1)}–${n(Math.min(start + size, rows.length))} of ${n(rows.length)}` : '0 results'}</span><div class="controls"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>← Previous</button><span>${state.page} / ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Next →</button></div></div>`};
}

function resultsView() {
  let results = filterResults(catalog.results, {organization: state.organization, query: state.query, kind: state.kind});
  results = [...results].sort((a, b) => a.model.name.localeCompare(b.model.name) || a.benchmark.name.localeCompare(b.benchmark.name) || a.id - b.id);
  downloadRows = results;
  const page = pageRows(results);
  return `<section class="panel">${panelHead('Results catalog', `${n(results.length)} assertions · each result appears once`, `<label class="select-field">VALUE TYPE<select id="kind-select">${[['', 'All values'], ['numeric', 'Numeric values'], ['evidence', 'Evidence only']].map(([v, l]) => selectedOption(v, l, state.kind)).join('')}</select></label>`)}${resultRows(page.rows)}${page.footer}<div class="result-summary">Several citations can support one assertion. Open its evidence to see every source.</div></section>`;
}

function modelsView() {
  const data = scope();
  downloadRows = data.results;
  const models = [...data.models].sort((a, b) => a.name.localeCompare(b.name));
  const page = pageRows(models);
  return `<section class="panel">${panelHead('Model identities', `${n(models.length)} recorded names · snapshots remain in the names`)}${page.rows.length ? `<div class="table-wrap"><table><thead><tr><th>MODEL</th><th>DEVELOPER</th><th>BENCHMARKS</th><th>RESULTS</th><th></th></tr></thead><tbody>${page.rows.map(model => {
    const results = catalog.results.filter(r => r.model_id === model.id);
    return `<tr><td><strong>${h(model.name)}</strong></td><td>${orgLabel(catalog.indexes.organizations.get(model.developer_id))}</td><td>${n(new Set(results.map(r => r.benchmark.id)).size)}</td><td>${n(results.length)}</td><td><button class="text-button" data-model="${model.id}">Inspect model ↗</button></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('No matching models')}${page.footer}</section>`;
}

function sourcesView() {
  const data = scope();
  downloadRows = data.results;
  const sources = [...data.sources].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '') || a.title.localeCompare(b.title));
  const page = pageRows(sources, 12);
  return `<div class="list-intro"><span>${n(sources.length)} source documents</span><span>Newest publication first</span></div><div class="source-grid">${page.rows.map(source => {
    const citations = catalog.citations.filter(c => c.source_id === source.id);
    const url = safeUrl(source.url);
    return `<article class="panel source-card"><div class="source-meta"><span>${orgLabel(catalog.indexes.organizations.get(source.publisher_id))}</span><span>${dateLabel(source.published_at)}</span></div><h2>${h(source.title)}</h2><a class="source-url" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(url.replace(/^https?:\/\//, ''))} ↗</a><p>${h(source.coverage_note ?? 'No coverage note recorded.')}</p><div class="source-card-bottom"><span class="pill">${n(citations.length)} citation${citations.length === 1 ? '' : 's'}</span><button class="button" data-source="${source.id}">Inspect source ↗</button></div></article>`;
  }).join('')}</div>${page.rows.length ? page.footer : `<section class="panel">${empty('No matching sources')}</section>`}`;
}

function render() {
  if (!catalog) return;
  const [eyebrow, title, description, breadcrumb] = views[state.view];
  $('#eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-description').textContent = description;
  $('#breadcrumb-view').textContent = breadcrumb;
  document.title = `${breadcrumb} — Atlas`;
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === state.view;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#clear-filters').hidden = !state.query && !state.organization;
  $('#view').innerHTML = ({overview, explorer, results: resultsView, models: modelsView, sources: sourcesView}[state.view])();
  $('#export').disabled = !downloadRows.length;
}

function showDialog(html) {
  $('#detail-body').innerHTML = html;
  if (!$('#detail').open) $('#detail').showModal();
  $('#detail').scrollTop = 0;
}

function showResult(id) {
  const row = catalog.results.find(r => r.id === Number(id));
  if (!row) return;
  showDialog(`<h2 id="detail-title">${h(row.model.name)}</h2><p class="detail-subtitle">${h(row.benchmark.name)} · ${h(row.measure.name)}</p><div class="detail-score">${h(scoreLabel(row))}</div><dl class="detail-info"><div><dt>DEVELOPER</dt><dd>${h(row.developer?.name ?? 'Not recorded')}</dd></div><div><dt>SCORE UNIT</dt><dd>${h(row.measure.unit ?? 'Not recorded')}</dd></div><div><dt>ASSERTION ID</dt><dd>${row.id}</dd></div><div class="wide"><dt>EVALUATION CONDITIONS</dt><dd>${h(row.conditions ?? 'Not recorded. Equivalent evaluation settings are not established.')}</dd></div></dl><div class="evidence-heading">Supporting evidence · ${row.citations.length} citation${row.citations.length === 1 ? '' : 's'}</div>${row.citations.map(c => `<article class="evidence"><h3><a href="${h(safeUrl(c.source.url))}" target="_blank" rel="noopener noreferrer">${h(c.source.title)} ↗</a></h3><p class="locator">${dateLabel(c.source.published_at)} · ${h(c.locator)}</p>${c.excerpt ? `<blockquote>${h(c.excerpt)}</blockquote>` : '<p class="extraction-note">No excerpt recorded.</p>'}${c.note ? `<p class="extraction-note">Extraction note: ${h(c.note)}</p>` : ''}<button class="text-button" data-source="${c.source_id}">View source coverage note ↗</button></article>`).join('') || '<p class="source-detail-note">No citations recorded.</p>'}`);
}

function showSource(id) {
  const source = catalog.indexes.sources.get(Number(id));
  if (!source) return;
  const results = catalog.results.filter(r => r.citations.some(c => c.source_id === source.id));
  showDialog(`<h2 id="detail-title">${h(source.title)}</h2><p class="detail-subtitle">${h(catalog.indexes.organizations.get(source.publisher_id)?.name ?? 'Unknown publisher')} · ${dateLabel(source.published_at)}</p><a class="button" href="${h(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a><div class="evidence-heading">Coverage note</div><p class="source-detail-note">${h(source.coverage_note ?? 'No coverage note recorded.')}</p><div class="evidence-heading">${n(results.length)} supported results</div><div class="dialog-table">${results.length ? resultRows(results, true) : '<div class="empty"><p>This source has no transcribed score assertions.</p></div>'}</div>`);
}

function showModel(id) {
  const model = catalog.indexes.models.get(Number(id));
  if (!model) return;
  const results = catalog.results.filter(r => r.model_id === model.id);
  showDialog(`<h2 id="detail-title">${h(model.name)}</h2><p class="detail-subtitle">${h(catalog.indexes.organizations.get(model.developer_id)?.name ?? 'Unknown developer')} · ${n(results.length)} reported results · ${n(new Set(results.map(r => r.benchmark.id)).size)} benchmarks</p><p class="source-detail-note">This is a recorded model identity. Results may use different settings or configurations.</p><div class="dialog-table">${results.length ? resultRows(results) : '<div class="empty"><p>No score assertions have been recorded for this model.</p></div>'}</div>`);
}

function clearFilters() {
  state.organization = ''; state.query = ''; state.page = 1;
  $('#organization').value = ''; $('#search').value = '';
  render();
}

function setView() {
  const requested = location.hash.slice(1);
  state.view = Object.hasOwn(views, requested) ? requested : 'overview';
  state.page = 1;
  render();
}

document.addEventListener('click', event => {
  const result = event.target.closest('[data-result]');
  const source = event.target.closest('[data-source]');
  const model = event.target.closest('[data-model]');
  const benchmark = event.target.closest('[data-benchmark]');
  const page = event.target.closest('[data-page]');
  if (result) showResult(result.dataset.result);
  else if (source) showSource(source.dataset.source);
  else if (model) showModel(model.dataset.model);
  else if (benchmark) {
    state.benchmark = benchmark.dataset.benchmark; state.measure = ''; state.unit = '';
    if ($('#detail').open) $('#detail').close();
    if (location.hash === '#explorer') render(); else location.hash = 'explorer';
  } else if (page && !page.disabled) {
    state.page = Number(page.dataset.page); render(); $('#view').scrollIntoView({block: 'start'});
  } else if (event.target.closest('[data-action="clear"]')) clearFilters();
});

$('#view').addEventListener('change', event => {
  const controlId = event.target.id;
  const field = {'benchmark-select': 'benchmark', 'measure-select': 'measure', 'sort-select': 'sort', 'kind-select': 'kind'}[event.target.id];
  if (!field) return;
  state[field] = event.target.value;
  if (field === 'benchmark') { state.measure = ''; state.unit = ''; }
  if (field === 'measure') state.unit = '';
  state.page = 1;
  render();
  document.getElementById(controlId)?.focus();
});
$('#search').addEventListener('input', event => {state.query = event.target.value; state.page = 1; render();});
$('#organization').addEventListener('change', event => {state.organization = event.target.value; state.page = 1; render();});
$('#clear-filters').addEventListener('click', clearFilters);
$('#close-detail').addEventListener('click', () => $('#detail').close());
$('#detail').addEventListener('click', event => {if (event.target === $('#detail')) {const r = $('#detail').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#detail').close();}});
window.addEventListener('hashchange', setView);
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvForResults(downloadRows)], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `atlas-${state.view}-results.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${n(downloadRows.length)} results with source URLs.`);
});

async function load(refresh = false) {
  $('#refresh').disabled = true;
  try {
    const response = await fetch('/api/catalog', {cache: 'no-store'});
    if (!response.ok) throw new Error('The local server could not read the catalog.');
    catalog = prepareCatalog(await response.json());
    $('#organization').innerHTML = '<option value="">All organizations</option>' + catalog.organizations.map(o => selectedOption(o.id, o.name, state.organization)).join('');
    $('#initial-state').hidden = true; $('#app').hidden = false;
    $('#nav-count').textContent = n(catalog.results.length);
    $('#connection-status').innerHTML = '<span class="status-dot"></span> Catalog connected';
    $('#snapshot-time').textContent = `Read from SQLite at ${new Date(catalog.generated_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
    setView();
    if (refresh) toast('Catalog reloaded from SQLite.');
  } catch (error) {
    $('#connection-status').textContent = 'Catalog unavailable';
    if (catalog) toast('Refresh failed. Showing the last loaded data.');
    else $('#initial-state').innerHTML = '<h1>Couldn’t open the catalog</h1><p>Check the local server, then try reloading.</p><button class="button primary" id="retry">Try again</button>';
    $('#retry')?.addEventListener('click', () => load());
  } finally { $('#refresh').disabled = false; }
}
$('#refresh').addEventListener('click', () => load(true));
load();
