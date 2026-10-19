// Only the loader depends on SQLite; the existing UI consumes plain row objects.
const tables = {
  organizations: 'organization', models: 'model', benchmarks: 'benchmark',
  measures: 'benchmark_measure', sources: 'source',
  assertions: 'score_assertion', citations: 'score_citation',
};

export function readCatalog(SQL, bytes) {
  const db = new SQL.Database(bytes);
  try {
    db.run('PRAGMA query_only = ON');
    return Object.fromEntries(Object.entries(tables).map(([key, table]) => {
      const rows = [];
      const statement = db.prepare(`SELECT * FROM ${table} ORDER BY id`);
      try {
        while (statement.step()) rows.push(statement.getAsObject());
      } finally {
        statement.free();
      }
      return [key, rows];
    }));
  } finally {
    db.close();
  }
}

let runtime;
export async function loadCatalog() {
  runtime ??= globalThis.initSqlJs({
    locateFile: file => {
      const url = new URL(`./vendor/sql.js/${file}`, import.meta.url);
      url.search = new URL(import.meta.url).search;
      return url.href;
    },
  }).catch(error => {
    runtime = undefined;
    throw error;
  });
  const [SQL, response] = await Promise.all([
    runtime,
    fetch(new URL('./catalog.sqlite', import.meta.url), {cache: 'no-store'}),
  ]);
  if (!response.ok) throw new Error(`Could not download the catalog (${response.status}).`);
  return readCatalog(SQL, new Uint8Array(await response.arrayBuffer()));
}
