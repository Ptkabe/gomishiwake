'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createElement() {
  return {
    hidden: false,
    innerHTML: '',
    value: '',
    dataset: {},
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
    focus() {},
    blur() {},
  };
}

function bootstrapApp(options = {}) {
  const { loadFuse } = options;
  const elements = new Map();
  const ids = [
    'search-input',
    'clear-button',
    'suggestions',
    'initial-view',
    'search-result',
    'quick-buttons',
    'legend-list',
  ];

  ids.forEach((id) => elements.set(id, createElement()));

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    addEventListener() {},
  };

  const windowObject = {
    document,
    location: { hash: '' },
    history: { length: 1, back() {} },
    addEventListener() {},
    scrollTo() {},
    console: { log() {}, warn() {} },
  };

  windowObject.window = windowObject;
  windowObject.self = windowObject;
  windowObject.globalThis = windowObject;

  const sandbox = {
    window: windowObject,
    document,
    location: windowObject.location,
    history: windowObject.history,
    console: windowObject.console,
    self: windowObject,
    globalThis: windowObject,
  };

  vm.createContext(sandbox);

  if (loadFuse) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'js/vendor/fuse.min.js'), 'utf8'),
      sandbox,
      { filename: 'js/vendor/fuse.min.js' }
    );
  }

  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'js/classification.js'), 'utf8'),
    sandbox,
    { filename: 'js/classification.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'),
    sandbox,
    { filename: 'js/data.js' }
  );

  let appSource = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  appSource = appSource.replace(
    /\}\)\(\);\s*$/,
    'window.__testHooks = { search, fuseLoaded: !!fuse };})();'
  );

  vm.runInContext(appSource, sandbox, { filename: 'js/app.js' });

  return sandbox.window.__testHooks;
}

function names(result) {
  return result.map((item) => item.n);
}

function run() {
  const withFuse = bootstrapApp({ loadFuse: true });
  const withoutFuse = bootstrapApp({ loadFuse: false });

  assert.equal(withFuse.fuseLoaded, true, 'Fuse.js should load in the bundled path');
  assert.equal(withoutFuse.fuseLoaded, false, 'App should keep working without Fuse.js');

  assert.equal(
    withFuse.search('でんち')[0].n,
    '乾電池',
    'Short hiragana queries should prioritize the intended item'
  );
  assert.equal(
    withoutFuse.search('でんち')[0].n,
    '乾電池',
    'Offline fallback should preserve the battery ranking fix'
  );
  assert.equal(
    withFuse.search('ペットボトル')[0].n,
    'ペットボトル',
    'Exact item matches should stay first'
  );

  const fallbackSmartphoneResults = names(withoutFuse.search('スマホ').slice(0, 5));
  assert(
    fallbackSmartphoneResults.includes('スマートフォン'),
    'Offline fallback should still return smartphone-related items'
  );

  console.log('search smoke tests passed');
}

run();
