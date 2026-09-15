const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/locations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });

test('codes distinguish rooms and cabinets and pad shelf numbers', () => {
  assert.equal(exportsObject.locationCode('ST', 2, 3), 'ST-C02-S03');
  assert.equal(exportsObject.locationCode('BR', 12, 105), 'BR-C12-S105');
  const locations = exportsObject.flattenLocations([
    { id: 1, name: 'Study', code: 'ST', cabinets: [
      { id: 2, number: 2, shelves: [{ id: 3, number: 3 }] },
      { id: 4, number: 3, shelves: [] },
    ] },
  ]);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].code, 'ST-C02-S03');
  assert.equal(locations[0].label, 'Study · Cabinet 2 · Shelf 3');
});
