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
