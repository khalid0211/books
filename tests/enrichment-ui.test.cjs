const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const code = ts.transpileModule(fs.readFileSync('src/components/EnrichmentManager.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function render(jobs, loaded = true, selection = 'range', limit = '10', summary = null) {
  const values = [null, '', jobs, null, 'B0001', 'B0010', false, false, '', '', loaded, false, selection, limit, summary];
  let index = 0, calls = 0;
  const exports = {};
  vm.runInNewContext(code, { exports, fetch: () => { calls++; throw Error('Unexpected request'); }, require: name => {
    if (name === 'react') return { useState: () => [values[index++], () => {}], useEffect() {} };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { href: props.href }, props.children) };
    if (name === '@/lib/books') return { bookNumber: id => 'B' + String(id).padStart(6, '0') };
    throw Error('Unexpected dependency ' + name);
  } });
  const tree = exports.default();
  return { tree, html: renderToStaticMarkup(tree), calls: () => calls };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
}
const item = { id: 1, bookId: 4, status: 'queued', attempts: 0, error: null };
function job(status, items = [item]) { return { id: 1, status, model: 'test-model', accountedUsd: 0, budgetUsd: 1, inputTokens: 0, outputTokens: 0, message: null, items }; }

test('newly created run renders safely before nested book details arrive', () => {
  const result = render([job('queued')]);
  assert.match(result.html, /href="\/books\/4"/);
  assert.match(result.html, /B000004/);
  assert.match(result.html, /Book details loading/);
  assert.match(result.html, /Enrichment queued/);
});

test('job list uses fetched book titles when present', () => {
  const result = render([job('running', [{ ...item, book: { id: 4, title: 'War' } }])]);
  assert.match(result.html, /B000004 · War/);
  assert.doesNotMatch(result.html, /Book details loading/);
});

test('range submission stays blocked through running and in-flight pause/cancel, then re-enables', () => {
  for (const [status, itemStatus, disabled] of [['queued', 'queued', true], ['running', 'running', true], ['paused', 'running', true], ['cancelled', 'running', true], ['paused', 'queued', false], ['completed', 'needs_review', false]]) {
    const result = render([job(status, [{ ...item, status: itemStatus }])]);
    assert.equal(find(result.tree, n => n.type === 'button' && n.props.children === 'Preview range').props.disabled, disabled, status);
    if (disabled) find(result.tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(result.calls(), 0);
    assert.equal(result.html.includes('animate-spin'), disabled, status);
  }
});

test('not enriched filter offers an editable batch size and hides range/regeneration fields', () => {
  const result = render([], true, 'not_enriched', '15');
  assert.match(result.html, /Filter: Not enriched/);
  assert.match(result.html, /Number of books to process/);
  assert.match(result.html, /no enrichment revision/);
  assert.equal(find(result.tree, n => n.type === 'input' && n.props.type === 'number').props.value, '15');
  assert.equal(find(result.tree, n => n.type === 'input' && n.props.type === 'checkbox'), undefined);
  assert.equal(find(result.tree, n => n.type === 'button' && n.props.children === 'Preview books').props.disabled, false);
  assert.equal(find(render([job('running')], true, 'not_enriched').tree, n => n.type === 'input' && n.props.type === 'number').props.disabled, true);
});

test('summary sheet renders saved run metrics and a total footer; book lists start collapsed', () => {
  const summary = { rows: [
    { id: 7, createdAt: '2026-10-21T10:00:00Z', status: 'completed', inputTokens: 100, outputTokens: 50, accountedUsd: .0123, summaryBooksProcessed: 10 },
    { id: 8, createdAt: '2026-10-21T11:00:00Z', status: 'cancelled', inputTokens: 200, outputTokens: 75, accountedUsd: .02, summaryBooksProcessed: 15 },
  ], totals: { inputTokens: 300, outputTokens: 125, accountedUsd: .0323, booksProcessed: 25 } };
  const result = render([job('completed')], true, 'range', '10', summary);
  assert.match(result.html, /Run summary sheet/);
  assert.match(result.html, /Run 7/);
  assert.match(result.html, /dateTime="2026-10-21T10:00:00Z"/);
  assert.match(result.html, /100 input \/ 50 output/);
  assert.match(result.html, /\$0\.0123/);
  assert.match(result.html, /<tfoot>.*Total.*425.*\$0\.0323.*25.*<\/tfoot>/);
  assert.equal(find(result.tree, n => n.type === 'details').props.open, undefined);
  assert.equal(find(result.tree, n => n.type === 'button' && n.props.children === 'Save finished runs to summary').props.disabled, false);
});
