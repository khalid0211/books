const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const crypto = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
function request(path, method = 'GET', body, token, origin = 'https://localhost:3000') {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'localhost', port: 3000, path, method, rejectUnauthorized: false, headers: { origin, 'content-type': 'application/json', ...(token ? { cookie: `book_session=${token}` } : {}) } }, (res) => {
      let text = ''; res.on('data', (b) => text += b); res.on('end', () => { let data; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, data, text }); });
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
test('classification lifecycle preserves existing choices and enforces access', async () => {
  const name = `classification-test-${crypto.randomBytes(6).toString('hex')}`;
  const user = await db.user.create({ data: { email: `${name}@example.invalid`, role: 'VIEW' } });
  const token = crypto.randomBytes(32).toString('hex');
  const bookIds = [], categoryIds = [];
  await db.session.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() + 600000) } });
  try {
    assert.equal((await request('/api/categories')).status, 401);
    assert.equal((await request('/api/categories', 'POST', { name }, token)).status, 403);
    assert.equal((await request('/api/classification', 'POST', { bookIds: [1] }, token)).status, 403);
    await db.user.update({ where: { id: user.id }, data: { role: 'LIBRARIAN' } });
    for (const suffix of ['a', 'b']) {
      const r = await request('/api/categories', 'POST', { name: `${name}-${suffix}` }, token);
      assert.equal(r.status, 201); categoryIds.push(r.data.id);
    }
    assert.equal((await request('/api/categories', 'POST', { name: `${name}-A` }, token)).status, 409);
    for (let i = 0; i < 2; i++) {
      const r = await request('/api/books', 'POST', { title: name, authors: 'Test', ...(i ? { bookType: 'Fiction', categoryIds: [categoryIds[0]] } : {}) }, token);
      assert.equal(r.status, 201); bookIds.push(r.data.id);
    }
    const input = { bookIds, bookType: 'Non-fiction', categoryIds: [categoryIds[1]] };
    assert.equal((await request('/api/classification', 'POST', input, token, 'https://other.invalid')).status, 403);
    assert.equal((await request('/api/classification', 'POST', { ...input, categoryIds: [2147483647] }, token)).status, 400);
    assert.equal((await request('/api/classification', 'POST', { ...input, bookType: 'Invalid' }, token)).status, 400);
    const moved = await request('/api/classification', 'POST', input, token);
    assert.equal(moved.status, 200); assert.equal(moved.data.updated, 1); assert.equal(moved.data.skipped, 1);
    let existing = (await request(`/api/books/${bookIds[1]}`, 'GET', undefined, token)).data;
    assert.equal(existing.bookType, 'Fiction'); assert.equal(existing.categories[0].id, categoryIds[0]);
    assert.equal((await request(`/api/books/${bookIds[1]}`, 'PUT', { title: name, authors: 'Changed' }, token)).status, 200);
    existing = (await request(`/api/books/${bookIds[1]}`, 'GET', undefined, token)).data;
    assert.equal(existing.bookType, 'Fiction'); assert.equal(existing.categories[0].id, categoryIds[0]);
    assert.equal((await request('/api/categories', 'PUT', { id: categoryIds[0], name: `${name}-renamed` }, token)).status, 200);
    existing = (await request(`/api/books/${bookIds[1]}`, 'GET', undefined, token)).data;
    assert.equal(existing.categories[0].name, `${name}-renamed`);
    assert.equal((await request(`/api/books/${bookIds[1]}`, 'PUT', { title: name, bookType: null, categoryIds: [] }, token)).status, 200);
    existing = (await request(`/api/books/${bookIds[1]}`, 'GET', undefined, token)).data;
    assert.equal(existing.bookType, null); assert.equal(existing.categories.length, 0);
    for (const path of ['/classify', '/categories', `/books/${bookIds[0]}`, '/']) assert.equal((await request(path, 'GET', undefined, token)).status, 200, path);
  } finally {
    await db.book.deleteMany({ where: { id: { in: bookIds } } });
    await db.category.deleteMany({ where: { id: { in: categoryIds } } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
