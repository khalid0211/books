// Run against the local HTTPS development server: node --test tests/auth.integration.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const crypto = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const codeHash = (email, code) => crypto.createHmac('sha256', process.env.AUTH_SECRET).update(`${email}:${code}`).digest('hex');
function request(path, method = 'GET', body, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'localhost', port: 3000, path, method, rejectUnauthorized: false,
      headers: { origin: 'https://localhost:3000', 'content-type': 'application/json', ...(token ? { cookie: `book_session=${token}` } : {}) } }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
test('email-code lifecycle, 30-day cookies, and server-side role restrictions', async () => {
  const prefix = `auth-test-${crypto.randomBytes(6).toString('hex')}`;
  const email = `${prefix}@example.invalid`;
  const user = await db.user.create({ data: { email, role: 'VIEW' } });
  const extraSessions = [];
  try {
    assert.equal((await request('/api/books')).status, 401);
    assert.equal((await request('/books/new')).status, 307);
    const outsider = `${prefix}-unknown@example.invalid`;
    assert.equal((await request('/api/auth/request-code', 'POST', { email: outsider })).status, 200);
    assert.equal(await db.loginCode.count({ where: { email: outsider } }), 0);
    async function issue(expiresAt = new Date(Date.now() + 600000)) {
      await db.loginCode.deleteMany({ where: { email } });
      await db.loginCode.create({ data: { email, hash: codeHash(email, '123456'), expiresAt } });
    }
    await issue(new Date(Date.now() - 1000));
    assert.equal((await request('/api/auth/verify', 'POST', { email, code: '123456' })).status, 400);
    await issue();
    assert.equal((await request('/api/auth/request-code', 'POST', { email })).status, 429);
    for (let i = 0; i < 5; i++) assert.equal((await request('/api/auth/verify', 'POST', { email, code: '000000' })).status, 400);
    assert.equal((await request('/api/auth/verify', 'POST', { email, code: '123456' })).status, 400);
    await issue();
    const verified = await request('/api/auth/verify', 'POST', { email, code: '123456' });
    assert.equal(verified.status, 200);
    const cookie = verified.headers['set-cookie'][0];
    assert.match(cookie, /Max-Age=2592000/i); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i);
    const token = cookie.split(';')[0].split('=')[1];
    await db.session.update({ where: { tokenHash: hash(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request('/api/books', 'GET', undefined, token)).status, 401);
    await db.session.update({ where: { tokenHash: hash(token) }, data: { expiresAt: new Date(Date.now() + 600000) } });
    assert.equal((await request('/api/auth/verify', 'POST', { email, code: '123456' })).status, 400);
    assert.equal((await request('/api/books', 'GET', undefined, token)).status, 200);
    assert.equal((await request('/api/books', 'POST', { title: 'Forbidden' }, token)).status, 403);
    assert.equal((await request('/api/locations', 'POST', {}, token)).status, 403);
    assert.equal((await request('/api/lookup?isbn=9780140328721', 'GET', undefined, token)).status, 403);
    assert.equal((await request('/api/users', 'GET', undefined, token)).status, 403);
    await db.user.update({ where: { id: user.id }, data: { role: 'LIBRARIAN' } });
    assert.equal((await request('/api/books', 'POST', {}, token)).status, 400); // Allowed through authorization; title validation fails.
    assert.equal((await request('/api/books/1', 'DELETE', undefined, token)).status, 403);
    const owner = await db.user.findUnique({ where: { email: process.env.OWNER_EMAIL } });
    const ownerToken = crypto.randomBytes(32).toString('hex'); extraSessions.push(hash(ownerToken));
    await db.session.create({ data: { tokenHash: hash(ownerToken), userId: owner.id, expiresAt: new Date(Date.now() + 600000) } });
    assert.equal((await request('/api/users', 'GET', undefined, ownerToken)).status, 200);
    assert.equal((await request('/api/users', 'POST', { email: owner.email, role: 'VIEW', active: false }, ownerToken)).status, 400);
    assert.equal((await request('/api/users', 'POST', { email, role: 'OWNER', active: true }, ownerToken)).status, 400);
    assert.equal((await request('/api/users', 'POST', { email, role: 'VIEW', active: false }, ownerToken)).status, 200);
    assert.equal((await request('/api/books', 'GET', undefined, token)).status, 401);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    assert.equal((await request('/api/auth/logout', 'POST', {}, ownerToken)).status, 200);
    assert.equal((await request('/api/users', 'GET', undefined, ownerToken)).status, 401);
  } finally {
    await db.session.deleteMany({ where: { tokenHash: { in: extraSessions } } });
    await db.loginCode.deleteMany({ where: { email } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
