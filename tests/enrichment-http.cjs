// Requires npm run build. Starts an isolated production server and never calls providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'books-enrichment-http-'));
  const file = path.join(temp, 'http.db');
  const env = { ...process.env, DATABASE_URL: 'file:' + file.replace(/\\/g, '/'), OWNER_EMAIL: 'owner@example.invalid', AUTH_SECRET: crypto.randomBytes(32).toString('hex'), ENRICHMENT_SECRET: crypto.randomBytes(32).toString('base64'), ENRICHMENT_WORKER_ENABLED: 'true', AIRTABLE_TOKEN: '', AIRTABLE_BASE_ID: '' };
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  let server, log = '';
  try {
    await db.$queryRawUnsafe('SELECT 1'); await db.$disconnect();
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env, stdio: 'pipe', windowsHide: true });
    const sessions = {};
    for (const role of ['OWNER', 'LIBRARIAN', 'VIEW']) {
      const user = await db.user.create({ data: { email: role === 'OWNER' ? env.OWNER_EMAIL : role.toLowerCase() + '@example.invalid', role: role === 'OWNER' ? 'VIEW' : role } });
      const token = crypto.randomBytes(32).toString('hex'); sessions[role] = token;
      await db.session.create({ data: { userId: user.id, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    }
    const book = await db.book.create({ data: { title: 'HTTP Pilot Book', authors: 'Test Author' } });
    // Hold the worker lease until every test-created job is paused. No provider calls can run.
    await db.enrichmentWorkerLease.create({ data: { id: 1, token: 'http-test-hold', expiresAt: new Date(Date.now() + 86400000) } });
    const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
    const origin = 'http://127.0.0.1:' + port;
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
    for (let i = 0; i < 90; i++) { try { if ((await fetch(origin + '/login')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); if (i === 89) throw Error('Server failed to start: ' + log); }
    async function request(url, role, body, foreign = false) {
      return fetch(origin + url, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST', headers: { ...(role ? { cookie: 'book_session=' + sessions[role] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: foreign ? 'http://other.invalid' : origin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    assert.equal((await request('/api/enrichment/settings')).status, 401);
    assert.equal((await request(`/api/books/${book.id}/related`)).status, 401);
    for (const role of ['VIEW', 'LIBRARIAN']) {
      assert.equal((await request('/api/enrichment/settings', role)).status, 403);
      assert.equal((await request('/api/enrichment/preview', role, { start: 'B1', end: 'B10' })).status, 403);
      assert.equal((await request('/enrichment', role)).status, 307);
      assert.equal((await request(`/api/books/${book.id}/enrichment`, role, { action: 'lock', locked: true })).status, 403);
      assert.equal((await request('/api/enrichment/approve-existing', role, {})).status, 403);
    }
    const input = { model: 'test-model', apiKey: 'test-key-12345678901234567890', inputRate: 1, outputRate: 4, budgetUsd: 1, maxBooks: 10 };
    assert.equal((await request('/api/enrichment/settings', 'OWNER', input, true)).status, 403);
    let response = await request('/api/enrichment/settings', 'OWNER', input); assert.equal(response.status, 200); const settings = await response.json(); assert(settings.keyUsable); assert(!JSON.stringify(settings).includes(input.apiKey)); assert(!('encryptedKey' in settings));
    response = await request('/api/books', 'OWNER'); assert.equal((await response.json())[0].enrichmentStatus, 'not_enriched');
    for (const role of ['VIEW', 'LIBRARIAN']) { response = await request('/api/books', role); assert(!('enrichmentStatus' in (await response.json())[0])); }
    response = await request('/api/enrichment/preview', 'OWNER', { start: 'B0001', end: 'B0010' }); assert.equal(response.status, 200); const preview = await response.json(); assert.equal(preview.eligible, 1); assert.equal(preview.missing, 9);
    response = await request('/api/enrichment/jobs', 'OWNER', { start: 'B0001', end: 'B0010' }); assert.equal(response.status, 201); const job = await response.json();
    assert.deepEqual(job.items[0].book, { id: book.id, title: book.title }, 'created run response must match the book detail shape used by the job list');
    assert.equal((await request('/api/enrichment/control', 'OWNER', { id: job.id, action: 'pause' })).status, 200);
    await db.enrichmentWorkerLease.deleteMany();
    let workerStarted = false;
    for (let i = 0; i < 20; i++) {
      const lease = await db.enrichmentWorkerLease.findUnique({ where: { id: 1 } });
      if (lease && lease.token !== 'http-test-hold') { workerStarted = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    assert(workerStarted, 'Next instrumentation must start the durable worker');
    const fingerprintInput = { title: book.title, authors: book.authors, isbn10: null, isbn13: null, publicationDate: null, edition: null, language: null };
    const topicNames = ['Intuition', 'Cognitive bias', 'Rapid cognition'];
    const makeConcepts = () => ({ create: topicNames.map(name => ({ originalTerm: name, proposedName: name, weight: .9, perspective: `Explores ${name}.` })) });
    const draft = await db.bookEnrichment.create({ data: { bookId: book.id, manuallyLocked: true, revisions: { create: { inputFingerprint: crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex'), inputSnapshot: JSON.stringify(fingerprintInput), sourceSnapshot: '{}', identityStatus: 'verified', knowledgeLevel: 'high', overview: 'A draft overview for review.', limitations: 'AI-generated; not full-text verified.', model: 'test-model', promptVersion: 'test', concepts: makeConcepts() } } }, include: { revisions: { include: { concepts: true } } } });
    response = await request('/api/books', 'OWNER'); assert.equal((await response.json())[0].enrichmentStatus, 'needs_review');
    response = await request(`/api/books/${book.id}/enrichment`, 'VIEW'); assert.deepEqual((await response.json()).revisions, []);
    const returnTo = '/?enrichment=needs_review&sort=id&dir=asc';
    response = await request(`/books/${book.id}?returnTo=${encodeURIComponent(returnTo)}`, 'OWNER'); assert((await response.text()).includes('href="/?enrichment=needs_review'));
    response = await request(`/api/books/${book.id}/enrichment`, 'OWNER', { action: 'publish', revisionId: draft.revisions[0].id, identityConfirmed: true, overview: 'An approved overview.', centralIdea: '', concepts: draft.revisions[0].concepts.map(c => ({ id: c.id, name: c.proposedName, weight: c.weight, perspective: c.perspective, suppressed: false })) }); assert.equal(response.status, 200);
    response = await request('/api/books', 'OWNER'); assert.equal((await response.json())[0].enrichmentStatus, 'published');
    for (const url of ['/enrichment', `/books/${book.id}`, '/database']) { response = await request(url, 'OWNER'); assert.equal(response.status, 200); const text = await response.text(); assert(!text.includes(input.apiKey)); }
    response = await request(`/api/books/${book.id}/enrichment`, 'VIEW'); assert.equal((await response.json()).revisions[0].overview, 'An approved overview.');
    response = await request(`/api/books/${book.id}/enrichment`, 'VIEW'); assert.match((await response.json()).revisions[0].sourceLabel, /no matched Open Library description/);
    const second = await db.book.create({ data: { title: 'Another Work', authors: 'Another Author' } });
    const secondInput = { ...fingerprintInput, title: second.title, authors: second.authors };
    await db.bookEnrichment.create({ data: { bookId: second.id, revisions: { create: { inputFingerprint: crypto.createHash('sha256').update(JSON.stringify(secondInput)).digest('hex'), inputSnapshot: JSON.stringify(secondInput), sourceSnapshot: '{}', identityStatus: 'unmatched', modelIdentityStatus: 'confirmed', knowledgeLevel: 'high', overview: 'Another useful overview.', limitations: 'AI-generated.', model: 'test-model', promptVersion: 'test', concepts: makeConcepts() } } } });
    response = await request('/api/enrichment/approve-existing', 'OWNER', {}); assert.equal(response.status, 200);
    for (const role of ['OWNER', 'LIBRARIAN', 'VIEW']) { response = await request(`/api/books/${book.id}/related`, role); assert.equal(response.status, 200); const related = await response.json(); assert.equal(related.books[0].id, second.id); assert.equal(related.books[0].sharedConcepts.length, 3); }
    assert.equal((await request(`/api/books/${book.id}/related?limit=99`, 'VIEW')).status, 400);
    assert.equal((await request('/api/books/999999/related', 'VIEW')).status, 404);
    // Owner backup endpoint includes every new table; restore exercises staging, session preservation and paused jobs.
    response = await request('/api/database/backup', 'OWNER'); assert.equal(response.status, 200); const bytes = await response.arrayBuffer(); assert(Buffer.from(bytes).subarray(0, 16).toString().startsWith('SQLite format 3'));
    const form = new FormData(); form.set('confirmation', 'RESTORE'); form.set('backup', new Blob([bytes]), 'catalogue.db');
    await db.$disconnect(); // Windows cannot replace a SQLite file held open by this test process.
    response = await fetch(origin + '/api/database/restore', { method: 'POST', headers: { cookie: 'book_session=' + sessions.OWNER, Origin: origin }, body: form }); assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await db.enrichmentJob.findUnique({ where: { id: job.id } })).status, 'paused'); assert.equal(await db.book.count(), 2);
    response = await request(`/api/books/${book.id}/related`, 'VIEW'); assert.equal((await response.json()).books[0].id, second.id);
    response = await request(`/api/books/${second.id}/enrichment`, 'OWNER', { action: 'unpublish' }); assert.equal(response.status, 200);
    response = await request(`/api/books/${book.id}/related`, 'VIEW'); assert.deepEqual((await response.json()).books, []);
    console.log('Authenticated HTTP checks passed: Owner-only controls, auto-approval, related books for all roles, publication invalidation, filtered navigation, backup and restore.');
  } finally {
    if (server && server.exitCode === null) { const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited; }
    await db.$disconnect(); fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
