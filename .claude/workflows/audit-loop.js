export const meta = {
  name: 'audit-loop',
  description: 'Periodic gm/rs-* audit: cascade health, deviation scan, version-source-of-truth, residual triage',
  whenToUse: 'Run on the recurring /loop audit fire to deterministically check gm + rs-* for drift from the paper MO',
  phases: [
    { title: 'Scan', detail: 'parallel: cascade health, gmsniff/ccsniff deviations, version-source, residual, supervisor health' },
    { title: 'Triage', detail: 'classify each finding own/foreign and gate-correct/gate-miss' },
    { title: 'Synthesize', detail: 'merge into one audit verdict with corrective PRD seeds' },
  ],
}

const SCAN_SCHEMA = {
  type: 'object',
  required: ['finding', 'verdict', 'evidence'],
  properties: {
    finding: { type: 'string' },
    verdict: { type: 'string', enum: ['clean', 'deviation', 'broken', 'inconclusive'] },
    evidence: { type: 'string' },
    corrective: { type: 'string' },
  },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['ownership', 'gate_behavior', 'action'],
  properties: {
    ownership: { type: 'string', enum: ['own-session', 'foreign-session', 'repo-state'] },
    gate_behavior: { type: 'string', enum: ['gate-correct', 'gate-miss', 'no-gate-applies'] },
    action: { type: 'string', enum: ['prd-add', 'memorize', 'blocked-external', 'none'] },
    detail: { type: 'string' },
  },
}

phase('Scan')
const scans = await parallel([
  () => agent(
    'Cascade health check for the gm/rs-* publish pipeline. Compare: rs-plugkit Cargo.toml version (raw.githubusercontent.com/AnEntrypoint/rs-plugkit/main/Cargo.toml), npm plugkit-wasm latest (registry.npmjs.org/plugkit-wasm/latest .version), gm.json plugkitVersion in cwd, and the running watcher version in .gm/exec-spool/.status.json. The plugkit version line is 0.1.x; gm.json lags by CI auto-bump is normal. A source-ahead-of-published gap (Cargo.toml patch > npm patch by >1) means a dark cascade outage - check rs-plugkit actions runs for a failed Build-WASM. Report finding + verdict + evidence.',
    { label: 'scan:cascade', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Run gmsniff over the past 35 minutes and count deviation.* tokens. Use the codesearch/recall verbs and read .gm/exec-spool logs - do NOT use raw grep on source. For each deviation report the session cwd, the deviation kind, timestamp, and the turn context (phase, prd_pending, idle_ms). Distinguish my own session from foreign sessions. Report finding + verdict (clean if zero own-session deviations) + evidence.',
    { label: 'scan:gmsniff', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Run ccsniff over the past 35 minutes across ALL SEVEN disciplines as SEVEN SEPARATE invocations, one discipline flag each: `bun x ccsniff@latest --bash-discipline --since 35m`, then the same single-flag form for --git-discipline, --verb-bypass-discipline, --spool-discipline, --search-discipline, --glyph-discipline, --continuation-discipline. NEVER combine discipline flags in one call: each --*-discipline block runs as a one-shot report ending in process.exit(0), so a combined invocation silently runs only the FIRST flag and drops the rest, yielding a false-clean audit. The stable published form needs ZERO binary lookup. NEVER use native Bash find/grep/Glob (or the Grep/Glob tools) to locate the ccsniff binary or filter its output; a native search in the [gm] audit cwd is itself a search-discipline self-deviation this very scan reports. To inspect a file route through the codesearch verb. Report any flags with their cwd and timestamp; native-search flags in the audit cwd are self-deviations (lookup must route through codesearch/recall or the stable npx form). Report finding + verdict + evidence.',
    { label: 'scan:ccsniff', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Version-resolution source-of-truth check. You run inside the [gm] audit cwd where ccsniff scores tool calls: route EVERY file/pattern/symbol lookup through the codesearch verb (dispatch .gm/exec-spool/in/codesearch/<N>.txt with {"query":"..."}) or recall, NEVER the native Grep/Glob/find tools - a native search here is itself a search-discipline self-deviation that this very audit exists to catch. The authoritative plugkit version is npm plugkit-wasm .version (== rs-plugkit Cargo.toml). GitHub releases/latest on plugkit-bin returns the highest semver tag across ALL crate release lines (rs-codeinsight is on 0.3.x) so it is NOT a valid plugkit version source - the correct GH source filters releases for the tag whose assets include plugkit.wasm. Verify every version-resolution path in gm-plugkit/plugkit-wasm-wrapper.js, lib/skill-bootstrap.js, gm-plugkit/bootstrap.js uses npm plugkit-wasm or the asset-filter, never bare releases/latest - find those paths via codesearch (query "releases/latest" or "resolveLatestRemoteVersion"), not native Grep. Report finding + verdict (broken if any path uses bare releases/latest) + evidence with file:line.',
    { label: 'scan:version-source', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Residual triage for the gm repo. You run inside the [gm] audit cwd where ccsniff scores tool calls: any file/pattern/symbol lookup goes through the codesearch verb or recall, never native Grep/Glob/find (git inspection commands are fine). Run git status --porcelain and git worktree list. Stale sqlite sidecars (-shm/-wal) and orphan agent-worktree .gm databases committed into .claude/worktrees/ are pollution. Locked live worktrees belong to concurrent agent sessions and must not be mutated. Report finding + verdict + evidence + a corrective for any safely-removable orphan.',
    { label: 'scan:residual', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Supervisor upgrade-resilience health check. Run gmsniff over the past 35 minutes (stable form `bun x gmsniff@latest --since 35m`, never native grep on source) and look for supervisor.* criticals: supervisor.giving-up (restart-burst-exceeded), supervisor.version-drift, supervisor.watcher-exited-unexpectedly, supervisor.heartbeat-stale, supervisor.restart-burst-backoff. For each, report the project cwd, timestamp, and whether it predates or postdates the running gm-plugkit. The failure class to catch: a supervisor permanently dead in giving-up state (pre-2.0.1553 behavior) or churning version-drift crash-loops during a cascade upgrade window. Verify the two-layer resilience is present in the running gm-plugkit/supervisor.js: (1) restart-burst-exceeded reschedules via setTimeout(spawnWatcher, BURST_BACKOFF_MS) and does NOT process.exit(2); (2) checkWatcherHealth version_drifted is throttled by a VERSION_DRIFT_COOLDOWN_MS / lastVersionDriftActionAt guard. Find those via the codesearch verb, never native Grep. Verdict: broken if any supervisor is currently in giving-up state OR either resilience layer is missing; deviation if post-fix churn observed; clean otherwise. Report finding + verdict + evidence with the supervisor.js mechanism.',
    { label: 'scan:supervisor-health', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
])

phase('Triage')
const findings = scans.filter(Boolean).filter(s => s.verdict !== 'clean')
const triaged = await parallel(findings.map(f => () =>
  agent(
    `Triage this audit finding for ownership and gate behavior. Decide if it is the audit session's own deviation, a foreign session's, or repo state; whether any plugkit gate fired correctly, missed, or does not apply; and the corrective action (prd-add / memorize / blocked-external / none). Finding: ${f.finding}. Evidence: ${f.evidence}. Corrective hint: ${f.corrective || 'none'}.`,
    { label: `triage:${f.verdict}`, phase: 'Triage', schema: TRIAGE_SCHEMA }
  ).then(t => ({ ...f, triage: t }))
))

phase('Synthesize')
const verdict = {
  scanned: scans.filter(Boolean).length,
  clean: scans.filter(Boolean).filter(s => s.verdict === 'clean').length,
  deviations: triaged.filter(Boolean),
  prd_seeds: triaged.filter(Boolean)
    .filter(t => t.triage && t.triage.action === 'prd-add')
    .map(t => ({ finding: t.finding, evidence: t.evidence, detail: t.triage.detail })),
}
log(`audit-loop: ${verdict.scanned} scans, ${verdict.clean} clean, ${verdict.deviations.length} findings, ${verdict.prd_seeds.length} prd-seeds`)
return verdict
