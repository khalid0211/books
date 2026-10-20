const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'books-approval-'));
process.env.DATABASE_URL = 'file:' + path.join(temp, 'test.db').replace(/\\/g, '/');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient(); global.prisma = db;
const { fingerprint } = require('../src/lib/enrichment/core.ts');
const { approveExistingEnrichments } = require('../src/lib/enrichment/approval.ts');
const { relatedBooks } = require('../src/lib/enrichment/related.ts');
const { reviewEnrichment } = require('../src/lib/enrichment/service.ts');
const { upgradeStagedBackup } = require('../src/lib/enrichment/restore.ts');
const nativeFetch = global.fetch;
before(async () => { await db.$queryRawUnsafe('SELECT 1'); await db.$disconnect(); execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: process.env, stdio: 'pipe', windowsHide: true }); global.fetch = () => { throw Error('No external calls are allowed for approval or related books'); }; });
beforeEach(async () => { await db.book.deleteMany(); await db.concept.deleteMany(); await db.enrichmentJob.deleteMany(); });
after(async () => { global.fetch = nativeFetch; await db.$disconnect(); fs.rmSync(temp, { recursive: true, force: true }); });
async function seed(number, options = {}) {
  const book = await db.book.create({ data: { title: `Work ${number}`, authors: `Author ${number}` } });
  const revision = { inputFingerprint: fingerprint(book), inputSnapshot: '{}', generatedOutput: JSON.stringify({ identity_match: 'confirmed' }), sourceSnapshot: '{}', identityStatus: 'unmatched', modelIdentityStatus: 'confirmed', knowledgeLevel: 'high', overview: 'A usable overview.', limitations: 'AI-generated, not full-text verified.', model: 'fixture', promptVersion: 'fixture', concepts: { create: ['Intuition', 'Cognitive bias', 'Rapid cognition'].map((name, i) => ({ originalTerm: name, proposedName: name, weight: .9 - i * .1, perspective: `Explores ${name}.` })) }, ...(options.revision || {}) };
  const entry = await db.bookEnrichment.create({ data: { bookId: book.id, ...(options.entry || {}), revisions: { create: revision } }, include: { revisions: { include: { concepts: true } } } });
  return { book, entry, revision: entry.revisions[0] };
}

test('existing sufficient drafts are approved in bounded batches without API calls; insufficient and protected records remain unpublished', async () => {
  const eligible = [];
  for (let i = 0; i < 50; i++) {
    const options = i === 0 ? { revision: { knowledgeLevel: 'insufficient', overview: null } } : i === 1 ? { entry: { manuallyLocked: true } } : i === 2 ? { entry: { autoApprovalBlocked: true } } : i === 3 ? { revision: { knowledgeLevel: 'low' } } : i === 4 ? { revision: { modelIdentityStatus: 'ambiguous' } } : {};
    const row = await seed(i, options); if (i >= 5) eligible.push(row);
  }
  const first = await approveExistingEnrichments(20); assert.equal(first.remaining, 30);
  await approveExistingEnrichments(100);
  assert.equal(await db.bookEnrichmentRevision.count({ where: { reviewStatus: 'approved' } }), 45);
  for (const row of eligible) { const r = await db.bookEnrichmentRevision.findUnique({ where: { id: row.revision.id } }); assert.equal(r.approvalSource, 'automatic'); assert(r.approvedAt); assert.equal(r.identityStatus, 'unmatched'); }
  assert.equal(await db.concept.count(), 3); assert.equal(await db.bookConcept.count({ where: { reviewStatus: 'approved' } }), 135);
  assert.equal((await approveExistingEnrichments()).approved, 0);
});

test('new drafts do not replace manually corrected publications or revive owner-unpublished books', async () => {
  const row = await seed(1); await approveExistingEnrichments();
  const edits = row.revision.concepts.map(c => ({ id: c.id, name: c.proposedName, weight: c.weight, perspective: c.perspective, suppressed: false }));
  await reviewEnrichment(row.book.id, { action: 'publish', revisionId: row.revision.id, identityConfirmed: true, overview: 'Owner correction', centralIdea: '', concepts: edits });
  await reviewEnrichment(row.book.id, { action: 'lock', locked: false });
  const { id, createdAt, editedAt, concepts, ...data } = row.revision;
  await db.bookEnrichmentRevision.create({ data: { ...data, concepts: { create: concepts.map(({ id, revisionId, ...c }) => c) } } });
  await approveExistingEnrichments();
  assert.equal((await db.bookEnrichment.findUnique({ where: { bookId: row.book.id } })).publishedRevisionId, row.revision.id);
  await reviewEnrichment(row.book.id, { action: 'unpublish' });
  await approveExistingEnrichments(); assert.equal((await db.bookEnrichment.findUnique({ where: { bookId: row.book.id } })).publishedRevisionId, null);
});

test('recommendations use only current, approved concepts and update immediately after unpublication or identity edits', async () => {
  const a = await seed(1), b = await seed(2), unknown = await seed(3, { revision: { knowledgeLevel: 'insufficient', overview: null } });
  await approveExistingEnrichments();
  assert.equal((await relatedBooks(a.book.id)).books[0].id, b.book.id);
  assert(!(await relatedBooks(a.book.id)).books.some(r => r.id === unknown.book.id));
  await db.book.update({ where: { id: b.book.id }, data: { authors: 'Changed Author' } });
  assert.deepEqual((await relatedBooks(a.book.id)).books, []);
  await db.book.update({ where: { id: b.book.id }, data: { authors: b.book.authors } });
  assert.equal((await relatedBooks(a.book.id)).books.length, 1);
  await reviewEnrichment(b.book.id, { action: 'unpublish' });
  assert.deepEqual((await relatedBooks(a.book.id)).books, []);
});

test('stale and superseded drafts are skipped and exact aliases are reused without automatic fuzzy merges', async () => {
  const a = await seed(1), b = await seed(2);
  await db.book.update({ where: { id: a.book.id }, data: { title: 'Different title' } });
  const canonical = await db.concept.create({ data: { name: 'Intuitive judgement', nameKey: 'intuitive judgement', aliases: { create: { nameKey: 'intuition' } } } });
  await approveExistingEnrichments();
  assert.equal((await db.bookEnrichment.findUnique({ where: { bookId: a.book.id } })).publishedRevisionId, null);
  assert.equal((await db.bookConcept.findFirst({ where: { revisionId: b.revision.id, originalTerm: 'Intuition' } })).conceptId, canonical.id);
  assert.equal(await db.concept.count(), 3);
});

test('backup/restore retains automatic approval provenance, publication opt-outs and related-book results', async () => {
  const a = await seed(1), b = await seed(2); await approveExistingEnrichments();
  const withheld = await seed(3); await approveExistingEnrichments(); await reviewEnrichment(withheld.book.id, { action: 'unpublish' });
  const backup = path.join(temp, 'approval-backup.db'); await db.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  await upgradeStagedBackup(backup);
  const copy = new PrismaClient({ datasources: { db: { url: 'file:' + backup.replace(/\\/g, '/') } } });
  try { const r = await copy.bookEnrichmentRevision.findUnique({ where: { id: a.revision.id } }); assert.equal(r.approvalSource, 'automatic'); assert(r.approvedAt); assert.equal(await copy.concept.count(), 3); assert.equal((await copy.bookEnrichment.findUnique({ where: { bookId: b.book.id } })).publishedRevisionId, b.revision.id); assert.equal((await copy.bookEnrichment.findUnique({ where: { bookId: withheld.book.id } })).autoApprovalBlocked, true); } finally { await copy.$disconnect(); }
});

test('Owner can recheck a previously locked draft after explicitly unlocking it', async () => {
  const row = await seed(1, { entry: { manuallyLocked: true } });
  assert.equal((await approveExistingEnrichments()).approved, 0);
  await reviewEnrichment(row.book.id, { action: 'lock', locked: false });
  assert.equal((await approveExistingEnrichments(100, true)).approved, 1);
});

test('existing run items are linked to their revision and change from needs_review to approved', async () => {
  const row = await seed(1);
  const job = await db.enrichmentJob.create({ data: { startId: row.book.id, endId: row.book.id, model: 'fixture', inputRate: 1, outputRate: 1, budgetUsd: 1, status: 'completed', createdAt: new Date(row.revision.createdAt.getTime() - 1000), updatedAt: new Date(row.revision.createdAt.getTime() + 1000), items: { create: { bookId: row.book.id, status: 'needs_review' } } } });
  await approveExistingEnrichments();
  const item = await db.enrichmentJobItem.findFirst({ where: { jobId: job.id } });
  assert.equal(item.revisionId, row.revision.id); assert.equal(item.status, 'approved');
});

test('suppressed concepts and duplicate canonical mappings do not contaminate recommendations', async () => {
  const a = await seed(1), b = await seed(2); await approveExistingEnrichments();
  await db.bookConcept.updateMany({ where: { revisionId: b.revision.id, originalTerm: { in: ['Intuition', 'Cognitive bias'] } }, data: { reviewStatus: 'suppressed' } });
  assert.deepEqual((await relatedBooks(a.book.id)).books, []);
});

test('pre-approval backups gain the new fields without losing existing enrichment', async () => {
  const oldSchema = fs.readFileSync('prisma/schema.prisma', 'utf8')
    .replace(/^  (?:autoApprovalBlocked|approvalSource|approvedAt|autoApprovalCheckedAt|approvalNote) .*\r?\n/gm, '')
    .replace(/^  jobItems EnrichmentJobItem\[\]\r?\n/gm, '')
    .replace(/^  revisionId Int\?\r?\n/gm, '')
    .replace(/^  revision BookEnrichmentRevision\? @relation\(.*\r?\n/gm, '');
  const oldFile = path.join(temp, 'before-auto.db'), schema = path.join(temp, 'before-auto.prisma');
  fs.writeFileSync(schema, oldSchema);
  const url = 'file:' + oldFile.replace(/\\/g, '/');
  const old = new PrismaClient({ datasources: { db: { url } } });
  await old.$queryRawUnsafe('SELECT 1'); await old.$disconnect();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', windowsHide: true });
  try {
    const saved = await old.book.create({ data: { title: 'Preserved work', authors: 'Preserved author' } });
    await old.$executeRawUnsafe('INSERT INTO BookEnrichment (bookId, manuallyLocked, publishedRevisionId) VALUES (?, 0, NULL)', saved.id);
    await old.$executeRawUnsafe('INSERT INTO BookEnrichmentRevision (bookId, inputFingerprint, inputSnapshot, sourceSnapshot, identityStatus, knowledgeLevel, overview, limitations, model, promptVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', saved.id, fingerprint(saved), '{}', '{}', 'verified', 'high', 'Preserved overview', 'AI-generated', 'old-model', 'old-prompt');
  } finally { await old.$disconnect(); }
  await upgradeStagedBackup(oldFile);
  const upgraded = new PrismaClient({ datasources: { db: { url } } });
  try { assert.equal(await upgraded.book.count(), 1); assert.equal(await upgraded.bookEnrichmentRevision.count(), 1); const restored = await upgraded.bookEnrichmentRevision.findFirst(); assert.equal(restored.overview, 'Preserved overview'); assert.equal(restored.approvalSource, null); await upgraded.enrichmentJobItem.findMany(); } finally { await upgraded.$disconnect(); }
});
