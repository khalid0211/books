const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('concurrent lookups wait a second after success or failure, including hot reload', async () => {
  const timers = [];
  const context = vm.createContext({
    exports: {},
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  const code = ts.transpileModule(fs.readFileSync('src/lib/open-library-queue.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const load = () => {
    context.exports = {};
    vm.runInContext(`(function () { ${code}\n })()`, context);
    return context.exports.queueOpenLibrary;
  };
  const queue = load();
  const starts = [];
  let finishFirst;
  const first = queue(() => {
    starts.push('first');
    return new Promise(resolve => { finishFirst = resolve; });
  });
  const second = queue(async () => { starts.push('second'); throw new Error('offline'); });
  const rejected = assert.rejects(second, /offline/);
  const third = load()(async () => { starts.push('third'); return 'book'; });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await tick();
  assert.deepEqual(starts, ['first']);
  assert.equal(timers.length, 0);
  finishFirst('first book');
  assert.equal(await first, 'first book');
  await tick();
  assert.deepEqual(starts, ['first']);
  assert.equal(timers[0].delay, 1000);
  timers.shift().callback();
  await rejected;
  await tick();
  assert.deepEqual(starts, ['first', 'second']);
  assert.equal(timers[0].delay, 1000);
  timers.shift().callback();
  assert.equal(await third, 'book');
  assert.deepEqual(starts, ['first', 'second', 'third']);
});

test('cooldown applies to subsequent requests across hot reload without shortening an existing delay', async () => {
  const timers = [], starts = [];
  let now = 1000;
  const context = vm.createContext({ exports: {}, Date: { now: () => now }, setTimeout: (callback, delay) => timers.push({ callback, delay }) });
  const code = ts.transpileModule(fs.readFileSync('src/lib/open-library-queue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const load = () => { context.exports = {}; vm.runInContext(`(function () { ${code}\n })()`, context); return context.exports; };
  const first = load();
  first.deferOpenLibrary(30000);
  first.deferOpenLibrary(10000);
  const request = load().queueOpenLibrary(async () => { starts.push('request'); return 'ok'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, []);
  assert.equal(timers[0].delay, 30000);
  now += 30000;
  timers.shift().callback();
  assert.equal(await request, 'ok');
  assert.deepEqual(starts, ['request']);
  assert.equal(timers[0].delay, 1000);
});
