import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const bundleDir = path.join(root, 'gm-plugkit', 'instructions');

const KEYS = [
  'gates/long-gap-no-instruction',
  'residual/prd-open', 'residual/browser-open', 'residual/tasks-running',
  'residual/dirty-tree', 'residual/imperative',
];

const missing = [];
const empty = [];
for (const key of KEYS) {
  const fp = path.join(bundleDir, `${key}.md`);
  if (!fs.existsSync(fp)) { missing.push(key); continue; }
  if (fs.readFileSync(fp, 'utf8').trim() === '') empty.push(key);
}

let bundleFailed = false;
if (missing.length || empty.length) {
  bundleFailed = true;
  if (missing.length) console.error(`prose bundle missing entries: ${missing.join(', ')}`);
  if (empty.length) console.error(`prose bundle empty entries: ${empty.join(', ')}`);
} else {
  console.log(`prose bundle complete: ${KEYS.length} keys present and non-empty`);
}

// Real conformance run: extract every `browser` verb mode-prefix and
// exec_js `opts.*` field the served prose promises, and check that the
// implementing native source (agentplug-host, the sole loader per this
// repo's own architecture) actually references it. Static, not a live
// dispatch -- this is a "did anyone even write the code" check, not a
// behavioral one, but that is exactly what catches a "documented, zero
// implementing code" gap: this check is what found the browser.md
// screenshot/dom= gap live (agentplug-host/src/browser.rs had zero
// BrowserMode variant for either, confirmed by grep before this script
// was written). Runs against the checked-out submodules, so it only fires
// in CI/local contexts where they're actually populated (a plain `git
// clone` without --recurse-submodules leaves them empty per README.md's
// own documented note -- absence there is skipped, not failed, matching
// this repo's existing plain-clone tolerance).
const proseSourceDir = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src', 'orchestrator', 'instructions', 'prose');
const browserMdPath = path.join(proseSourceDir, 'browser.md');
const executeMdPath = path.join(proseSourceDir, 'execute.md');
const browserRsPath = path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'browser.rs');
const cdpEvalJsPath = path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'cdp_eval.js');
const execJsRsPath = path.join(root, 'agentplug', 'crates', 'agentplug-host', 'src', 'exec_js.rs');

// Every INDIVIDUAL file this check reads, not just the containing
// directories -- a submodule can be present but shallow/partial (a
// degenerate state distinct from "not cloned at all"), and the directory-
// only check previously crashed with an unhandled ENOENT the moment any one
// file was individually missing (live-reproduced this session: temporarily
// removing browser.md alone, with every directory still present, crashed
// the script instead of skipping gracefully).
const requiredFiles = [browserMdPath, executeMdPath, browserRsPath, cdpEvalJsPath, execJsRsPath];
const missingFiles = requiredFiles.filter((p) => !fs.existsSync(p));
const submodulesPresent = missingFiles.length === 0;

let conformanceFailed = false;
if (!submodulesPresent) {
  console.log(`prose-conformance: skipping -- missing file(s) (submodules not populated, or a partial/shallow checkout): ${missingFiles.map((p) => path.relative(root, p)).join(', ')}`);
} else {
  const browserMd = fs.readFileSync(path.join(proseSourceDir, 'browser.md'), 'utf8');
  const browserRs = fs.readFileSync(browserRsPath, 'utf8');
  const cdpEvalJs = fs.readFileSync(cdpEvalJsPath, 'utf8');
  const executeMd = fs.readFileSync(path.join(proseSourceDir, 'execute.md'), 'utf8');
  const execJsRs = fs.readFileSync(execJsRsPath, 'utf8');

  // Extract every backtick-quoted `<word>\n<expression>` / `<word>=` mode
  // prefix from browser.md's "Body shapes" code block -- the exact syntax
  // the served prose promises as a real body-shape prefix.
  const bodyShapesMatch = browserMd.match(/## Body shapes[\s\S]*?```\r?\n([\s\S]*?)```/);
  const promisedPrefixes = [];
  if (bodyShapesMatch) {
    for (const line of bodyShapesMatch[1].split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      // "session new" / "session list" / "session close <id>" -> session subcommands
      const sessionMatch = t.match(/^session (\w+)/);
      if (sessionMatch) { promisedPrefixes.push({ kind: 'session', name: sessionMatch[1] }); continue; }
      // "<word>\n<expression>" or "<word> interval=...\n<expression>" -> bare mode word
      const modeMatch = t.match(/^(\w+)(?:\s+\w+=<[^>]+>)*\\n/);
      if (modeMatch && !['url', 'timeout', 'dom'].includes(modeMatch[1])) { promisedPrefixes.push({ kind: 'mode', name: modeMatch[1] }); continue; }
      // "<word>=<...>" -> key= prefix (url=, timeout=, dom=)
      const kvMatch = t.match(/^(\w+)=</);
      if (kvMatch) { promisedPrefixes.push({ kind: 'kv', name: kvMatch[1] }); continue; }
    }
  }

  const conformanceFindings = [];
  for (const { kind, name } of promisedPrefixes) {
    // Every promised prefix must appear as a real string literal in either
    // the Rust prefix-stripping logic or the JS mode-dispatch logic -- one
    // hit in either is sufficient (some prefixes are parsed Rust-side,
    // others are only checked JS-side against the `mode` string agentplug
    // passes through). `session <word>` prefixes are matched as the real
    // "session <word>" literal parse_session_command uses, not the bare
    // word alone (which would false-positive-pass on any incidental
    // substring match).
    let inRust, inJs;
    if (kind === 'session') {
      inRust = browserRs.includes(`"session ${name}`);
      inJs = false;
    } else if (kind === 'kv') {
      inRust = browserRs.includes(`"${name}="`);
      inJs = cdpEvalJs.includes(`${name}=`);
    } else {
      inRust = browserRs.includes(`"${name}\\n"`) || browserRs.includes(`"${name}"`);
      inJs = cdpEvalJs.includes(`'${name}'`) || cdpEvalJs.includes(`"${name}"`);
    }
    if (!inRust && !inJs) {
      conformanceFindings.push(`browser.md promises ${kind} prefix "${name}" with zero implementing-code reference in browser.rs or cdp_eval.js`);
    }
  }

  // exec_js opts.* fields: extract every `opts.<fieldName>` token referenced
  // in execute.md's prose and check exec_js.rs actually reads it via
  // opts.get("<fieldName>").
  const optsFieldRe = /opts\.([a-zA-Z][a-zA-Z0-9]*)/g;
  const promisedOptsFields = new Set();
  let m;
  while ((m = optsFieldRe.exec(executeMd)) !== null) promisedOptsFields.add(m[1]);
  for (const field of promisedOptsFields) {
    if (field === 'true' || field === 'false') continue;
    const needle = `opts.get("${field}")`;
    if (!execJsRs.includes(needle)) {
      conformanceFindings.push(`execute.md promises exec_js opts.${field} with no matching opts.get("${field}") in exec_js.rs`);
    }
  }

  if (conformanceFindings.length) {
    conformanceFailed = true;
    console.error('prose-conformance FAILED -- prose promises capabilities with no confirmed implementing-code reference:');
    for (const f of conformanceFindings) console.error(`  - ${f}`);
  } else {
    console.log(`prose-conformance: ${promisedPrefixes.length} browser mode-prefixes + ${promisedOptsFields.size} exec_js opts fields all have a matching implementing-code reference`);
  }
}

if (bundleFailed || conformanceFailed) {
  process.exit(1);
}
