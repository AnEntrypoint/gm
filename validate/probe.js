#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const OC_HOOK_DIR = 'C:/Users/user/AppData/Roaming/opencode/hooks';
const GC_HOOK_DIR = 'C:/Users/user/.gemini/extensions/gm/hooks';
const KILO_HOOK_DIR = 'C:/Users/user/.kilocode/hooks';

const OC_PLUGIN_ROOT = 'C:/Users/user/AppData/Roaming/opencode';

const scenarios = [
  {
    id: 'forbidden-glob',
    label: 'Forbidden tool (Glob) blocked',
    input: { tool_name: 'Glob', tool_input: { pattern: '**/*.js' } },
    assert: r => r.decision === 'block' || r.decision === 'deny',
  },
  {
    id: 'forbidden-grep',
    label: 'Forbidden tool (Grep) blocked',
    input: { tool_name: 'Grep', tool_input: { pattern: 'foo' } },
    assert: r => r.decision === 'block' || r.decision === 'deny',
  },
  {
    id: 'write-md-blocked',
    label: 'Writing .md doc file blocked',
    input: { tool_name: 'Write', tool_input: { file_path: '/foo/bar/notes.md' } },
    assert: r => r.decision === 'block' || r.decision === 'deny',
  },
  {
    id: 'write-test-blocked',
    label: 'Writing .test.js file blocked',
    input: { tool_name: 'Write', tool_input: { file_path: '/foo/bar/foo.test.js' } },
    assert: r => r.decision === 'block' || r.decision === 'deny',
  },
  {
    id: 'write-readme-allowed',
    label: 'Writing README.md allowed',
    input: { tool_name: 'Write', tool_input: { file_path: '/foo/bar/README.md' } },
    assert: r => !r.decision || r.decision === 'allow' || r.decision === 'continue',
  },
  {
    id: 'write-claude-md-allowed',
    label: 'Writing CLAUDE.md allowed',
    input: { tool_name: 'Write', tool_input: { file_path: '/foo/bar/CLAUDE.md' } },
    assert: r => !r.decision || r.decision === 'allow' || r.decision === 'continue',
  },
];

const gcScenarios = [
  ...scenarios.map(s => ({
    ...s,
    input: s.input.tool_name === 'Write' ? { ...s.input, tool_name: 'write_file' } : s.input,
  })),
  {
    id: 'gc-exec-dispatch',
    label: 'GC exec:nodejs dispatch returns output',
    input: { tool_name: 'run_shell_command', tool_input: { command: 'exec:nodejs\nconsole.log("probe-ok")' } },
    assert: r => r.decision === 'deny' && r.reason && r.reason.includes('probe-ok'),
  },
  {
    id: 'gc-non-exec-blocked',
    label: 'GC non-exec shell command blocked',
    input: { tool_name: 'run_shell_command', tool_input: { command: 'ls -la' } },
    assert: r => r.decision === 'deny',
  },
];

function runHook(hookFile, input, env = {}) {
  const result = spawnSync('node', [hookFile], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 15000,
    env: { ...process.env, ...env },
  });
  const stdout = (result.stdout || '').trim();
  if (!stdout) return null;
  try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
}

function runPlatform(name, hookFile, scenarios, env = {}) {
  console.log('\n=== ' + name + ' ===');
  let passed = 0, failed = 0;
  for (const s of scenarios) {
    const r = runHook(hookFile, s.input, env);
    const ok = r !== null ? s.assert(r) : s.assert({});
    const status = ok ? 'PASS' : 'FAIL';
    if (ok) passed++; else failed++;
    const detail = r ? JSON.stringify(r).substring(0, 120) : 'null';
    console.log('  [' + status + '] ' + s.id + ': ' + s.label);
    if (!ok) console.log('         got: ' + detail);
  }
  console.log('  Result: ' + passed + '/' + (passed + failed) + ' passed');
  return { passed, failed };
}

const ocHook = path.join(OC_HOOK_DIR, 'pre-tool-use-hook.js');
const gcHook = path.join(GC_HOOK_DIR, 'pre-tool-use-hook.js');

const totals = { passed: 0, failed: 0 };

const ocResult = runPlatform('OpenCode', ocHook, scenarios, { OC_PLUGIN_ROOT });
const gcResult = runPlatform('Gemini CLI', gcHook, gcScenarios, { GEMINI_PROJECT_DIR: 'C:/dev/plugforge' });

const kiloHook = path.join(KILO_HOOK_DIR, 'pre-tool-use-hook.js');
if (require('fs').existsSync(kiloHook)) {
  const kiloResult = runPlatform('Kilo Code', kiloHook, scenarios, { OC_PLUGIN_ROOT });
  totals.passed += kiloResult.passed;
  totals.failed += kiloResult.failed;
} else {
  console.log('\n=== Kilo Code ===');
  console.log('  SKIP: no pre-tool-use-hook.js (Kilo uses .mjs SDK only for pre-tool)');
}

totals.passed += ocResult.passed + gcResult.passed;
totals.failed += ocResult.failed + gcResult.failed;

console.log('\n=== TOTAL: ' + totals.passed + '/' + (totals.passed + totals.failed) + ' passed ===');
process.exit(totals.failed > 0 ? 1 : 0);
