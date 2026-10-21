const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireDependency = () => ({}), globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URLSearchParams, require: requireDependency, ...globals });
  return exports;
}
const { readCataloguePosition } = load('src/lib/catalogue-position.ts');

test('catalogue position restores only the matching results and rejects corrupt storage', () => {
  const position = { query: 'q=history&sort=id', windowY: 312, tableTop: 1800, tableLeft: 160 };
  assert.deepEqual(JSON.parse(JSON.stringify(readCataloguePosition(JSON.stringify(position), position.query))), position);
  assert.equal(readCataloguePosition(JSON.stringify(position), 'q=science'), null);
  for (const raw of [null, 'invalid', '{}', JSON.stringify({ ...position, tableTop: -5 }), JSON.stringify({ ...position, windowY: '312' })]) assert.equal(readCataloguePosition(raw, position.query), null);
});

test('details overview prefers the current publication, limits drafts to Owner, and hides stale or insufficient text', () => {
  const { overviewRevision } = load('src/components/BookOverview.tsx');
  const published = { id: 1, reviewStatus: 'approved', stale: false, overview: 'Published overview', knowledgeLevel: 'high' };
  const draft = { ...published, id: 2, reviewStatus: 'needs_review', overview: 'New draft' };
  assert.equal(overviewRevision({ publishedRevisionId: 1, revisions: [draft, published] }, true), published);
  assert.equal(overviewRevision({ publishedRevisionId: null, revisions: [draft] }, false), undefined);
  assert.equal(overviewRevision({ publishedRevisionId: null, revisions: [draft] }, true), draft);
  for (const revision of [{ ...published, stale: true }, { ...published, knowledgeLevel: 'insufficient' }, { ...published, overview: ' ' }]) assert.equal(overviewRevision({ publishedRevisionId: 1, revisions: [revision] }, true), undefined);
});

test('catalogue waits for loaded rows before restoring page and table offsets; book navigation saves both', () => {
  const stateModule = load('src/lib/catalogue-state.ts');
  for (const loading of [true, false]) {
    const effects = [], frames = [], values = [[{ id: 10, title: 'Example', categories: [] }], 'table', 'comfortable', new Set(), '', loading, null, 'createdAt', 'desc', stateModule.EMPTY_CATALOGUE_FILTERS, true, false];
    const position = { query: '', windowY: 250, tableTop: 1400, tableLeft: 200 };
    let saved;
    const table = { scrollTop: 0, scrollLeft: 0 }, scrolls = [];
    const catalogue = { querySelector: () => table };
    const refs = [{ current: catalogue }, { current: null }];
    const Component = load('src/components/BookList.tsx', name => {
      if (name === 'react') return { useState: () => [values.shift(), () => {}], useRef: () => refs.shift(), useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn) };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/catalogue-state') return stateModule;
      if (name === '@/lib/catalogue-position') return { readCataloguePosition };
      if (name === '@/lib/book-filters') return { filterBooks: books => books };
      if (name === '@/lib/books') return load('src/lib/books.ts');
      return {};
    }, { requestAnimationFrame: fn => { frames.push(fn); return 1; }, cancelAnimationFrame() {}, window: { scrollY: 250, scrollTo: value => scrolls.push(value) }, sessionStorage: { getItem: () => JSON.stringify(position), setItem: (key, value) => { saved = { key, value: JSON.parse(value) }; } } }).default;
    const tree = Component({ storageKey: 'test' });
    effects[0]();
    assert.equal(frames.length, loading ? 0 : 1);
    if (!loading) {
      frames[0]();
      assert.equal(table.scrollTop, 1400); assert.equal(table.scrollLeft, 200); assert.equal(scrolls[0].top, 250);
      tree.props.onClickCapture({ target: { closest: () => ({}) } });
      assert.equal(saved.key, 'test:position');
      assert.equal(saved.value.tableTop, 1400); assert.equal(saved.value.tableLeft, 200); assert.equal(saved.value.windowY, 250);
    }
  }
});
