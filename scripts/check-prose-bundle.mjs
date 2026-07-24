import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const bundleDir = path.join(root, 'gm-plugkit', 'instructions');

const GATE_AND_RESIDUAL_KEYS = [
  'gates/long-gap-no-instruction',
  'residual/prd-open', 'residual/browser-open', 'residual/tasks-running',
  'residual/dirty-tree', 'residual/imperative',
];

function validateBundleCompleteness() {
  const missing = [];
  const empty = [];
  for (const key of GATE_AND_RESIDUAL_KEYS) {
    const fp = path.join(bundleDir, `${key}.md`);
    if (!fs.existsSync(fp)) { missing.push(key); continue; }
    if (fs.readFileSync(fp, 'utf8').trim() === '') empty.push(key);
  }
  if (missing.length || empty.length) {
    if (missing.length) console.error(`prose bundle missing entries: ${missing.join(', ')}`);
    if (empty.length) console.error(`prose bundle empty entries: ${empty.join(', ')}`);
    return false;
  }
  console.log(`prose bundle complete: ${GATE_AND_RESIDUAL_KEYS.length} keys present and non-empty`);
  return true;
}

function resolveConformancePaths() {
  const proseSourceDir = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src', 'orchestrator', 'instructions', 'prose');
  return {
    proseSourceDir,
    browserMdPath: path.join(proseSourceDir, 'browser.md'),
    executeMdPath: path.join(proseSourceDir, 'execute.md'),
    browserRsPath: path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'browser.rs'),
    cdpEvalJsPath: path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'cdp_eval.js'),
    execJsRsPath: path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'exec_js.rs'),
  };
}

function checkEveryRequiredFileExists(requiredFiles) {
  return requiredFiles.filter((p) => !fs.existsSync(p));
}

function extractBrowserModePrefixesFromProse(browserMd) {
  const bodyShapesMatch = browserMd.match(/## Body shapes[\s\S]*?```\r?\n([\s\S]*?)```/);
  const promisedPrefixes = [];
  if (!bodyShapesMatch) return promisedPrefixes;

  for (const line of bodyShapesMatch[1].split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;

    const sessionMatch = t.match(/^session (\w+)/);
    if (sessionMatch) { promisedPrefixes.push({ kind: 'session', name: sessionMatch[1] }); continue; }

    const modeMatch = t.match(/^(\w+)(?:\s+\w+=<[^>]+>)*\\n/);
    if (modeMatch && !['url', 'timeout', 'dom'].includes(modeMatch[1])) { promisedPrefixes.push({ kind: 'mode', name: modeMatch[1] }); continue; }

    const kvMatch = t.match(/^(\w+)=</);
    if (kvMatch) { promisedPrefixes.push({ kind: 'kv', name: kvMatch[1] }); continue; }
  }
  return promisedPrefixes;
}

function checkPrefixInImplementingCode(kind, name, browserRs, cdpEvalJs) {
  if (kind === 'session') return browserRs.includes(`"session ${name}`);
  if (kind === 'kv') return browserRs.includes(`"${name}="`) || cdpEvalJs.includes(`${name}=`);
  return browserRs.includes(`"${name}\\n"`) || browserRs.includes(`"${name}"`) || cdpEvalJs.includes(`'${name}'`) || cdpEvalJs.includes(`"${name}"`);
}

function crossReferenceBrowserPrefixes(browserMd, browserRs, cdpEvalJs) {
  const promisedPrefixes = extractBrowserModePrefixesFromProse(browserMd);
  const conformanceFindings = [];

  for (const { kind, name } of promisedPrefixes) {
    if (!checkPrefixInImplementingCode(kind, name, browserRs, cdpEvalJs)) {
      conformanceFindings.push(`browser.md promises ${kind} prefix "${name}" with zero implementing-code reference in browser.rs or cdp_eval.js`);
    }
  }
  return { conformanceFindings, promisedPrefixCount: promisedPrefixes.length };
}

function extractExecJsOptsFieldsFromProse(executeMd) {
  const optsFieldRe = /opts\.([a-zA-Z][a-zA-Z0-9]*)/g;
  const promisedOptsFields = new Set();
  let m;
  while ((m = optsFieldRe.exec(executeMd)) !== null) {
    if (m[1] !== 'true' && m[1] !== 'false') promisedOptsFields.add(m[1]);
  }
  return promisedOptsFields;
}

function crossReferenceExecJsOptsFields(executeMd, execJsRs) {
  const promisedOptsFields = extractExecJsOptsFieldsFromProse(executeMd);
  const conformanceFindings = [];

  for (const field of promisedOptsFields) {
    if (!execJsRs.includes(`opts.get("${field}")`)) {
      conformanceFindings.push(`execute.md promises exec_js opts.${field} with no matching opts.get("${field}") in exec_js.rs`);
    }
  }
  return { conformanceFindings, promisedOptsFieldCount: promisedOptsFields.size };
}

function runConformanceCheck() {
  const paths = resolveConformancePaths();
  const requiredFiles = [paths.browserMdPath, paths.executeMdPath, paths.browserRsPath, paths.cdpEvalJsPath, paths.execJsRsPath];
  const missingFiles = checkEveryRequiredFileExists(requiredFiles);

  if (missingFiles.length > 0) {
    console.log(`prose-conformance: skipping -- missing file(s) (submodules not populated, or a partial/shallow checkout): ${missingFiles.map((p) => path.relative(root, p)).join(', ')}`);
    return false;
  }

  const browserMd = fs.readFileSync(paths.browserMdPath, 'utf8');
  const browserRs = fs.readFileSync(paths.browserRsPath, 'utf8');
  const cdpEvalJs = fs.readFileSync(paths.cdpEvalJsPath, 'utf8');
  const executeMd = fs.readFileSync(paths.executeMdPath, 'utf8');
  const execJsRs = fs.readFileSync(paths.execJsRsPath, 'utf8');

  const browserResult = crossReferenceBrowserPrefixes(browserMd, browserRs, cdpEvalJs);
  const execJsResult = crossReferenceExecJsOptsFields(executeMd, execJsRs);
  const allFindings = [...browserResult.conformanceFindings, ...execJsResult.conformanceFindings];

  if (allFindings.length) {
    console.error('prose-conformance FAILED -- prose promises capabilities with no confirmed implementing-code reference:');
    for (const f of allFindings) console.error(`  - ${f}`);
    return true;
  }

  console.log(`prose-conformance: ${browserResult.promisedPrefixCount} browser mode-prefixes + ${execJsResult.promisedOptsFieldCount} exec_js opts fields all have a matching implementing-code reference`);
  return false;
}

const bundleFailed = !validateBundleCompleteness();
const conformanceFailed = runConformanceCheck();

if (bundleFailed || conformanceFailed) {
  process.exit(1);
}