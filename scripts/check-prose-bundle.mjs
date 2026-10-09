import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const bundleDir = path.join(root, 'gm-plugkit', 'instructions');

const FALLBACK_GATE_AND_RESIDUAL_KEYS = [
  'gates/long-gap-no-instruction',
  'residual/prd-open', 'residual/tasks-running',
  'residual/dirty-tree', 'residual/imperative',
];

const coreSrcDir = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src');
const fsmVendorPath = path.join(coreSrcDir, 'orchestrator', 'fsm_vendor.rs');
const gatesRsPath = path.join(coreSrcDir, 'gates.rs');
const residualRsPath = path.join(coreSrcDir, 'orchestrator', 'residual.rs');

function readIfPresent(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function extractDefaultsTable(fsmVendorRs, tableName) {
  const re = new RegExp(`const ${tableName}:\\s*&\\[\\(&str,\\s*&str\\)\\]\\s*=\\s*&\\[([\\s\\S]*?)\\];`);
  const tableMatch = fsmVendorRs.match(re);
  if (!tableMatch) return null;
  const entries = [];
  const rowRe = /\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_:]*)\s*\)/g;
  let row;
  while ((row = rowRe.exec(tableMatch[1])) !== null) {
    entries.push({ key: row[1], constPath: row[2] });
  }
  return entries;
}

function extractConstText(sourceText, constName) {
  const re = new RegExp(`const ${constName}:\\s*&str\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*;`);
  const constMatch = sourceText.match(re);
  return constMatch ? constMatch[1] : null;
}

function placeholdersIn(text) {
  const found = new Set();
  const placeholderRe = /\{([a-z_]+)\}/g;
  let placeholderMatch;
  while ((placeholderMatch = placeholderRe.exec(text)) !== null) found.add(`{${placeholderMatch[1]}}`);
  return found;
}

function deriveKeySpecs() {
  const fsmVendorRs = readIfPresent(fsmVendorPath);
  const gatesRs = readIfPresent(gatesRsPath);
  const residualRs = readIfPresent(residualRsPath);
  if (!fsmVendorRs || !gatesRs || !residualRs) return null;

  const gateRows = extractDefaultsTable(fsmVendorRs, 'GATE_DEFAULTS');
  const residualRows = extractDefaultsTable(fsmVendorRs, 'RESIDUAL_DEFAULTS');
  if (!gateRows || !residualRows || gateRows.length === 0 || residualRows.length === 0) return null;

  const specs = [];
  for (const { key, constPath } of gateRows) {
    const constName = constPath.split('::').pop();
    const text = extractConstText(gatesRs, constName) ?? extractConstText(residualRs, constName);
    if (text === null) return null;
    specs.push({ key: `gates/${key}`, constName, placeholders: placeholdersIn(text) });
  }
  for (const { key, constPath } of residualRows) {
    const constName = constPath.split('::').pop();
    const text = extractConstText(residualRs, constName) ?? extractConstText(gatesRs, constName);
    if (text === null) return null;
    specs.push({ key: `residual/${key}`, constName, placeholders: placeholdersIn(text) });
  }
  return specs;
}

function findBundleGaps(keys) {
  const missing = [];
  const empty = [];
  for (const key of keys) {
    const fp = path.join(bundleDir, `${key}.md`);
    if (!fs.existsSync(fp)) { missing.push(key); continue; }
    if (fs.readFileSync(fp, 'utf8').trim() === '') empty.push(key);
  }
  return { missing, empty };
}

function reportBundleGaps(gaps, keyCount) {
  if (gaps.missing.length || gaps.empty.length) {
    if (gaps.missing.length) console.error(`prose bundle missing entries: ${gaps.missing.join(', ')}`);
    if (gaps.empty.length) console.error(`prose bundle empty entries: ${gaps.empty.join(', ')}`);
    return;
  }
  console.log(`prose bundle complete: ${keyCount} keys present and non-empty`);
}

function findPlaceholderParityFindings(specs) {
  const findings = [];
  for (const { key, constName, placeholders } of specs) {
    const fp = path.join(bundleDir, `${key}.md`);
    if (!fs.existsSync(fp)) continue;
    const mdPlaceholders = placeholdersIn(fs.readFileSync(fp, 'utf8'));
    for (const tok of placeholders) {
      if (!mdPlaceholders.has(tok)) {
        findings.push(`${key}.md is missing placeholder ${tok} carried by the canonical Rust const ${constName}; the substituted value would be silently dropped at render time`);
      }
    }
    for (const tok of mdPlaceholders) {
      if (!placeholders.has(tok)) {
        findings.push(`${key}.md carries placeholder ${tok} that the canonical Rust const ${constName} never substitutes; it would render literally`);
      }
    }
  }
  return findings;
}

function reportPlaceholderParity(findings, specs) {
  if (findings.length) {
    console.error('prose-placeholder-parity FAILED -- .md overrides drifted from the substituting Rust consts:');
    for (const finding of findings) console.error(`  - ${finding}`);
    return;
  }
  const withTokens = specs.filter((spec) => spec.placeholders.size > 0).length;
  console.log(`prose-placeholder-parity: ${specs.length} keys checked, ${withTokens} carrying placeholders, all matching their Rust consts`);
}

function resolveConformancePaths() {
  const proseSourceDir = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src', 'orchestrator', 'instructions', 'prose');
  return {
    execJsOptsProseMdPath: path.join(proseSourceDir, 'prove.md'),
    execJsRsPath: path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'exec_js.rs'),
  };
}

function checkEveryRequiredFileExists(requiredFiles) {
  return requiredFiles.filter((filePath) => !fs.existsSync(filePath));
}

function extractExecJsOptsFieldsFromProse(execJsOptsProseMd) {
  const optsFieldRe = /opts\.([a-zA-Z][a-zA-Z0-9]*)/g;
  const promisedOptsFields = new Set();
  let optsFieldMatch;
  while ((optsFieldMatch = optsFieldRe.exec(execJsOptsProseMd)) !== null) {
    const fieldName = optsFieldMatch[1];
    if (fieldName !== 'true' && fieldName !== 'false') promisedOptsFields.add(fieldName);
  }
  return promisedOptsFields;
}

function crossReferenceExecJsOptsFields(execJsOptsProseMd, execJsRs) {
  const promisedOptsFields = extractExecJsOptsFieldsFromProse(execJsOptsProseMd);
  const conformanceFindings = [];

  for (const field of promisedOptsFields) {
    if (!execJsRs.includes(`opts.get("${field}")`)) {
      conformanceFindings.push(`prove.md promises exec_js opts.${field} with no matching opts.get("${field}") in exec_js.rs`);
    }
  }
  return { conformanceFindings, promisedOptsFieldCount: promisedOptsFields.size };
}

function findConformance() {
  const paths = resolveConformancePaths();
  const requiredFiles = [paths.execJsOptsProseMdPath, paths.execJsRsPath];
  const missingFiles = checkEveryRequiredFileExists(requiredFiles);

  if (missingFiles.length > 0) {
    return { skipped: missingFiles.map((filePath) => path.relative(root, filePath)), findings: [], promisedOptsFieldCount: 0 };
  }

  const execJsOptsProseMd = fs.readFileSync(paths.execJsOptsProseMdPath, 'utf8');
  const execJsRs = fs.readFileSync(paths.execJsRsPath, 'utf8');
  const { conformanceFindings, promisedOptsFieldCount } = crossReferenceExecJsOptsFields(execJsOptsProseMd, execJsRs);
  return { skipped: [], findings: conformanceFindings, promisedOptsFieldCount };
}

function reportConformance(conformance) {
  if (conformance.skipped.length > 0) {
    console.log(`prose-conformance: skipping -- missing file(s) (submodules not populated, or a partial/shallow checkout): ${conformance.skipped.join(', ')}`);
    return;
  }
  if (conformance.findings.length) {
    console.error('prose-conformance FAILED -- prose promises capabilities with no confirmed implementing-code reference:');
    for (const finding of conformance.findings) console.error(`  - ${finding}`);
    return;
  }
  console.log(`prose-conformance: ${conformance.promisedOptsFieldCount} exec_js opts fields all have a matching implementing-code reference`);
}

const derivedSpecs = deriveKeySpecs();
const keys = derivedSpecs ? derivedSpecs.map((spec) => spec.key) : FALLBACK_GATE_AND_RESIDUAL_KEYS;

if (derivedSpecs) {
  const missingFromDerived = FALLBACK_GATE_AND_RESIDUAL_KEYS.filter((key) => !keys.includes(key));
  console.log(`prose bundle keys derived from fsm_vendor GATE_DEFAULTS + RESIDUAL_DEFAULTS: ${keys.length}`);
  if (missingFromDerived.length) {
    console.log(`note: previously-hardcoded keys no longer in the Rust tables: ${missingFromDerived.join(', ')}`);
  }
} else {
  console.log('prose bundle keys: falling back to the hardcoded list -- rs-plugkit sources unavailable (submodule not populated, or a partial/shallow checkout)');
}

const bundleGaps = findBundleGaps(keys);
reportBundleGaps(bundleGaps, keys.length);
const parityFindings = derivedSpecs ? findPlaceholderParityFindings(derivedSpecs) : [];
if (derivedSpecs) reportPlaceholderParity(parityFindings, derivedSpecs);
const conformance = findConformance();
reportConformance(conformance);

const bundleFailed = bundleGaps.missing.length > 0 || bundleGaps.empty.length > 0;
const placeholderFailed = parityFindings.length > 0;
const conformanceFailed = conformance.findings.length > 0;

if (bundleFailed || placeholderFailed || conformanceFailed) {
  process.exit(1);
}
