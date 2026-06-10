export const meta = {
  name: 'audit-validation',
  description: 'Per-fire gm + rs-* drift audit: deviation scan, repo cleanliness, cascade version coherence, live incremental-reembed reuse assertion',
  whenToUse: 'Recurring /loop audit fire to deterministically validate the paper MO holds in practice across gm and the rs-* sibling repos',
  phases: [
    { title: 'Scan', detail: 'deviation scan own-vs-foreign + per-repo porcelain/ahead' },
    { title: 'Cascade', detail: 'version source-of-truth coherence + stalled-release check' },
    { title: 'Reembed', detail: 'force a digest-mismatch reindex and assert incremental reuse' },
    { title: 'Synthesize', detail: 'fold findings into a structured report' },
  ],
}

const REPOS = ['gm', 'rs-plugkit', 'rs-exec', 'rs-codeinsight', 'rs-search', 'rs-learn']

const SCAN_SCHEMA = {
  type: 'object',
  required: ['own_deviations', 'foreign_deviations', 'dirty_repos', 'unpushed_repos', 'findings'],
  properties: {
    own_deviations: { type: 'integer' },
    foreign_deviations: { type: 'integer' },
    dirty_repos: { type: 'array', items: { type: 'string' } },
    unpushed_repos: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

const CASCADE_SCHEMA = {
  type: 'object',
  required: ['versions_coherent', 'stalled_release', 'findings'],
  properties: {
    versions_coherent: { type: 'boolean' },
    stalled_release: { type: 'boolean' },
    cargo_version: { type: 'string' },
    npm_version: { type: 'string' },
    gm_plugkit_version: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

const REEMBED_SCHEMA = {
  type: 'object',
  required: ['reused', 'embedded', 'reused_files', 'removed_files', 'converged', 'findings'],
  properties: {
    reused: { type: 'integer' },
    embedded: { type: 'integer' },
    reused_files: { type: 'integer' },
    removed_files: { type: 'integer' },
    converged: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

phase('Scan')
const scan = await agent(
  `Read .gm/exec-spool/.turn-summary.json for deviations_30m. Run gmsniff --list-deviations --since 30m and classify each deviation by cwd: own = cwd-gm (this audit session), foreign = any other cwd. Then for each repo ${REPOS.join(' ')} under C:/dev, run git status --porcelain (dirty if non-empty) and git rev-list --count @{u}..HEAD (unpushed if >0). Report counts and any finding worth a PRD row. A foreign deviation that the gates correctly fired on is gate-positive and needs no action; only own-session deviations or ungated drift are findings.`,
  { label: 'scan:deviations+repos', phase: 'Scan', schema: SCAN_SCHEMA },
)

phase('Cascade')
const cascade = await agent(
  `Validate cascade version source-of-truth coherence. rs-plugkit Cargo.toml version is authoritative. Compare it to: the published npm plugkit-wasm version, and gm.json plugkitVersion. They should agree (allowing for in-flight CI auto-bump). Check gh run list for the rs-plugkit Release workflow latest run; if its conclusion is failure while the same-commit Build succeeded, that is a stalled release (finding: re-trigger via gh run rerun <id> --failed). Report coherence and any stalled release.`,
  { label: 'cascade:version-coherence', phase: 'Cascade', schema: CASCADE_SCHEMA },
)

phase('Reembed')
const reembed = await agent(
  `Validate the rs-plugkit incremental codeinsight reembed in practice. The codeinsight index rebuilds only on a tree-digest mismatch (HEAD + git porcelain). After any commit this session the digest flips while most file content is unchanged, so a reindex must reuse persisted per-file manifest embeddings (reused>0) rather than re-embed everything. Trigger a reindex by dispatching a codesearch verb when the stored digest differs from current, then read the latest 'code_index: done' line in .gm/exec-spool/.watcher.log for reused / embedded / reused_files / removed_files. converged=true iff reused>0 on a digest-mismatch rebuild of an unchanged tree. If reused=0 with manifests loaded, the per-file manifest path-form keying never hits prior.get(fp) and the freeze the fix targets is not eliminated - that is a real rs-plugkit defect finding.`,
  { label: 'reembed:reuse-assertion', phase: 'Reembed', schema: REEMBED_SCHEMA },
)

phase('Synthesize')
const allFindings = [
  ...scan.findings.map(f => `[scan] ${f}`),
  ...cascade.findings.map(f => `[cascade] ${f}`),
  ...reembed.findings.map(f => `[reembed] ${f}`),
]

return {
  clean: scan.own_deviations === 0 && scan.dirty_repos.length === 0 && scan.unpushed_repos.length === 0 && cascade.versions_coherent && !cascade.stalled_release && reembed.converged,
  own_deviations: scan.own_deviations,
  foreign_deviations: scan.foreign_deviations,
  dirty_repos: scan.dirty_repos,
  unpushed_repos: scan.unpushed_repos,
  versions_coherent: cascade.versions_coherent,
  stalled_release: cascade.stalled_release,
  reembed_converged: reembed.converged,
  reembed_reused: reembed.reused,
  findings: allFindings,
}
