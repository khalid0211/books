const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const vm = require('node:vm');
// Load the server-only TypeScript modules without running a Next server or live API calls.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'books-enrichment-test-'));
const dbFile = path.join(temp, 'test.db');
process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, '/')}`;
process.env.ENRICHMENT_SECRET = crypto.randomBytes(32).toString('base64');
process.env.ENRICHMENT_WORKER_ENABLED = 'false';
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
global.prisma = db;
const queueFile = path.resolve('src/lib/open-library-queue.ts');
require.cache[queueFile] = { exports: { queueOpenLibrary: async fn => fn() } };
const core = require('../src/lib/enrichment/core.ts');
const clients = require('../src/lib/enrichment/clients.ts');
const service = require('../src/lib/enrichment/service.ts');
const worker = require('../src/lib/enrichment/worker.ts');
const { upgradeStagedBackup } = require('../src/lib/enrichment/restore.ts');
const { enrichmentBookFields } = require('../src/lib/enrichment/airtable.ts');
const nativeFetch = global.fetch;
const baseBook = { title: 'Example Book', authors: 'Example Author', isbn10: null, isbn13: null, publicationDate: null, edition: null, language: null };
const output = { identity_match: 'confirmed', knowledge_level: 'high', overview: 'A model-generated overview of the correct book.', central_idea: 'How judgement works.', limitations: 'AI-generated from metadata and model knowledge, not full-text verified.', concepts: [{ name: 'Intuition', salience: .9, perspective: 'Examines intuitive judgement.' }, { name: 'Cognitive bias', salience: .8, perspective: 'Examines errors.' }, { name: 'Decision making', salience: .6, perspective: null }] };
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
let apiCalls = 0, failProvider = false, beforeProvider = null;
function fakeFetch(url, init) {
  if (String(url).startsWith('https://openlibrary.org/search.json')) return Promise.resolve(json({ docs: [{ key: '/works/OL1W', title: baseBook.title, author_name: [baseBook.authors] }] }));
  if (url === 'https://openlibrary.org/works/OL1W.json') return Promise.resolve(json({ key: '/works/OL1W', title: baseBook.title, description: { value: 'A public catalogue description.' } }));
  if (url === 'https://api.openai.com/v1/responses') {
    apiCalls++;
    const request = JSON.parse(init.body);
    assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
    return Promise.resolve().then(async () => {
      if (beforeProvider) await beforeProvider();
      if (failProvider) return json({}, 429);
      return json({ status: 'completed', usage: { input_tokens: 300, output_tokens: 150 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
    });
  }
  throw Error('Unexpected network call: ' + url);
}
before(async () => {
  await db.$queryRawUnsafe('SELECT 1');
  await db.$disconnect();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: process.env, stdio: 'pipe', windowsHide: true });
  global.fetch = fakeFetch;
});
after(async () => { global.fetch = nativeFetch; await db.$disconnect(); fs.rmSync(temp, { recursive: true, force: true }); });

test('encryption, normalization, identity, output validation and fingerprints', () => {
  const encrypted = core.encryptKey('test-key-12345678901234567890');
  assert(!encrypted.includes('test-key')); assert.equal(core.decryptKey(encrypted), 'test-key-12345678901234567890');
  const secret = process.env.ENRICHMENT_SECRET; process.env.ENRICHMENT_SECRET = crypto.randomBytes(32).toString('base64');
  assert.throws(() => core.decryptKey(encrypted), /cannot be decrypted/); process.env.ENRICHMENT_SECRET = secret;
  assert.equal(core.conceptKey('  Cognitive—Bias  '), 'cognitive bias');
  assert.equal(core.identityMatches(baseBook, { title: baseBook.title, authors: ['Other Author'] }), false);
  assert.equal(core.identityMatches(baseBook, { title: baseBook.title, authors: [baseBook.authors] }), true);
  assert.equal(core.identityMatches(baseBook, { title: 'Different', authors: [baseBook.authors] }), false);
  assert.throws(() => core.validateOutput({ ...output, concepts: [{ name: 'X', salience: 2, perspective: null }] }));
  assert.throws(() => core.validateOutput({ ...output, extra: true }));
  assert.equal(core.validateOutput({ ...output, knowledge_level: 'insufficient' }).overview, null);
  assert.equal(core.validateOutput({ ...output, identity_match: 'ambiguous' }).concepts.length, 0);
  assert.equal(core.fingerprint({ ...baseBook, shelfLocation: 'A' }), core.fingerprint({ ...baseBook, shelfLocation: 'B' }));
  assert.notEqual(core.fingerprint(baseBook), core.fingerprint({ ...baseBook, authors: 'Other Author' }));
});

test('catalogue range, draft generation, owner correction, publication, locking and Airtable fields', async () => {
  await service.saveSettings({ model: 'test-model', apiKey: 'test-key-12345678901234567890', inputRate: 1, outputRate: 4, budgetUsd: 1, maxBooks: 10 });
  const settings = await service.settingsPublic(); assert(settings.keyUsable); assert(!('encryptedKey' in settings));
  const a = await db.book.create({ data: baseBook });
  const missing = await db.book.create({ data: { ...baseBook, title: 'Delete this gap' } });
  const b = await db.book.create({ data: baseBook }); await db.book.delete({ where: { id: missing.id } });
  const preview = await service.previewRange({ start: `B${a.id}`, end: `B${b.id}` }); assert.equal(preview.eligible, 2); assert.equal(preview.missing, 1);
  await assert.rejects(service.previewRange({ start: 'B10', end: 'B1' }), /inclusive range/);
  const job = await service.createJob({ start: `B${a.id}`, end: `B${b.id}` });
  await assert.rejects(service.createJob({ start: `B${a.id}`, end: `B${b.id}` }), /current run/);
  await worker.processNextItem(); await worker.processNextItem(); await worker.processNextItem();
  assert.equal((await db.enrichmentJob.findUnique({ where: { id: job.id } })).status, 'completed');
  assert.equal((await service.readEnrichment(a.id, false)).revisions.length, 0);
  const draft = (await service.readEnrichment(a.id, true)).revisions[0]; assert.equal(draft.identityStatus, 'verified');
  assert.equal(draft.olDescription, 'A public catalogue description.'); assert.equal(draft.concepts.length, 3);
  const edit = { action: 'publish', revisionId: draft.id, identityConfirmed: true, overview: 'Owner-corrected overview.', centralIdea: 'Corrected central idea.', concepts: draft.concepts.map((c, i) => ({ id: c.id, name: i === 0 ? 'Intuitive judgement' : c.proposedName, weight: c.weight, perspective: c.perspective || '', suppressed: i === 2, saveAlias: i === 0 })) };
  await assert.rejects(service.reviewEnrichment(a.id, { ...edit, identityConfirmed: false }), /Confirm/);
  await assert.rejects(service.reviewEnrichment(a.id, { ...edit, concepts: edit.concepts.map((c, i) => i === 1 ? { ...c, name: edit.concepts[0].name } : c) }), /same canonical concept/);
  await service.reviewEnrichment(a.id, edit);
  const published = await service.readEnrichment(a.id, false); assert.equal(published.revisions[0].overview, 'Owner-corrected overview.'); assert.equal(published.revisions[0].concepts.length, 2);
  assert(!('generatedOutput' in published.revisions[0])); assert(!('sourceSnapshot' in published.revisions[0]));
  assert.equal((await db.conceptAlias.findUnique({ where: { nameKey: 'intuition' } })).conceptId, published.revisions[0].concepts[0].conceptId);
  assert.equal((await service.previewRange({ start: `B${a.id}`, end: `B${a.id}`, regenerate: true })).eligible, 0);
  let row = await db.book.findUnique({ where: { id: a.id }, include: { enrichment: { include: { publishedRevision: { include: { concepts: { include: { concept: true } } } } } } } });
  assert.equal(enrichmentBookFields(row)['AI Overview'], 'Owner-corrected overview.');
  assert(!enrichmentBookFields(row).Concepts.includes('Decision making'));
  await db.book.update({ where: { id: a.id }, data: { title: 'Changed identity' } });
  assert.equal((await service.readEnrichment(a.id, false)).revisions.length, 0);
  await assert.rejects(service.reviewEnrichment(a.id, edit), /identity changed/);
  row = { ...row, title: 'Changed identity' }; assert.equal(enrichmentBookFields(row)['AI Overview'], null); assert.equal(enrichmentBookFields(row)['Enrichment Status'], 'stale');
});

test('rate limits retry with persisted attempts and conservative reservations, then respect budget', async () => {
  const book = await db.book.create({ data: baseBook });
  const job = await service.createJob({ start: String(book.id), end: String(book.id) });
  failProvider = true;
  await worker.processNextItem();
  let item = await db.enrichmentJobItem.findFirst({ where: { jobId: job.id } });
  assert.equal(item.status, 'queued'); assert.equal(item.attempts, 1); assert.match(item.error, /HTTP 429/); assert(item.nextAttemptAt > new Date());
  let run = await db.enrichmentJob.findUnique({ where: { id: job.id } }); assert(run.accountedUsd > 0);
  await db.enrichmentJob.update({ where: { id: job.id }, data: { budgetUsd: run.accountedUsd } });
  await db.enrichmentJobItem.update({ where: { id: item.id }, data: { nextAttemptAt: new Date(0) } });
  const calls = apiCalls; await worker.processNextItem(); assert.equal(apiCalls, calls);
  assert.equal((await db.enrichmentJob.findUnique({ where: { id: job.id } })).status, 'paused');
  await service.controlJob(job.id, 'cancel'); failProvider = false;
});

test('manual locks and identity edits during a paid request discard generated results', async () => {
  for (const lock of [true, false]) {
    const book = await db.book.create({ data: baseBook });
    const job = await service.createJob({ start: String(book.id), end: String(book.id) });
    beforeProvider = async () => {
      if (lock) await db.bookEnrichment.create({ data: { bookId: book.id, manuallyLocked: true } });
      else await db.book.update({ where: { id: book.id }, data: { authors: 'Changed Author' } });
    };
    await worker.processNextItem(); beforeProvider = null;
    assert.equal(await db.bookEnrichmentRevision.count({ where: { bookId: book.id } }), 0);
    assert.equal((await db.enrichmentJobItem.findFirst({ where: { jobId: job.id } })).status, 'skipped');
    await worker.processNextItem();
  }
});

test('ambiguous Open Library titles supply no unverified description; missing sources remain explicit', async () => {
  global.fetch = async url => String(url).includes('search.json') ? json({ docs: [{ key: '/works/OL2W', title: baseBook.title, author_name: ['Wrong Author'] }] }) : Promise.reject(Error('Should not fetch an unverified work'));
  let source = await clients.retrieveSource(baseBook); assert.equal(source.identityStatus, 'ambiguous'); assert.equal(source.description, null);
  global.fetch = async () => json({ docs: [] }); source = await clients.retrieveSource(baseBook); assert.equal(source.identityStatus, 'unmatched');
  global.fetch = fakeFetch;
});

test('SQLite snapshot and staged restore retain enrichment and pause restored work', async () => {
  const book = await db.book.create({ data: baseBook });
  const job = await service.createJob({ start: String(book.id), end: String(book.id) });
  await db.enrichmentJob.update({ where: { id: job.id }, data: { status: 'running', accountedUsd: .02 } });
  await db.enrichmentJobItem.updateMany({ where: { jobId: job.id }, data: { status: 'running' } });
  const backup = path.join(temp, 'snapshot.db'); await db.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  await upgradeStagedBackup(backup);
  const restored = new PrismaClient({ datasources: { db: { url: `file:${backup.replace(/\\/g, '/')}` } } });
  try {
    assert.equal(await restored.bookEnrichmentRevision.count(), await db.bookEnrichmentRevision.count());
    assert.equal(await restored.concept.count(), await db.concept.count());
    assert.equal((await restored.enrichmentJob.findUnique({ where: { id: job.id } })).status, 'paused');
    assert.equal((await restored.enrichmentJob.findUnique({ where: { id: job.id } })).accountedUsd, .02);
    assert.equal((await restored.enrichmentJobItem.findFirst({ where: { jobId: job.id } })).status, 'queued');
    assert.equal((await restored.enrichmentSettings.findUnique({ where: { id: 1 } })).encryptedKey, (await db.enrichmentSettings.findUnique({ where: { id: 1 } })).encryptedKey);
  } finally { await restored.$disconnect(); }
  await service.controlJob(job.id, 'cancel');
});

test('backups from before enrichment are upgraded in staging without losing books', async () => {
  const legacyFile = path.join(temp, 'legacy.db'), schemaFile = path.join(temp, 'legacy.prisma');
  const legacySchema = fs.readFileSync('prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n').split('model EnrichmentSettings')[0].replace('  enrichment BookEnrichment?\n', '').replace('  enrichmentItems EnrichmentJobItem[]\n', '');
  fs.writeFileSync(schemaFile, legacySchema);
  const initialize = new PrismaClient({ datasources: { db: { url: `file:${legacyFile.replace(/\\/g, '/')}` } } });
  await initialize.$queryRawUnsafe('SELECT 1'); await initialize.$disconnect();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schemaFile], { env: { ...process.env, DATABASE_URL: `file:${legacyFile.replace(/\\/g, '/')}` }, stdio: 'pipe', windowsHide: true });
  const legacy = new PrismaClient({ datasources: { db: { url: `file:${legacyFile.replace(/\\/g, '/')}` } } });
  try { await legacy.book.create({ data: baseBook }); } finally { await legacy.$disconnect(); }
  await upgradeStagedBackup(legacyFile);
  const upgraded = new PrismaClient({ datasources: { db: { url: `file:${legacyFile.replace(/\\/g, '/')}` } } });
  try { assert.equal(await upgraded.book.count(), 1); assert.equal(await upgraded.bookEnrichmentRevision.count(), 0); } finally { await upgraded.$disconnect(); }
});

test('a restarted worker pauses interrupted jobs without issuing another paid request', async () => {
  const book = await db.book.create({ data: baseBook });
  const job = await service.createJob({ start: String(book.id), end: String(book.id) });
  await db.enrichmentJob.update({ where: { id: job.id }, data: { status: 'running' } });
  await db.enrichmentJobItem.updateMany({ where: { jobId: job.id }, data: { status: 'running' } });
  const calls = apiCalls;
  worker.resetEnrichmentWorker(); await worker.runEnrichmentTick();
  assert.equal(apiCalls, calls);
  assert.equal((await db.enrichmentJob.findUnique({ where: { id: job.id } })).status, 'paused');
  assert.equal((await db.enrichmentJobItem.findFirst({ where: { jobId: job.id } })).status, 'queued');
  await service.controlJob(job.id, 'resume'); await worker.runEnrichmentTick();
  assert.equal(apiCalls, calls + 1);
  await worker.runEnrichmentTick();
});

test('regeneration preserves published content and uses reviewed concept aliases', async () => {
  const book = await db.book.create({ data: baseBook });
  let job = await service.createJob({ start: String(book.id), end: String(book.id) });
  await worker.processNextItem(); await worker.processNextItem();
  const draft = (await service.readEnrichment(book.id, true)).revisions[0];
  await service.reviewEnrichment(book.id, { action: 'publish', revisionId: draft.id, identityConfirmed: true, overview: 'Approved old overview.', centralIdea: '', concepts: draft.concepts.map(c => ({ id: c.id, name: c.proposedName, weight: c.weight, perspective: c.perspective || '', suppressed: false })) });
  await service.reviewEnrichment(book.id, { action: 'lock', locked: false });
  job = await service.createJob({ start: String(book.id), end: String(book.id), regenerate: true });
  await worker.processNextItem(); await worker.processNextItem();
  assert.equal((await service.readEnrichment(book.id, false)).revisions[0].overview, 'Approved old overview.');
  const owner = await service.readEnrichment(book.id, true); assert.equal(owner.revisions.length, 2);
  assert.equal(owner.revisions[0].concepts.find(c => c.originalTerm === 'Intuition').concept.name, 'Intuitive judgement');
  const calls = apiCalls; await worker.processNextItem(); assert.equal(apiCalls, calls);
});

test('Airtable exports approved enrichment incrementally, clears unpublished fields and deactivates missing assignments', async () => {
  const remote = new Map(), writes = [];
  process.env.AIRTABLE_TOKEN = 'fake-airtable-secret'; process.env.AIRTABLE_BASE_ID = 'appTest';
  const fakeAirtable = async (url, init = {}) => {
    const table = decodeURIComponent(new URL(url).pathname.split('/').pop());
    const records = remote.get(table) || []; remote.set(table, records);
    if (!init.method) return json({ records });
    const body = JSON.parse(init.body); writes.push({ table, body });
    for (const item of body.records) {
      if (init.method === 'POST') records.push({ id: 'rec' + crypto.randomBytes(5).toString('hex'), fields: item.fields });
      else Object.assign(records.find(r => r.id === item.id).fields, item.fields);
    }
    return json({ records: [] });
  };
  let deny = false;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/database/airtable/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, process, URLSearchParams, Response, fetch: fakeAirtable, console, setTimeout: fn => { fn(); },
    require: name => {
      if (name === '@/lib/auth') return { authorize: async () => deny ? json({ error: 'Forbidden' }, 403) : null, OWNER: ['OWNER'] };
      if (name === '@/lib/prisma') return { prisma: db };
      if (name === '@/lib/enrichment/airtable') return { enrichmentBookFields };
      if (name === '@/lib/enrichment/core') return core;
      return require(name);
    },
  });
  deny = true; assert.equal((await exports.POST(new Request('http://localhost/api/database/airtable', { method: 'POST' }))).status, 403); assert.equal(writes.length, 0);
  deny = false;
  let response = await exports.POST(new Request('http://localhost/api/database/airtable', { method: 'POST' })); assert.equal(response.status, 200); assert((await response.json()).totals.created > 0);
  assert(!JSON.stringify(writes).includes('test-key-')); assert(!JSON.stringify(writes).includes('encryptedKey'));
  const published = remote.get('Books').find(r => r.fields['Enrichment Status'] === 'published'); assert(published);
  assert(published.fields['AI Overview']);
  const writeCount = writes.length;
  response = await exports.POST(new Request('http://localhost/api/database/airtable', { method: 'POST' })); assert.equal((await response.json()).totals.updated, 0); assert.equal(writes.length, writeCount);
  const id = Number(published.fields['Source ID'].split(':')[1]);
  await service.reviewEnrichment(id, { action: 'unpublish' });
  await exports.POST(new Request('http://localhost/api/database/airtable', { method: 'POST' })); assert.equal(published.fields['AI Overview'], null);
  assert(remote.get('Book Concepts').filter(r => r.fields['Book Source ID'] === 'Book:' + id).every(r => r.fields.Active === 'false'));
  const orphan = { id: 'recOrphan', fields: { 'Source ID': 'BookConcept:999999', 'Sync Hash': 'old', Active: 'true' } }; remote.get('Book Concepts').push(orphan);
  await exports.POST(new Request('http://localhost/api/database/airtable', { method: 'POST' })); assert.equal(orphan.fields.Active, 'false');
});
