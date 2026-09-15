const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the component's async lifecycle without requiring a physical camera.
function compile(path, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => dependencies[name], ...globals });
  return exports;
}
const isbn = compile('src/lib/isbn.ts', {});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function harness({ pendingCamera = false, pendingDecoder = false } = {}) {
  let setup, tree, cursor = 0;
  const refs = [], states = [], callbacks = [], detected = [];
  const camera = deferred(), decoder = deferred();
  let stops = 0, controlStops = 0, requests = 0;
  const track = { stop: () => stops++, getCapabilities: () => ({}) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const controls = { stop: () => controlStops++ };
  const video = { srcObject: stream, videoWidth: 1280, videoHeight: 720 };
  const react = {
    useRef(value) { const i = cursor++; return refs[i] ??= { current: i === 0 ? video : value }; },
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], v => { states[i] = v; }]; },
    useEffect(fn) { setup = fn; },
  };
  class Reader {
    async decodeFromStream(_stream, _video, cb) {
      callbacks.push(cb);
      return pendingDecoder ? decoder.promise : controls;
    }
    async decodeFromImageUrl() { return { getText: () => '9780132350884' }; }
  }
  const Component = compile('src/components/IsbnScanner.tsx', {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/isbn': isbn,
    '@/lib/stop-scanner': compile('src/lib/stop-scanner.ts', {}),
    '@zxing/browser': { BrowserMultiFormatReader: Reader },
    '@zxing/library': { DecodeHintType: { POSSIBLE_FORMATS: 1, TRY_HARDER: 2 }, BarcodeFormat: { EAN_13: 7 } },
  }, {
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia: () => { requests++; return pendingCamera ? camera.promise : Promise.resolve(stream); } } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg,test' }) },
    DOMException,
  }).default;
  function render() { cursor = 0; tree = Component({ onDetected: value => detected.push(value), onClose() {} }); return tree; }
  render();
  return { start: () => setup(), render, callbacks, detected, camera, decoder, stream, controls,
    counts: () => ({ stops, controlStops, requests }) };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

test('Strict Mode replay accepts an ISBN exactly once and rejects other EANs', async () => {
  const h = harness();
  h.start()();
  const close = h.start();
  await tick();
  assert.equal(h.counts().requests, 1);
  h.callbacks[0]({ getText: () => '4006381333931' });
  assert.equal(h.detected.length, 0);
  h.callbacks[0]({ getText: () => '9780132350884' });
  h.callbacks[0]({ getText: () => '9780132350884' });
  assert.deepEqual(h.detected, ['9780132350884']);
  close();
});

test('closing during camera permission stops the late stream', async () => {
  const h = harness({ pendingCamera: true });
  const close = h.start();
  await tick();
  close();
  h.camera.resolve(h.stream);
  await tick();
  assert.equal(h.counts().stops, 1);
  assert.equal(h.callbacks.length, 0);
});

test('closing during decoder startup ignores results and stops late controls', async () => {
  const h = harness({ pendingDecoder: true });
  const close = h.start();
  await tick();
  close();
  h.callbacks[0]({ getText: () => '9780132350884' });
  h.decoder.resolve(h.controls);
  await tick();
  assert.equal(h.detected.length, 0);
  assert.equal(h.counts().controlStops, 1);
  assert.ok(h.counts().stops > 0);
});

test('Scan now waits for readiness and sends a captured ISBN to lookup callback', async () => {
  const h = harness();
  const button = tree => find(tree, node => node.type === 'button' && node.props.children === 'Scan now');
  assert.equal(button(h.render()).props.disabled, true);
  const close = h.start();
  await tick();
  const scan = button(h.render());
  assert.equal(scan.props.disabled, false);
  await scan.props.onClick();
  assert.deepEqual(h.detected, ['9780132350884']);
  close();
});
