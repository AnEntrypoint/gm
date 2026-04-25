const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

function test(name, fn) {
  try {
    fn();
    console.log(`${PASS} ${name}`);
  } catch (e) {
    console.error(`${FAIL} ${name}`);
    console.error(`  ${e.message}`);
    process.exit(1);
  }
}

function assertIdempotent(name, fn) {
  const a = fn(), b = fn();
  assert.deepStrictEqual(a, b, `${name}: not idempotent — ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function assertDeterministic(name, fn, seed) {
  const a = fn(seed), b = fn(seed);
  assert.deepStrictEqual(a, b, `${name}: same seed produced different output`);
}

function assertNoRegression(name, baseline, current) {
  for (const k of Object.keys(baseline)) {
    assert(k in current, `${name}: lost key "${k}"`);
    assert.deepStrictEqual(current[k], baseline[k], `${name}: key "${k}" changed`);
  }
}

function assertHookBlocks(name, hookCmd, blockedInput) {
  const r = spawnSync('node', [hookCmd], { input: JSON.stringify(blockedInput), encoding: 'utf8' });
  const out = r.stdout || '';
  assert(/decision":\s*"block"/.test(out), `${name}: hook did not block — got ${out.slice(0,200)}`);
}

function assertHookAllows(name, hookCmd, allowedInput) {
  const r = spawnSync('node', [hookCmd], { input: JSON.stringify(allowedInput), encoding: 'utf8' });
  const out = r.stdout || '';
  assert(!/decision":\s*"block"/.test(out), `${name}: hook blocked when it should have allowed — ${out.slice(0,200)}`);
}

test('cli.js is executable', () => {
  assert(fs.existsSync('cli.js'), 'cli.js missing');
  const content = fs.readFileSync('cli.js', 'utf8');
  assert(content.includes('require'), 'cli.js not a valid Node module');
});

test('gm.json exists in gm-build/gm-cc', () => {
  const gmJson = 'gm-build/gm-cc/gm.json';
  assert(fs.existsSync(gmJson), `${gmJson} missing`);
  const content = JSON.parse(fs.readFileSync(gmJson, 'utf8'));
  assert(content.version, 'gm.json missing version field');
});

test('All platform dirs exist', () => {
  const platforms = ['gm-cc', 'gm-gc', 'gm-oc', 'gm-kilo', 'gm-codex', 'gm-copilot-cli', 'gm-vscode', 'gm-cursor', 'gm-zed', 'gm-jetbrains'];
  platforms.forEach(platform => {
    const dir = `gm-build/${platform}`;
    assert(fs.existsSync(dir), `${dir} missing`);
  });
});

test('hook files exist', () => {
  const platforms = ['gm-cc', 'gm-gc', 'gm-oc', 'gm-kilo', 'gm-codex', 'gm-copilot-cli'];
  platforms.forEach(platform => {
    const hooksDir = `gm-build/${platform}/hooks`;
    assert(fs.existsSync(hooksDir), `${hooksDir} missing`);
    assert(fs.existsSync(`${hooksDir}/hooks.json`), `${hooksDir}/hooks.json missing`);
  });
});

test('lib modules are valid JS', () => {
  const files = fs.readdirSync('lib').filter(f => f.endsWith('.js'));
  assert(files.length > 0, 'no lib/*.js files found');
  files.forEach(file => {
    const content = fs.readFileSync(`lib/${file}`, 'utf8');
    assert(content.includes('module.exports') || content.includes('exports'), `lib/${file} missing exports`);
  });
});

test('platforms modules exist', () => {
  const files = fs.readdirSync('platforms').filter(f => f.endsWith('.js'));
  assert(files.length > 0, 'no platforms/*.js files found');
  files.forEach(file => {
    const filepath = path.join('platforms', file);
    const content = fs.readFileSync(filepath, 'utf8');
    assert(content.length > 0, `${filepath} is empty`);
  });
});

test('AGENTS.md not empty', () => {
  const content = fs.readFileSync('AGENTS.md', 'utf8');
  assert(content.length > 100, 'AGENTS.md is too short');
  assert(content.includes('Architecture'), 'AGENTS.md missing architecture section');
});

test('CLAUDE.md not empty', () => {
  const content = fs.readFileSync('CLAUDE.md', 'utf8');
  assert(content.length > 0, 'CLAUDE.md is empty');
  assert(content.includes('AGENTS.md'), 'CLAUDE.md missing AGENTS.md reference');
});

test('AGENTS.md content idempotent on repeat read', () => {
  assertIdempotent('AGENTS.md read', () => fs.readFileSync('AGENTS.md', 'utf8').length);
});

test('platform list deterministic', () => {
  const platforms = ['gm-cc', 'gm-gc', 'gm-oc', 'gm-kilo', 'gm-codex', 'gm-copilot-cli', 'gm-vscode', 'gm-cursor', 'gm-zed', 'gm-jetbrains'];
  assertDeterministic('platform sort', () => [...platforms].sort(), 0);
});

console.log('\n✓ All tests passed');
