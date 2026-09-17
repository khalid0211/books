const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: dependencies, fetch: dependencies('fetch') });
  return exports;
}

for (const success of [true, false]) {
  test(`edit save ${success ? 'returns to the catalog' : 'stays on the form after a server error'}`, async () => {
    const state = [];
    const transitions = [];
    const navigation = [];
    const books = load('src/lib/books.ts', () => undefined);
    const Form = load('src/components/BookForm.tsx', (name) => {
      if (name === 'react') return {
        useState(initial) {
          const index = state.length;
          state.push(typeof initial === 'function' ? initial() : initial);
          return [state[index], value => { transitions.push({ index, value }); state[index] = value; }];
        },
        useMemo: fn => fn(), useRef: value => ({ current: value }), useEffect() {},
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'next/navigation') return { useRouter: () => ({ push(path) { navigation.push(path); }, refresh() {} }) };
      if (name === '@/lib/books') return books;
      if (name === '@/lib/isbn') return { cleanIsbn: x => x, isValidIsbn: () => false };
      if (name === '@/lib/locations') return {};
      if (name === 'fetch') return async () => ({ ok: success, status: 500, json: async () => success ? {} : { error: 'Save failed' } });
      return { default: () => null };
    }).default;
    const tree = Form({ initial: { ...books.emptyBookInput(), id: 16, title: 'Example' } });
    function findForm(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'form') return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = findForm(child);
        if (found) return found;
      }
    }
    await findForm(tree).props.onSubmit({ preventDefault() {} });
    const saving = transitions.find((change) => change.value === true);
    assert.ok(saving, 'Submitting should set saving state');
    assert.equal(state[saving.index], false, 'Saving state must reset even when navigation keeps the form mounted');
    assert.ok(state.includes(success ? 'Changes saved.' : 'Save failed'));
    assert.deepEqual(navigation, success ? ['/'] : []);
  });
}
