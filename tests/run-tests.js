// Automated test runner for SupaMsg
// Run: node tests/run-tests.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: 'PASS' });
  } catch (e) {
    failed++;
    results.push({ name, status: 'FAIL', error: e.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ── File Structure Tests ──
test('index.html exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'desktop', 'index.html')));
});

test('main.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'desktop', 'main.js')));
});

test('preload.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'desktop', 'preload.js')));
});

test('preload-whatsapp.js exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'desktop', 'preload-whatsapp.js')));
});

test('onboarding.html exists', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'desktop', 'onboarding.html')));
});

// ── Feature Module Tests ──
const featuresDir = path.join(__dirname, '..', 'desktop', 'features');
const features = fs.readdirSync(featuresDir).filter(f => f.endsWith('.js'));

test(`Feature modules exist (${features.length})`, () => {
  assert(features.length >= 40, `Expected 40+ features, got ${features.length}`);
});

features.forEach(f => {
  test(`Feature ${f} has valid syntax`, () => {
    const code = fs.readFileSync(path.join(featuresDir, f), 'utf8');
    vm.createScript(code, { filename: f });
  });
});

// ── index.html Tests ──
test('index.html has nav-panel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  assert(html.includes('nav-panel') || html.includes('account-strip'), 'Missing nav panel');
});

test('index.html has escapeHtml function', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  assert(html.includes('escapeHtml'), 'Missing escapeHtml');
});

test('index.html has account rendering', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  assert(html.includes('renderAccounts') || html.includes('onLoadAccounts'), 'Missing account rendering');
});

test('index.html has no duplicate IDs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(dupes.length === 0, `Duplicate IDs: ${[...new Set(dupes)].join(', ')}`);
});

// ── Preload Tests ──
test('preload.js exposes hub object', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  assert(code.includes("exposeInMainWorld('hub'"), 'Missing hub exposure');
});

test('preload.js has switchAccount', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  assert(code.includes('switchAccount'), 'Missing switchAccount');
});

test('preload.js has addAccount', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  assert(code.includes('addAccount'), 'Missing addAccount');
});

// ── Panel Tests ──
const panelsDir = path.join(__dirname, '..', 'desktop', 'panels');
if (fs.existsSync(panelsDir)) {
  const panels = fs.readdirSync(panelsDir).filter(f => f.endsWith('.html'));
  test(`Panel files exist (${panels.length})`, () => {
    assert(panels.length >= 2, `Expected 2+ panels, got ${panels.length}`);
  });

  panels.forEach(p => {
    test(`Panel ${p} has valid HTML`, () => {
      const html = fs.readFileSync(path.join(panelsDir, p), 'utf8');
      assert(html.includes('<!DOCTYPE html>') || html.includes('<html'), 'Not valid HTML');
      assert(html.includes('panel-header') || html.includes('panel-title') || html.includes('<h'), 'Missing panel header');
      assert(html.includes('close') || html.includes('Cancel') || html.includes('back'), 'Missing close mechanism');
    });
  });
}

// ── Design Consistency Tests ──
test('index.html uses approved design tokens', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  // Check for approved colors
  assert(html.includes('#FAFAFA') || html.includes('#fafafa') || html.includes('#F0F2F5'), 'Missing approved nav color');
  assert(html.includes('#111B21') || html.includes('#667781'), 'Missing approved text colors');
});

// ── Main Process Tests ──
test('main.js has BrowserWindow creation', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  assert(code.includes('BrowserWindow'), 'Missing BrowserWindow');
});

test('main.js has IPC handlers', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  assert(code.includes('ipcMain') || code.includes('ipc.'), 'Missing IPC handlers');
});

test('main.js loads WhatsApp Web URL', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  assert(code.includes('web.whatsapp.com'), 'Missing WhatsApp Web URL');
});

// ── Package.json Tests ──
test('package.json exists and is valid JSON', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  assert(pkg.name, 'Missing package name');
  assert(pkg.main, 'Missing main entry');
});

test('package.json has electron dependency', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert(allDeps['electron'], 'Missing electron dependency');
});

// ── Android Tests ──
const androidDir = path.join(__dirname, '..', 'android');
if (fs.existsSync(androidDir)) {
  test('Android project exists', () => {
    assert(fs.existsSync(path.join(androidDir, 'app', 'build.gradle.kts')));
  });
  test('Android MainActivity exists', () => {
    assert(fs.existsSync(path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'supamsg', 'app', 'MainActivity.kt')));
  });
  test('Android AccountManager exists', () => {
    assert(fs.existsSync(path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'supamsg', 'app', 'AccountManager.kt')));
  });
}

// ── iOS Tests ──
const iosDir = path.join(__dirname, '..', 'ios');
if (fs.existsSync(iosDir)) {
  test('iOS project exists', () => {
    assert(fs.existsSync(path.join(iosDir, 'SupaMsg')));
  });
  test('iOS SupaMsgApp.swift exists', () => {
    assert(fs.existsSync(path.join(iosDir, 'SupaMsg', 'SupaMsgApp.swift')));
  });
  test('iOS Views directory exists', () => {
    assert(fs.existsSync(path.join(iosDir, 'SupaMsg', 'Views')));
  });
  test('iOS Models directory exists', () => {
    assert(fs.existsSync(path.join(iosDir, 'SupaMsg', 'Models')));
  });
  test('iOS Services directory exists', () => {
    assert(fs.existsSync(path.join(iosDir, 'SupaMsg', 'Services')));
  });
}

// ── Cross-file Consistency Tests ──
test('All feature modules use module.exports or exports', () => {
  const failures = [];
  features.forEach(f => {
    const code = fs.readFileSync(path.join(featuresDir, f), 'utf8');
    if (!code.includes('module.exports') && !code.includes('exports.') && !code.includes('export ')) {
      failures.push(f);
    }
  });
  assert(failures.length === 0, `Features without exports: ${failures.join(', ')}`);
});

test('No hardcoded localhost URLs in features', () => {
  const failures = [];
  features.forEach(f => {
    const code = fs.readFileSync(path.join(featuresDir, f), 'utf8');
    if (code.includes('http://localhost') && !f.includes('mobile-relay') && !f.includes('webhook')) {
      failures.push(f);
    }
  });
  assert(failures.length === 0, `Features with hardcoded localhost: ${failures.join(', ')}`);
});

// ── Results ──
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  SupaMsg Test Results');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

results.forEach(r => {
  const icon = r.status === 'PASS' ? '\u2713' : '\u2717';
  const color = r.status === 'PASS' ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}  ${icon} ${r.name}\x1b[0m${r.error ? ` \u2014 ${r.error}` : ''}`);
});

console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
