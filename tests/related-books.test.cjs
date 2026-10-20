const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { rankRelatedBooks } = require('../src/lib/enrichment/related.ts');
const concept = (id, name, weight = .9) => ({ id, name, weight, perspective: `Explores ${name}.` });
const intuition = concept(1, 'Intuition'), bias = concept(2, 'Cognitive bias'), rapid = concept(3, 'Rapid cognition');
function book(id, concepts, extra = {}) { return { id, title: `Book ${id}`, authors: `Author ${id}`, isbn10: null, isbn13: null, publicationDate: null, edition: null, language: null, coverImageUrl: null, workId: null, concepts, ...extra }; }

test('shared concepts produce reciprocal, explained recommendations without claims of agreement', () => {
  const books = [book(1, [intuition, bias, rapid], { title: 'Blink', authors: 'Malcolm Gladwell' }), book(2, [intuition, bias, concept(4, 'Reasoning')], { title: 'Thinking, Fast and Slow', authors: 'Daniel Kahneman' }), book(3, [concept(5, 'Diplomacy'), concept(6, 'Nuclear deterrence')])];
  const a = rankRelatedBooks(books, 1).books, b = rankRelatedBooks(books, 2).books;
  assert.equal(a[0].id, 2); assert.equal(b[0].id, 1); assert.equal(a[0].score, b[0].score);
  assert.match(a[0].explanation, /Intuition/); assert.match(a[0].explanation, /Cognitive bias/);
  assert.doesNotMatch(a[0].explanation, /agree|influenc|contrast/i);
  assert.deepEqual(a[0].sharedConcepts.map(c => c.id).sort(), [1, 2]);
});

test('generic overlap, weak assignments, self links and empty vectors do not create recommendations', () => {
  const generic = [concept(1, 'Leadership'), concept(2, 'Technology')];
  assert.deepEqual(rankRelatedBooks([book(1, generic), book(2, generic)], 1).books, []);
  assert.deepEqual(rankRelatedBooks([book(1, [intuition, bias]), book(2, [{ ...intuition, weight: .1 }, { ...bias, weight: .1 }])], 1).books, []);
  assert.deepEqual(rankRelatedBooks([book(1, []), book(2, [])], 1).books, []);
  assert.deepEqual(rankRelatedBooks([book(1, [intuition, bias])], 99).books, []);
});

test('one distinctive, strongly assigned concept can connect books in a larger corpus', () => {
  const rare = concept(10, 'Nuclear deterrence');
  const books = [book(1, [rare, concept(11, 'Diplomacy')]), book(2, [rare, concept(12, 'Security doctrine')]), ...Array.from({ length: 10 }, (_, i) => book(i + 3, [concept(20 + i, `Unique topic ${i}`)]))];
  assert.equal(rankRelatedBooks(books, 1).books[0].id, 2);
  assert.deepEqual(rankRelatedBooks(books.slice(0, 2), 1).books, [], 'small corpora cannot establish distinctiveness from one shared tag');
});

test('copies and editions are grouped for frequencies and never crowd the recommendation list', () => {
  const a = book(1, [intuition, bias]), b = book(2, [intuition, bias]);
  const baseline = rankRelatedBooks([a, b], 1);
  const copies = [book(3, a.concepts, { title: a.title, authors: a.authors, edition: 'Later edition' }), book(4, b.concepts, { title: b.title, authors: b.authors })];
  const result = rankRelatedBooks([a, b, ...copies], 1);
  assert.equal(result.eligibleWorks, 2); assert.equal(result.books.length, 1); assert.equal(result.books[0].id, 2); assert.equal(result.books[0].score, baseline.books[0].score);
  const sameIsbn = book(5, a.concepts, { isbn13: '9780132350884' });
  assert.deepEqual(rankRelatedBooks([sameIsbn, book(6, a.concepts, { isbn13: '9780132350884' })], 5).books, []);
  assert.deepEqual(rankRelatedBooks([book(7, a.concepts, { workId: '/works/OL1W' }), book(8, a.concepts, { workId: '/works/OL1W' })], 7).books, []);
});

test('at most five distinct works are returned with stable scores and actual saved perspectives', () => {
  const books = Array.from({ length: 9 }, (_, i) => book(i + 1, [intuition, bias, concept(i + 10, `Other topic ${i}`)]));
  const result = rankRelatedBooks(books, 1, 100);
  assert.equal(result.books.length, 5); assert.deepEqual(result.books.map(b => b.id), [2, 3, 4, 5, 6]);
  assert(result.books.every(b => Number.isFinite(b.score) && b.score > 0 && b.score <= 1));
  assert.equal(result.books[0].sharedConcepts[0].sourcePerspective, intuition.perspective);
  assert.equal(rankRelatedBooks(books, 1, 1).books.length, 1);
});
