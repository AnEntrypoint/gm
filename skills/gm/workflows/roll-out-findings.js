export const meta = {
  name: 'roll-out-findings',
  description: 'Find issues across every repo, resolve each unknown and make each edit, publish without waiting on tests or CI',
  whenToUse: 'Run concurrently with fix-pending-rows at the start of every /gm run',
  phases: [
    { title: 'Find', detail: 'one finder per lens files PRD rows with their file group' },
    { title: 'Edit', detail: 'one sequential lane per file group: unknowns, edit, publish, witness-close' },
    { title: 'Critique', detail: 'completeness critic files rows for uncovered ground, edited in the same pass' },
  ],
}

const AGENT_CAP = 150
let agentsSpent = 0
const guarded = (prompt, opts) => {
  if (agentsSpent >= AGENT_CAP) return Promise.resolve(null)
  agentsSpent++
  return agent(prompt, opts)
}

const LENSES = [
  'CI/CD and release reliability (workflows, bump-pins, skill-release, doc-drift)',
  'git verb correctness and friction (push, pull, commit, hunk scope, identity)',
  'codesearch, grep, fs and ci verb behaviour versus their documented shapes',
  'dream-rsi loop correctness against https://dream-rsi.com/ (observe, replay, select, redeploy)',
  'gm-mcp schemas, relay, timeouts and bundle drift',
  'agentplug daemon robustness (claim sweep, heartbeat, backoff, self-update guard)',
  'docs drift: any doc naming a path, verb or setting that no longer resolves',
  'token, CPU, SSD and RAM efficiency of gm replies and state files',
  'cross-platform behaviour on Windows, macOS and Linux, x64 and arm',
  'observability: whether a gm failure can be diagnosed from its reply alone',
  'iteration wall-clock: tests that are not needed on a change, build caching, CI critical path and job splitting (read workflow run durations with gh)',
  'CLI debuggability: trace or dispatch ids on every failure, log locations, and one-command reproduction of a failed run',
  'dependency vulnerability and lockfile integrity: scan_deps replies (blockedCount, failCount, files skipped as too large) on every project, lockfiles present and tracked (gm-mcp/package-lock.json, rs-plugkit/Cargo.lock, agentplug/Cargo.lock), lockfile drift against its manifest, and pinned dependency versions with known advisories',
]

const ROWS = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repo: { type: 'string' },
          group: { type: 'string' },
        },
        required: ['id', 'repo', 'group'],
      },
    },
  },
  required: ['rows'],
}

const RESULT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
    commit: { type: 'string' },
    witness_dispatch_id: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['id', 'status'],
}

const finderPrompt = (lens, index) => `Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git. Session id: find-${index}-1018. cwd /workspace/gm.

Lens: ${lens}.

Look across /workspace/gm and its submodules (rs-plugkit, agentplug, gm-mcp) for defects, friction and improvements seen through this lens. Do NOT edit files, commit, or push. For each finding, file one PRD row with prd-add: id "find${index}-<short slug>" (check prd-list first and skip ids that exist), subject (at most 70 characters), description starting with "[repo: <gm|rs-plugkit|agentplug|gm-mcp>] [group: <repo-relative primary file the fix edits>]", then what is wrong, where (path:line), the evidence (dispatch ids), and acceptance_criteria a live dispatch can witness. Return {rows: [{id, repo, group}]} for the rows you filed.`

phase('Find')
const found = await pipeline(LENSES, (lens, _item, index) =>
  guarded(finderPrompt(lens, index), { phase: 'Find', label: lens.slice(0, 48), schema: ROWS })
)
const rows = found.filter(Boolean).flatMap(r => r.rows)
log(`find: ${rows.length} rows filed across ${LENSES.length} lenses`)

const editPrompt = (row) => `Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git. Session id: edit-${row.id}. cwd /workspace/gm. Read /workspace/gm/AGENTS.md and the AGENTS.md of the repo you edit.

Row: ${row.id} (repo ${row.repo}, file group ${row.group}). Read it fully with prd-list {"id":"${row.id}"}.

Steps:
1. Write the unknowns this row depends on and eliminate each with a live run; keep each dispatch id.
2. Make the minimal edit in ${row.group}. Fix nothing else; file any other finding with prd-add.
3. Commit by explicit path (subject at most 50 characters, change only, no attribution trailer). git_pull, then git_push with rev set to the full sha.
4. Close the row with prd-resolve {id, witness_evidence, witness_dispatch_id}, citing a live dispatch that exercises the edit. Do NOT wait for CI or tests; the test follow-up reads CI for your sha and reopens the row if it is red.

Return {id, status: "resolved" or "blocked", commit, witness_dispatch_id, note}. A blocked row gives its exact blocker in note.`

phase('Edit')
const byGroup = {}
for (const row of rows) {
  const key = `${row.repo}:${row.group}`
  if (!byGroup[key]) byGroup[key] = []
  byGroup[key].push(row)
}
log(`edit: ${Object.keys(byGroup).length} independent file groups`)
const edited = await parallel(
  Object.keys(byGroup).map(key => async () => {
    const lane = []
    for (const row of byGroup[key]) {
      lane.push(await guarded(editPrompt(row), { phase: 'Edit', label: row.id, schema: RESULT }))
    }
    return lane
  })
)
const results = edited.flat().filter(Boolean)

phase('Critique')
const gaps = await agent(
  `Use the gm skill for this, with mcp__gm__gm_codemode for every verb; no Bash grep/find/git. cwd /workspace/gm. Session id: find-critic-1018.

Completeness critic. These lenses already ran: ${JSON.stringify(LENSES)}. Find ground none of them covered (a repo, a verb, a platform, a workflow, a failure mode). File one PRD row per gap with prd-add using the same id, subject, description rules as the finders (id prefix "critic-"). Return {rows: [{id, repo, group}]} for the rows you filed.`,
  { phase: 'Critique', label: 'completeness critic', schema: ROWS }
)
const gapRows = gaps && gaps.rows ? gaps.rows : []
log(`critic filed ${gapRows.length} gap rows; they are picked up on the next run`)

const resolved = results.filter(r => r.status === 'resolved').map(r => r.id)
const blocked = results.filter(r => r.status !== 'resolved').map(r => ({ id: r.id, note: r.note }))
log(`roll-out: ${resolved.length} resolved, ${blocked.length} blocked`)
return { resolved, blocked, critic_rows: gapRows.map(r => r.id) }
