export const meta = {
  name: 'audit-loop',
  description: 'Periodic gm/rs-* audit: cascade health, deviation scan, version-source-of-truth, residual triage',
  whenToUse: 'Run on the recurring /loop audit fire to deterministically check gm + rs-* for drift from the paper MO',
  phases: [
    { title: 'Scan', detail: 'parallel: cascade health, gmsniff/ccsniff deviations, version-source check' },
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
    'Run ccsniff for all four disciplines (--git-discipline, --continuation-discipline, --glyph-discipline, --search-discipline) over the past 35 minutes. Report any flags with their cwd and timestamp. search-discipline native-search-grep flags in the audit cwd are self-deviations (code lookup must route through the codesearch verb). Report finding + verdict + evidence.',
    { label: 'scan:ccsniff', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Version-resolution source-of-truth check. The authoritative plugkit version is npm plugkit-wasm .version (== rs-plugkit Cargo.toml). GitHub releases/latest on plugkit-bin returns the highest semver tag across ALL crate release lines (rs-codeinsight is on 0.3.x) so it is NOT a valid plugkit version source - the correct GH source filters releases for the tag whose assets include plugkit.wasm. Verify every version-resolution path in gm-plugkit/plugkit-wasm-wrapper.js, lib/skill-bootstrap.js, gm-plugkit/bootstrap.js uses npm plugkit-wasm or the asset-filter, never bare releases/latest. Report finding + verdict (broken if any path uses bare releases/latest) + evidence with file:line.',
    { label: 'scan:version-source', phase: 'Scan', schema: SCAN_SCHEMA }
  ),
  () => agent(
    'Residual triage for the gm repo. Run git status --porcelain and git worktree list. Stale sqlite sidecars (-shm/-wal) and orphan agent-worktree .gm databases committed into .claude/worktrees/ are pollution. Locked live worktrees belong to concurrent agent sessions and must not be mutated. Report finding + verdict + evidence + a corrective for any safely-removable orphan.',
    { label: 'scan:residual', phase: 'Scan', schema: SCAN_SCHEMA }
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
