const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => dependencies[name], ...globals });
  return exports;
}
const isbn = load('src/lib/isbn.ts', {});
function route(fetch) {
  return load('src/app/api/lookup/route.ts', {
    '@/lib/auth': { authorize: async () => null, WRITE: ['OWNER', 'LIBRARIAN'] },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/isbn': isbn,
    '@/lib/open-library-queue': { queueOpenLibrary: fn => fn() },
  }, { fetch, URL, AbortController, setTimeout, clearTimeout }).GET;
}
const request = { url: 'https://localhost/api/lookup?isbn=978-0-7195-6005-7' };
const response = (status, body) => ({ ok: status === 200, status, json: async () => body });

test('hyphenated ISBN succeeds after a temporary Open Library failure despite Google quota failure', async () => {
  let attempts = 0;
  const get = route(async url => {
    if (url.includes('googleapis')) return response(429, {});
    assert.match(url, /ISBN:9780719560057/);
    if (++attempts === 1) throw new Error('timeout');
    return response(200, { 'ISBN:9780719560057': { title: 'Empires of the Indus', authors: [{ name: 'Alice Albinia' }] } });
  });
  const result = await get(request);
  assert.equal(result.status, 200);
  assert.equal(result.body.title, 'Empires of the Indus');
  assert.equal(result.body.authors, 'Alice Albinia');
  assert.equal(attempts, 2);
});

test('persistent provider errors are reported as unavailable, not missing', async () => {
  const get = route(async url => response(url.includes('googleapis') ? 429 : 503, {}));
  const result = await get(request);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Open Library: HTTP 503/);
  assert.match(result.body.error, /Google Books: request quota/);
});

test('successful empty searches still return not found without retrying', async () => {
  let calls = 0;
  const get = route(async () => { calls++; return response(200, {}); });
  assert.equal((await get(request)).status, 404);
  assert.equal(calls, 2);
});
