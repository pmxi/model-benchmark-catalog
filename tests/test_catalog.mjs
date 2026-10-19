import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import initSqlJs from '../website/vendor/sql.js/sql-wasm.js';
import {readCatalog, loadCatalog} from '../website/catalog.mjs';
import {prepareCatalog, filterResults, csvForResults} from '../website/data.mjs';

const SQL = await initSqlJs({
  locateFile: file => fileURLToPath(new URL(`../website/vendor/sql.js/${file}`, import.meta.url)),
});
const bytes = readFileSync(new URL('../catalog.sqlite', import.meta.url));

test('bundled WASM reads the real catalog with intact scores and evidence', () => {
  const before = Buffer.from(bytes);
  const catalog = prepareCatalog(readCatalog(SQL, bytes));
  const db = new SQL.Database(bytes);
  try {
    assert.equal(catalog.results.length, db.exec('SELECT count(*) FROM score_assertion')[0].values[0][0]);
    assert.equal(catalog.citations.length, db.exec('SELECT count(*) FROM score_citation')[0].values[0][0]);
    assert.equal(new Set(catalog.results.map(r => r.id)).size, catalog.results.length);
    assert.ok(catalog.results.length > 0);
    for (const row of catalog.results) {
      assert.ok(row.model && row.benchmark && row.measure);
      assert.ok(Number.isFinite(row.value));
      assert.ok(row.citations.length > 0);
      for (const citation of row.citations) assert.ok(citation.source.url);
    }
    const rows = filterResults(catalog.results, {query: 'GPT-4.1'});
    assert.ok(rows.length > 0);
    assert.ok(csvForResults(rows).includes('https://'));
    assert.deepEqual(bytes, before);
  } finally {
    db.close();
  }
});

test('invalid databases fail without preventing a later successful read', () => {
  assert.throws(() => readCatalog(SQL, new Uint8Array([1, 2, 3])));
  assert.ok(readCatalog(SQL, bytes).assertions.length > 0);
});

test('repeated loads fetch the database again and report unavailable downloads', async t => {
  const requests = [];
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url, options});
    return new Response(bytes, {status});
  });
  const previous = globalThis.initSqlJs;
  globalThis.initSqlJs = async () => SQL;
  t.after(() => {
    if (previous === undefined) delete globalThis.initSqlJs;
    else globalThis.initSqlJs = previous;
  });
  await loadCatalog();
  await loadCatalog();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].url.href, new URL('../website/catalog.sqlite', import.meta.url).href);
  status = 404;
  await assert.rejects(loadCatalog(), /404/);
  status = 200;
  assert.ok((await loadCatalog()).assertions.length > 0);
});
