const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const { parseBookId } = load('src/lib/book-id.ts');
test('camera cleanup handles a rejected torch reset and stops only once', async () => {
  const { stopScanner } = load('src/lib/stop-scanner.ts');
  let releases = 0;
  const controls = { stop: async () => { releases++; throw new Error('setPhotoOptions failed'); } };
  stopScanner(controls);
  stopScanner(controls);
  stopScanner(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases, 1);
  assert.doesNotThrow(() => stopScanner({ stop() { throw new Error('Camera already closed'); } }));
  let nextCamera = 0;
  stopScanner({ stop() { nextCamera++; } });
  assert.equal(nextCamera, 1);
});
test('collection IDs accept manual numbers and reject ISBNs and malformed IDs', () => {
  for (const value of ['B000123', 'b000123', '123', ' B000123 ']) assert.equal(parseBookId(value), 123);
  for (const value of ['', 'B000000', '9780140328721', '-1', '1.5', '1e2', 'B12abc', null, 123]) assert.equal(parseBookId(value), null);
});
test('move endpoint checks permission and shelf, and changes only location', async () => {
  let denied = false;
  let update;
  const existing = { id: 123, title: 'Test book', shelfLocation: 'ST-C01-S01' };
  const db = {
    room: { findMany: async () => [{ id: 1, name: 'Study', code: 'ST', cabinets: [{ id: 1, number: 1, shelves: [{ id: 2, number: 2 }] }] }] },
    book: { findUnique: async ({ where }) => where.id === 123 ? existing : null, update: async (args) => { update = args; return { ...existing, ...args.data }; } },
  };
  const { POST } = load('src/app/api/books/move/route.ts', {
    '@/lib/auth': { WRITE: ['OWNER', 'LIBRARIAN'], authorize: async () => denied ? Response.json({}, { status: 403 }) : null },
    '@/lib/prisma': { prisma: { $transaction: async (fn) => fn(db) } },
    '@/lib/book-id': { parseBookId },
    '@/lib/locations': load('src/lib/locations.ts'),
  });
  const request = (bookId, shelfLocation = 'ST-C01-S02') => POST(new Request('http://localhost/api/books/move', { method: 'POST', body: JSON.stringify({ bookId, shelfLocation }) }));
  denied = true; assert.equal((await request('B000123')).status, 403); assert.equal(update, undefined);
  denied = false;
  assert.equal((await request('9780140328721')).status, 400);
  assert.equal((await request('B000123', 'MISSING')).status, 400);
  assert.equal((await request('B000999')).status, 404);
  assert.equal(update, undefined);
  const response = await request('B000123');
  assert.equal(response.status, 200);
  assert.deepEqual(update, { where: { id: 123 }, data: { shelfLocation: 'ST-C01-S02' } });
  assert.equal((await response.json()).previousLocation, 'ST-C01-S01');
  existing.shelfLocation = 'ST-C01-S02'; update = undefined;
  assert.equal((await (await request('123')).json()).unchanged, true);
  assert.equal(update, undefined);
});
test('label QR code round-trips the permanent book ID', () => {
  const { QRCodeWriter, BarcodeFormat, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader } = require('@zxing/library');
  const matrix = new QRCodeWriter().encode('B000123', BarcodeFormat.QR_CODE, 190, 190, new Map());
  const pixels = new Uint8ClampedArray(190 * 190);
  for (let y = 0; y < 190; y++) for (let x = 0; x < 190; x++) pixels[y * 190 + x] = matrix.get(x, y) ? 0 : 255;
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, 190, 190)));
  assert.equal(new QRCodeReader().decode(bitmap).getText(), 'B000123');
});

test('Code 128 labels fit two inches and decode at 300 and 203 dpi', () => {
  const JsBarcode = require('jsbarcode');
  const { BarcodeFormat, DecodeHintType, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, MultiFormatReader } = require('@zxing/library');
  for (const id of ['B000016', 'B000123', 'B2147483647']) {
    const target = {};
    JsBarcode(target, id, { format: 'CODE128', displayValue: false });
    const bars = target.encodings.map(encoding => encoding.data).join('');
    const moduleWidth = Math.floor(552 / (bars.length + 20));
    assert.ok(moduleWidth >= 2, 'Narrow bars retain printable width');
    const width = (bars.length + 20) * moduleWidth;
    assert.ok(width <= 552);
    const left = Math.floor((600 - width) / 2) + 10 * moduleWidth;
    for (const dpi of [300, 203]) {
      const w = dpi * 2, h = dpi;
      const pixels = new Uint8ClampedArray(w * h).fill(255);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sourceX = x * 300 / dpi, sourceY = y * 300 / dpi;
        if (sourceY >= 164 && sourceY < 274 && sourceX >= left && sourceX < left + bars.length * moduleWidth && bars[Math.floor((sourceX - left) / moduleWidth)] === '1') pixels[y * w + x] = 0;
      }
      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true]]);
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, w, h)));
      assert.equal(new MultiFormatReader().decode(bitmap, hints).getText(), id);
    }
  }
});
