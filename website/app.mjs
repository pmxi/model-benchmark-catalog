import {
  prepareCatalog,
  filterResults,
  benchmarkCoverage,
  scoreLabel,
  csvForResults,
} from "./data.mjs";

const $ = (selector) => document.querySelector(selector);
const h = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const n = (value) => numberFormatter.format(value);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};
const orgLabel = (organization) => h(organization?.name ?? "Unknown");
const dateLabel = (date) => {
  if (!date) return "Date not recorded";
  const parsed = new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
  return Number.isNaN(parsed.valueOf())
    ? h(date)
    : dateFormatter.format(parsed);
};
const views = {
  overview: {
    title: "Overview",
    description: "Reported results and the sources behind them.",
  },
  explorer: {
    title: "Benchmark explorer",
    description:
      "Compare reported values for a single measure and inspect their evidence.",
  },
  results: {
    title: "All results",
    description:
      "Search individual results, evaluation conditions, and citations.",
  },
  model: { title: "Model", description: "All recorded scores for this model." },
  models: {
    title: "Models",
    description: "Recorded model identities and their reported results.",
  },
  sources: {
    title: "Sources",
    description: "Original reports, publication dates, and collection notes.",
  },
};
let catalog;
let state = {
  view: "overview",
  organization: "",
  query: "",
  benchmark: "",
  measure: "",
  unit: "",
  page: 1,
};
let downloadRows = [];
let toastTimer;
let activeDetail = null;

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}

function scope() {
  // Overview and general tables must not inherit explorer-specific filters.
  const all = filterResults(catalog.results, {
    organization: state.organization,
    query: state.query,
  });
  const modelIds = new Set(all.map((row) => row.model.id));
  const benchmarkIds = new Set(all.map((row) => row.benchmark.id));
  const sourceIds = new Set(
    all.flatMap((row) => row.citations.map((c) => c.source_id)),
  );
  const needle = state.query.trim().toLowerCase();
  const matches = (text) =>
    String(text ?? "")
      .toLowerCase()
      .includes(needle);
  return {
    results: all,
    models: catalog.models.filter(
      (m) =>
        (!state.organization ||
          m.developer_id === Number(state.organization)) &&
        (!needle || matches(m.name) || modelIds.has(m.id)),
    ),
    benchmarks: catalog.benchmarks.filter(
      (b) =>
        (!state.organization || benchmarkIds.has(b.id)) &&
        (!needle || matches(b.name) || benchmarkIds.has(b.id)),
    ),
    sources: catalog.sources.filter(
      (s) =>
        (!state.organization ||
          s.publisher_id === Number(state.organization)) &&
        (!needle ||
          matches(`${s.title} ${s.url} ${s.coverage_note ?? ""}`) ||
          sourceIds.has(s.id)),
    ),
  };
}

function empty(
  title = "No matching results",
  detail = "Try another search or clear the organization filter.",
) {
  return `<div class="empty"><h2>${h(title)}</h2><p>${h(detail)}</p>${state.query || state.organization ? '<button class="button" data-action="clear">Clear filters</button>' : ""}</div>`;
}

function panelHead(title, subtitle, trailing = "") {
  return `<div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div>${trailing}</div>`;
}

let resultSort = { key: "model", descending: false };
const resultColumns = [
  ["id", "ID"],
  ["model", "Model"],
  ["benchmark", "Benchmark"],
  ["value", "Value"],
  ["unit", "Unit"],
  ["measure", "Measure"],
  ["conditions", "Conditions"],
  ["citations", "Evidence"],
];
const resultValue = (row, key) =>
  ({
    id: row.id,
    model: row.model.name,
    benchmark: row.benchmark.name,
    measure: row.measure.name,
    value: row.value_numeric,
    unit: row.measure.unit,
    conditions: row.conditions,
    citations: row.citations.length,
  })[key];

function sortResultRows(rows) {
  return [...rows].sort((a, b) => {
    const left = resultValue(a, resultSort.key),
      right = resultValue(b, resultSort.key);
    if (left == null || right == null)
      return (left == null) - (right == null) || a.id - b.id;
    const order =
      typeof left === "number"
        ? left - right
        : String(left).localeCompare(String(right), "en", { numeric: true });
    return (resultSort.descending ? -order : order) || a.id - b.id;
  });
}

function resultRows(rows) {
  if (!rows.length) return empty();
  const sorted = sortResultRows(rows);
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Data table"><table class="results-table"><thead><tr>${resultColumns.map(([key, label]) => `<th scope="col"${resultSort.key === key ? ` aria-sort="${resultSort.descending ? "descending" : "ascending"}"` : ""}><button data-sort="${key}">${label}${resultSort.key === key ? ` (${resultSort.descending ? "desc" : "asc"})` : ""}</button></th>`).join("")}</tr></thead><tbody>${sorted
    .map(
      (row) => `<tr>
    <td class="numeric">${row.id}</td>
    <td><a class="table-link" href="#model/${row.model.id}" title="${h(row.model.name)}">${h(row.model.name)}</a></td>
    <td><button class="table-link" data-benchmark="${row.benchmark.id}" title="${h(row.benchmark.name)}">${h(row.benchmark.name)}</button></td>
    <td class="numeric"><button class="table-link" data-result="${row.id}">${n(row.value_numeric)}</button></td>
    <td>${h(row.measure.unit ?? "Unknown")}</td>
    <td title="${h(row.measure.name)}">${h(row.measure.name)}</td>
    <td title="${h(row.conditions ?? "")}">${h(row.conditions ?? "Unknown")}</td>
    <td><button class="table-link" data-result="${row.id}">${row.citations.length} citation${row.citations.length === 1 ? "" : "s"}</button></td>
  </tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function selectedOption(value, label, selected) {
  return `<option value="${h(value)}"${String(value) === String(selected) ? " selected" : ""}>${h(label)}</option>`;
}

function explorer() {
  if (!state.benchmark)
    state.benchmark = String(
      catalog.benchmarks.find((b) => b.name === "GPQA Diamond")?.id ??
        catalog.benchmarks[0]?.id ??
        "",
    );
  const benchmark = catalog.indexes.benchmarks.get(Number(state.benchmark));
  const measures = catalog.measures.filter(
    (m) => m.benchmark_id === Number(state.benchmark),
  );
  const counts = new Map(
    measures.map((m) => [
      m.id,
      catalog.results.filter((r) => r.measure.id === m.id).length,
    ]),
  );
  measures.sort(
    (a, b) =>
      counts.get(b.id) - counts.get(a.id) || a.name.localeCompare(b.name),
  );
  if (!measures.some((m) => m.id === Number(state.measure)))
    state.measure = String(measures[0]?.id ?? "");
  const measure = catalog.indexes.measures.get(Number(state.measure));
  state.unit = measure?.unit ?? "__unknown__";
  const matching = filterResults(catalog.results, state);
  downloadRows = sortResultRows(matching);
  const allCoverage = new Map(
    benchmarkCoverage(catalog.results).map((row) => [row.id, row.results]),
  );
  return `<div class="explorer-controls">
    <label class="select-field">Benchmark<select id="benchmark-select">${[
      ...catalog.benchmarks,
    ]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((b) =>
        selectedOption(
          b.id,
          `${b.name} (${allCoverage.get(b.id) ?? 0})`,
          state.benchmark,
        ),
      )
      .join("")}</select></label>
    <label class="select-field">Measure<select id="measure-select"${!measures.length ? " disabled" : ""}>${measures.length ? measures.map((m) => selectedOption(m.id, m.name, state.measure)).join("") : "<option>No measures</option>"}</select></label>
    <div class="select-field">Unit<output>${h(measure?.unit ?? "Unknown")}</output></div>
  </div><div class="table-status">${matching.length} results · ${measure?.higher_is_better == null ? "Direction unknown" : measure.higher_is_better ? "Higher is better" : "Lower is better"}</div>${resultRows(matching)}`;
}

function pageRows(rows, size = 100) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    footer: `<div class="pagination"><span>${rows.length ? `${n(start + 1)}–${n(Math.min(start + size, rows.length))} of ${n(rows.length)}` : "0 results"}</span><div class="controls"><button data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>Previous</button><span>${state.page} / ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? "disabled" : ""}>Next</button></div></div>`,
  };
}

function resultsView() {
  const results = filterResults(catalog.results, {
    organization: state.organization,
    query: state.query,
  });
  downloadRows = sortResultRows(results);
  return `<div class="table-toolbar"><span>${n(results.length)} of ${n(catalog.results.length)} results</span><span>Click column headings to sort. Open citations for context.</span></div>${resultRows(results)}`;
}

function modelsView() {
  const data = scope();
  downloadRows = data.results;
  const models = [...data.models].sort((a, b) => a.name.localeCompare(b.name));
  const page = pageRows(models);
  return `<section class="panel">${panelHead("Model identities", `${n(models.length)} recorded names · snapshots remain in the names`)}${
    page.rows.length
      ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Data table"><table><thead><tr><th scope="col">Model</th><th scope="col">Developer</th><th scope="col">Benchmarks</th><th scope="col">Results</th><th scope="col"><span class="visually-hidden">Details</span></th></tr></thead><tbody>${page.rows
          .map((model) => {
            const results = catalog.results.filter(
              (r) => r.model_id === model.id,
            );
            return `<tr><td><a class="table-link" href="#model/${model.id}">${h(model.name)}</a></td><td>${orgLabel(catalog.indexes.organizations.get(model.developer_id))}</td><td>${n(new Set(results.map((r) => r.benchmark.id)).size)}</td><td>${n(results.length)}</td><td><a class="text-button" href="#model/${model.id}">All scores</a></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : empty("No matching models")
  }${page.footer}</section>`;
}

function sourcesView() {
  const data = scope();
  downloadRows = data.results;
  const sources = [...data.sources].sort(
    (a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? "") || a.id - b.id,
  );
  return `<div class="table-status">${sources.length} source documents · newest first</div><div class="table-wrap" tabindex="0" role="region" aria-label="Data table"><table><thead><tr><th>ID</th><th>Published</th><th>Publisher</th><th>Title</th><th>Coverage note</th><th>Original</th></tr></thead><tbody>${sources.map((source) => `<tr><td>${source.id}</td><td>${h(source.published_at ?? "Unknown")}</td><td>${orgLabel(catalog.indexes.organizations.get(source.publisher_id))}</td><td><button class="table-link" data-source="${source.id}" title="${h(source.title)}">${h(source.title)}</button></td><td title="${h(source.coverage_note ?? "")}">${h(source.coverage_note ?? "")}</td><td><a href="${h(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">Source</a></td></tr>`).join("")}</tbody></table></div>`;
}

function render() {
  if (!catalog) return;
  const metadata = views[state.view];
  const title =
    state.view === "model"
      ? (catalog.indexes.models.get(state.model)?.name ?? "Model not found")
      : metadata.title;
  const description = metadata.description;
  $(".filterbar").hidden = state.view === "model";
  $("#page-title").textContent = title;
  $("#page-description").textContent = description;
  document.title = `${title} — Model benchmark catalog`;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active =
      link.dataset.nav === (state.view === "model" ? "models" : state.view);
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#clear-filters").hidden = !state.query && !state.organization;
  $("#view").innerHTML = {
    overview: resultsView,
    explorer,
    results: resultsView,
    models: modelsView,
    model: modelView,
    sources: sourcesView,
  }[state.view]();
  $("#export").disabled = !downloadRows.length;
}

function showDialog(html) {
  $("#detail-body").innerHTML = html;
  if (!$("#detail").open) $("#detail").showModal();
  $("#detail").scrollTop = 0;
}

function showResult(id) {
  activeDetail = () => showResult(id);
  const row = catalog.results.find((r) => r.id === Number(id));
  if (!row) return;
  showDialog(
    `<h2 id="detail-title">${h(row.model.name)}</h2><p class="detail-subtitle">${h(row.benchmark.name)} · ${h(row.measure.name)}</p><div class="detail-score">${h(scoreLabel(row))}</div><dl class="detail-info"><div><dt>Developer</dt><dd>${h(row.developer?.name ?? "Not recorded")}</dd></div><div><dt>Score unit</dt><dd>${h(row.measure.unit ?? "Not recorded")}</dd></div><div><dt>Assertion ID</dt><dd>${row.id}</dd></div><div class="wide"><dt>Evaluation conditions</dt><dd>${h(row.conditions ?? "Not recorded. Equivalent evaluation settings are not established.")}</dd></div></dl><div class="evidence-heading">Supporting evidence · ${row.citations.length} citation${row.citations.length === 1 ? "" : "s"}</div>${row.citations.map((c) => `<article class="evidence"><h3><a href="${h(safeUrl(c.source.url))}" target="_blank" rel="noopener noreferrer">${h(c.source.title)}</a></h3><p class="locator">${dateLabel(c.source.published_at)} · ${h(c.locator)}</p>${c.excerpt ? `<blockquote>${h(c.excerpt)}</blockquote>` : '<p class="extraction-note">No excerpt recorded.</p>'}${c.note ? `<p class="extraction-note">Extraction note: ${h(c.note)}</p>` : ""}<button class="text-button" data-source="${c.source_id}">View source coverage note</button></article>`).join("") || '<p class="source-detail-note">No citations recorded.</p>'}`,
  );
}

function showSource(id) {
  activeDetail = () => showSource(id);
  const source = catalog.indexes.sources.get(Number(id));
  if (!source) return;
  const results = catalog.results.filter((r) =>
    r.citations.some((c) => c.source_id === source.id),
  );
  showDialog(
    `<h2 id="detail-title">${h(source.title)}</h2><p class="detail-subtitle">${h(catalog.indexes.organizations.get(source.publisher_id)?.name ?? "Unknown publisher")} · ${dateLabel(source.published_at)}</p><a class="button" href="${h(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">Open original source</a><div class="evidence-heading">Coverage note</div><p class="source-detail-note">${h(source.coverage_note ?? "No coverage note recorded.")}</p><div class="evidence-heading">${n(results.length)} supported results</div><div class="dialog-table">${results.length ? resultRows(results, true) : '<div class="empty"><p>This source has no transcribed score assertions.</p></div>'}</div>`,
  );
}

function modelView() {
  const model = catalog.indexes.models.get(state.model);
  if (!model) {
    downloadRows = [];
    return '<p>Model not found. <a href="#models">Browse models</a></p>';
  }
  const results = catalog.results.filter((r) => r.model_id === model.id);
  downloadRows = sortResultRows(results);
  return `<div class="table-status"><a href="#models">All models</a><span>${h(catalog.indexes.organizations.get(model.developer_id)?.name ?? "Unknown developer")}</span><span>${n(results.length)} results · ${n(new Set(results.map((r) => r.benchmark.id)).size)} benchmarks</span></div><p class="model-note">All recorded results for this model identity, across sources and evaluation settings.</p>${results.length ? resultRows(results) : "<p>No score assertions have been recorded for this model.</p>"}`;
}

function clearFilters() {
  state.organization = "";
  state.query = "";
  state.page = 1;
  $("#organization").value = "";
  $("#search").value = "";
  render();
}

function setView() {
  const requested = location.hash.slice(1);
  const modelRoute = /^model\/(\d+)$/.exec(requested);
  state.model = modelRoute ? Number(modelRoute[1]) : null;
  if ($("#detail").open) $("#detail").close();
  state.view = modelRoute
    ? "model"
    : Object.hasOwn(views, requested) &&
        !["overview", "model"].includes(requested)
      ? requested
      : "results";
  state.page = 1;
  render();
}

document.addEventListener("click", (event) => {
  const sort = event.target.closest("[data-sort]");
  if (sort) {
    resultSort = {
      key: sort.dataset.sort,
      descending:
        resultSort.key === sort.dataset.sort ? !resultSort.descending : false,
    };
    if ($("#detail").open && activeDetail) activeDetail();
    else render();
    const root = $("#detail").open ? $("#detail") : $("#view");
    root.querySelector(`[data-sort="${resultSort.key}"]`)?.focus();
    return;
  }
  const result = event.target.closest("[data-result]");
  const source = event.target.closest("[data-source]");
  const benchmark = event.target.closest("[data-benchmark]");
  const page = event.target.closest("[data-page]");
  if (result) showResult(result.dataset.result);
  else if (source) showSource(source.dataset.source);
  else if (benchmark) {
    state.benchmark = benchmark.dataset.benchmark;
    state.measure = "";
    state.unit = "";
    if ($("#detail").open) $("#detail").close();
    if (location.hash === "#explorer") render();
    else location.hash = "explorer";
  } else if (page && !page.disabled) {
    state.page = Number(page.dataset.page);
    render();
    $("#view").scrollIntoView({ block: "start" });
  } else if (event.target.closest('[data-action="clear"]')) clearFilters();
});

$("#view").addEventListener("change", (event) => {
  const controlId = event.target.id;
  const field = {
    "benchmark-select": "benchmark",
    "measure-select": "measure",
  }[event.target.id];
  if (!field) return;
  state[field] = event.target.value;
  if (field === "benchmark") {
    state.measure = "";
    state.unit = "";
  }
  if (field === "measure") state.unit = "";
  state.page = 1;
  render();
  document.getElementById(controlId)?.focus();
});
$("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  render();
});
$("#organization").addEventListener("change", (event) => {
  state.organization = event.target.value;
  state.page = 1;
  render();
});
$("#clear-filters").addEventListener("click", clearFilters);
$("#close-detail").addEventListener("click", () => $("#detail").close());
$("#detail").addEventListener("click", (event) => {
  if (event.target === $("#detail")) {
    const r = $("#detail").getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("#detail").close();
  }
});
$(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  $("#content").focus();
  $("#content").scrollIntoView({ block: "start" });
});
window.addEventListener("hashchange", setView);
$("#export").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csvForResults(downloadRows)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `catalog-${state.view}${state.view === "model" ? `-${state.model}` : ""}-results.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${n(downloadRows.length)} results with source URLs.`);
});

async function load(refresh = false) {
  $("#refresh").disabled = true;
  try {
    const response = await fetch("/api/catalog", { cache: "no-store" });
    if (!response.ok)
      throw new Error("The local server could not read the catalog.");
    catalog = prepareCatalog(await response.json());
    $("#organization").innerHTML =
      '<option value="">All organizations</option>' +
      catalog.organizations
        .map((o) => selectedOption(o.id, o.name, state.organization))
        .join("");
    $("#initial-state").hidden = true;
    $("#app").hidden = false;
    $("#nav-count").textContent = n(catalog.results.length);
    $("#connection-status").textContent = "Catalog connected";
    $("#snapshot-time").textContent =
      `Updated at ${new Date(catalog.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    setView();
    if (refresh) toast("Catalog refreshed.");
  } catch (error) {
    $("#connection-status").textContent = "Catalog unavailable";
    if (catalog) toast("Refresh failed. Showing the last loaded data.");
    else
      $("#initial-state").innerHTML =
        '<h1>Couldn’t open the catalog</h1><p>Check the local server, then try reloading.</p><button class="button primary" id="retry">Try again</button>';
    $("#retry")?.addEventListener("click", () => load());
  } finally {
    $("#refresh").disabled = false;
  }
}
$("#refresh").addEventListener("click", () => load(true));
load();
