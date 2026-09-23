const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const dates = load('src/lib/loans.ts');
test('loan dates handle defaults, year boundaries, offsets, and invalid inputs', () => {
  const now = new Date('2026-12-25T10:00:00Z');
  assert.equal(dates.loanDates(undefined, dates.DEFAULT_LOAN_DAYS, now).dueAt.toISOString(), '2027-01-09T10:00:00.000Z');
  assert.equal(dates.loanDates('2026-12-25T15:00:00+05:00', 1, now).dueAt.toISOString(), '2026-12-26T10:00:00.000Z');
  for (const days of [0, -1, 1.5, '15', 3651, null]) assert.throws(() => dates.loanDates(undefined, days, now));
  for (const date of ['invalid', '2027-01-01', null, 123]) assert.throws(() => dates.loanDates(date, 15, now));
});

test('loan lifecycle against isolated SQLite: authorization, concurrency, reminders, and atomic returns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-loans-'));
  const url = `file:${path.join(dir, 'test.db').replaceAll('\\', '/')}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  let denied = false, mailFails = false;
  const sent = [];
  try {
    await db.$connect();
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    const { POST, GET } = load('src/app/api/loans/route.ts', {
      '@/lib/auth': { WRITE: ['OWNER', 'LIBRARIAN'], ownerEmail: () => 'owner@example.test', authorize: async (_, roles) => { assert.deepEqual(roles, ['OWNER', 'LIBRARIAN']); return denied ? Response.json({}, { status: 403 }) : null; } },
      '@/lib/prisma': { prisma: db }, '@/lib/book-id': load('src/lib/book-id.ts'), '@/lib/loans': dates,
      '@/lib/locations': load('src/lib/locations.ts'),
      '@/lib/email': { sendLoanReminder: async (...args) => { if (mailFails) throw new Error('SMTP failed'); sent.push(args); } },
    });
    const post = body => POST(new Request('http://localhost/api/loans', { method: 'POST', body: JSON.stringify(body) }));
    const borrower = await db.user.create({ data: { email: 'view@example.test' } });
    const librarian = await db.user.create({ data: { email: 'librarian@example.test', role: 'LIBRARIAN' } });
    const owner = await db.user.create({ data: { email: 'owner@example.test' } });
    const book = await db.book.create({ data: { title: 'A loan book', authors: 'Test', shelfLocation: 'ST-C01-S01' } });
    await db.room.create({ data: { name: 'Study', code: 'ST', cabinets: { create: { number: 1, shelves: { create: [{ number: 1 }, { number: 2 }] } } } } });
    const borrow = { action: 'borrow', bookId: String(book.id), borrowerId: borrower.id };
    denied = true;
    assert.equal((await post(borrow)).status, 403);
    assert.equal((await GET(new Request('http://localhost/api/loans'))).status, 403);
    denied = false;
    assert.equal((await post({ ...borrow, borrowerId: owner.id })).status, 400);
    assert.equal((await post({ ...borrow, bookId: '9780140328721' })).status, 400);
    assert.equal((await post({ ...borrow, bookId: '9999' })).status, 404);
    await db.user.update({ where: { id: borrower.id }, data: { active: false } });
    assert.equal((await post(borrow)).status, 400);
    await db.user.update({ where: { id: borrower.id }, data: { active: true } });
    const response = await post(borrow);
    assert.equal(response.status, 201);
    const loan = await response.json();
    assert.equal(new Date(loan.dueAt) - new Date(loan.borrowedAt), 15 * 86400000);
    assert.equal((await post(borrow)).status, 409);
    assert.equal((await post({ action: 'remind', loanId: loan.id })).status, 409);
    assert.equal(sent.length, 0);
    await db.loan.update({ where: { id: loan.id }, data: { dueAt: new Date(Date.now() - 86400000) } });
    mailFails = true;
    assert.equal((await post({ action: 'remind', loanId: loan.id })).status, 502);
    assert.equal((await db.loan.findUnique({ where: { id: loan.id } })).reminderSentAt, null);
    mailFails = false;
    await db.loan.update({ where: { id: loan.id }, data: { reminderAttemptAt: null } });
    const reminders = await Promise.all([post({ action: 'remind', loanId: loan.id }), post({ action: 'remind', loanId: loan.id })]);
    assert.deepEqual(reminders.map(r => r.status).sort(), [200, 409]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], borrower.email);
    assert.ok((await db.loan.findUnique({ where: { id: loan.id } })).reminderSentAt);
    assert.equal((await post({ action: 'return', bookId: String(book.id), shelfLocation: 'missing' })).status, 400);
    assert.equal((await db.loan.findUnique({ where: { id: loan.id } })).returnedAt, null);
    assert.equal((await db.book.findUnique({ where: { id: book.id } })).shelfLocation, 'ST-C01-S01');
    await assert.rejects(db.book.delete({ where: { id: book.id } }), { code: 'P2003' });
    assert.equal((await post({ action: 'return', bookId: String(book.id), shelfLocation: 'ST-C01-S02' })).status, 200);
    assert.equal((await db.book.findUnique({ where: { id: book.id } })).shelfLocation, 'ST-C01-S02');
    assert.equal((await db.loan.findUnique({ where: { id: loan.id } })).activeBookId, null);
    assert.equal((await post({ action: 'return', bookId: String(book.id) })).status, 404);
    assert.equal((await post({ action: 'remind', loanId: loan.id })).status, 409);
    assert.equal((await (await GET(new Request('http://localhost/api/loans?history=true'))).json()).length, 1);
    assert.equal((await (await GET(new Request('http://localhost/api/loans'))).json()).length, 0);
    const attempts = await Promise.all([post({ ...borrow, borrowerId: librarian.id }), post(borrow)]);
    assert.equal(attempts.filter(r => r.status === 201).length, 1);
    assert.equal(await db.loan.count({ where: { activeBookId: book.id } }), 1);
    assert.equal((await post({ action: 'return', bookId: String(book.id) })).status, 200);
  } finally {
    await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
