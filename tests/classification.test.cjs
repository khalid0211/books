const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, dependencies = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports, (name) => dependencies[name] || require(name));
  return exports;
}
const { suggestClassification } = load('src/lib/classification.ts');
const categories = ['Science', 'Science Fiction', 'Biography', 'History', 'My custom category'].map((name, i) => ({ id: i + 1, name }));
test('suggestions distinguish science fiction and non-fiction and leave ambiguity unclassified', () => {
  assert.deepEqual(suggestClassification(['Science Fiction'], categories), { bookType: 'Fiction', categoryIds: [2] });
  assert.deepEqual(suggestClassification(['Non-fiction', 'Physics', 'Biography'], categories), { bookType: 'Non-fiction', categoryIds: [1, 3] });
  assert.equal(suggestClassification(['Fiction', 'Non-fiction'], categories).bookType, null);
  assert.deepEqual(suggestClassification([], categories), { bookType: null, categoryIds: [] });
  assert.deepEqual(suggestClassification(['MY CUSTOM CATEGORY'], categories).categoryIds, [5]);
});
test('catalog filters combine category/type and match category names in search', () => {
  const booksModule = load('src/lib/books.ts');
  const { filterBooks } = load('src/lib/book-filters.ts', { './books': booksModule });
  const books = [{ ...booksModule.emptyBookInput(), id: 1, title: 'A', bookType: 'Non-fiction', categories: [{ id: 3, name: 'Biography' }] }, { ...booksModule.emptyBookInput(), id: 2, title: 'B' }];
  assert.deepEqual(filterBooks(books, 'biography', {}, 'id', 'asc').map((b) => b.id), [1]);
  assert.deepEqual(filterBooks(books, '', { bookType: 'Non-fiction', category: '3' }, 'id', 'asc').map((b) => b.id), [1]);
  assert.deepEqual(filterBooks(books, '', { bookType: '__none', category: '__none' }, 'id', 'asc').map((b) => b.id), [2]);
});
