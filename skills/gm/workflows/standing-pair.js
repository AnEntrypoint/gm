export const meta = {
  name: 'standing-pair',
  description: 'Find and edit issues while draining the open PRD backlog concurrently, until both lanes have no work left',
  whenToUse: 'Start of every /gm run; the rollout keeps filing rows while the drain lane closes them',
  phases: [
    { title: 'Roll out', detail: 'lenses file rows and each file group edits and publishes, round after round until a round files nothing' },
    { title: 'Drain', detail: 'list open rows, group by file, fix and verify, follow CI; wait while the rollout still files' },
  ],
}

const LENSES = [
  'CI/CD and release reliability (workflows, bump-pins, skill-release, doc-drift)',
  'git verb correctness and friction (push, pull, commit, hunk scope)',
  'codesearch, grep, fs and ci verb behaviour versus their documented shapes',
  'dream-rsi loop correctness against https://dream-rsi.com/ (observe, replay, select, redeploy)',
  'gm-mcp schemas, relay, timeouts and bundle drift',
  'agentplug daemon robustness (claim sweep, heartbeat, backoff, self-update guard)',
  'docs drift: any doc naming a path, verb or setting that no longer resolves',
  'token, CPU, SSD and RAM efficiency of gm replies and state files',
  'cross-platform behaviour on Windows, macOS and Linux, x64 and arm',
  'observability: whether a gm failure can be diagnosed from its reply alone',
  'iteration wall-clock: tests not needed on a change, build caching, CI critical path',
  'CLI debuggability: trace or dispatch ids on every failure, log locations, one-command reproduction',
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
          subject: { type: 'string' },
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
    ci: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['id', 'status'],
}

const ROOT = process.cwd()
const GM = 'Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git except node.'

const finderPrompt = (lens, tag) => `${GM} Session id: find-${tag}. cwd ${ROOT}.

Lens: ${lens}.

Look across ${ROOT} and its submodules (rs-plugkit, agentplug, gm-mcp) for defects, friction and improvements through this lens. Do NOT edit, commit or push. File one PRD row per finding with prd-add: id "find-${tag}-<short slug>" (prd-list first; skip ids that exist, and file nothing when an open row already names the same file and symptom: add the new evidence to that row instead), subject at most 70 characters, description starting "[repo: <gm|rs-plugkit|agentplug|gm-mcp>] [group: <repo-relative file the fix edits>]", then what is wrong, where (path:line), evidence (dispatch ids), and acceptance a live dispatch can witness. Return {rows: [{id, repo, group, subject}]} for the rows you filed (empty if none).`

const editPrompt = (row) => `${GM} Session id: edit-${row.id}. cwd ${ROOT}. Read ${ROOT}/AGENTS.md and the AGENTS.md of the repo you edit.

Row ${row.id} (repo ${row.repo}, group ${row.group}). Read it fully with prd-list {"id":"${row.id}"}.
1. Write the unknowns it depends on and eliminate each with a live run; keep each dispatch id.
2. Make the minimal edit in ${row.group}. Fix nothing else; file other findings with prd-add.
3. Commit by explicit path (subject at most 50 characters, change only, no attribution trailer). git_pull, then git_push with the full sha.
4. Close the row with prd-resolve {id, witness_evidence, witness_dispatch_id} citing a live dispatch that exercises the edit. Do NOT wait on CI; the drain lane reads CI for your sha.
Return {id, status: "resolved" or "blocked", commit, witness_dispatch_id, note}. A blocked row names its exact blocker in note.`

const listPrompt = (attempted) => `${GM} Session id: drain-list. cwd ${ROOT}.

List every OPEN PRD row with prd-list {"status":"pending"}. Exclude any row that is blocked (prd-block), and any row whose note names a blocker that has not changed since its last attempt. Skip these ids (already attempted this run): ${JSON.stringify(attempted)}. For each remaining row read its description and return {id, repo, group, subject}: repo from its "[repo: ...]" prefix (default gm), group from its "[group: ...]" prefix (default the row id). Return {rows}. Do not edit anything.`

const fixPrompt = (row) => `${GM} Session id: fix-${row.id}. cwd ${ROOT}. Read ${ROOT}/AGENTS.md and the AGENTS.md of the repo you edit.

Row ${row.id} (repo ${row.repo}, group ${row.group}): ${row.subject}. Read it fully with prd-list {"id":"${row.id}"}.
1. Reproduce it live with a dispatch; keep the dispatch id.
2. Make the minimal fix in ${row.group}; file other findings with prd-add.
3. Build only when the repo needs it and the build setting is on (rs-plugkit: --features slim; if the default CARGO_HOME is unwritable use CARGO_HOME=/tmp/cargo-home-drsi RUSTUP_HOME=/tmp/rustup-drsi).
4. Witness the fix through a live dispatch; keep its id.
5. Secrets check from that repo must print RESULT: PASS.
6. Commit by explicit path (subject at most 50 characters, change only, no attribution trailer). git_pull, then git_push by full sha.
7. Read CI for that sha with ci-status (gh run list if the probe fails). On a red job, debug with ci_log failed_only, fix, push again; up to 3 attempts.
8. Close the row with prd-resolve {id, witness_evidence, witness_dispatch_id} only when the witness passed AND CI is green. Otherwise leave it open with the blocker.
Return {id, status: "resolved" or "blocked", commit, witness_dispatch_id, ci: "green" | "red" | "none", note}.`

const waitPrompt = `${GM} Session id: drain-wait. Call the wait verb with {"ms":60000} and return {}.`

const groupChain = new Map()
const inGroup = (key, fn) => {
  const prev = groupChain.get(key) || Promise.resolve()
  const next = prev.then(fn, fn)
  groupChain.set(key, next.catch(() => null))
  return next
}

const rolloutLane = async () => {
  let round = 0
  let filed = true
  while (filed) {
    round++
    phase('Roll out')
    const perFinder = await pipeline(
      LENSES,
      (lens, _item, index) => agent(finderPrompt(lens, `${round}-${index}`), { phase: 'Roll out', label: `r${round} ${lens.slice(0, 40)}`, schema: ROWS }),
      (found) => {
        const rows = found && found.rows ? found.rows : []
        return Promise.all(rows.map(row => inGroup(`${row.repo}:${row.group}`, () => agent(editPrompt(row), { phase: 'Roll out', label: `edit ${row.id}`, schema: RESULT }))))
      }
    )
    const edited = perFinder.filter(Boolean).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0)
    filed = edited > 0
    log(`roll-out round ${round}: ${edited} rows filed and edited as their finder reported`)
  }
  log('roll-out finished: a round filed nothing')
  return true
}

const drainLane = async () => {
  const attempted = []
  let round = 0
  while (true) {
    round++
    phase('Drain')
    const listed = await agent(listPrompt(attempted), { phase: 'Drain', label: `list ${round}`, schema: ROWS })
    const rows = (listed && listed.rows ? listed.rows : []).filter(r => !attempted.includes(r.id))
    if (rows.length === 0) break
    log(`drain round ${round}: ${rows.length} open rows`)
    const byGroup = {}
    for (const row of rows) {
      const key = `${row.repo}:${row.group}`
      if (!byGroup[key]) byGroup[key] = []
      byGroup[key].push(row)
      attempted.push(row.id)
    }
    await parallel(
      Object.keys(byGroup).map(key => async () => {
        for (const row of byGroup[key]) {
          await agent(fixPrompt(row), { phase: 'Drain', label: row.id, schema: RESULT })
        }
      })
    )
  }
  log(`drain finished after ${round} rounds; attempted ${attempted.length} rows`)
  return attempted.length
}

const [, drainedDuring] = await parallel([
  async () => {
    await rolloutLane()
    return true
  },
  () => drainLane(),
])
const drainedAfter = await drainLane()

const VALIDATE = {
  type: 'object',
  properties: {
    shas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          sha: { type: 'string' },
          job: { type: 'string' },
          group: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['repo', 'sha'],
      },
    },
  },
  required: ['shas'],
}

phase('Validate')
const scan = await agent(
  `${GM} Session id: validate-scan. cwd ${ROOT}.

For each repo (gm, rs-plugkit, agentplug, gm-mcp), list the commits pushed to main in the last six hours (git_log) and read ci-status for each sha. Each red job is one item {repo, sha, job, group (the failing file, from ci_log failed_only), detail}. Do NOT edit or commit anything. Return {shas: items}.`,
  { phase: 'Validate', label: 'validation scan', schema: VALIDATE }
)
const red = scan && scan.shas ? scan.shas : []
log(`validate: ${red.length} red jobs in the committed batch`)

const byFile = {}
for (const item of red) {
  const key = `${item.repo}:${item.group || item.sha}`
  if (!byFile[key]) byFile[key] = []
  byFile[key].push(item)
}
const fixed = await parallel(
  Object.keys(byFile).map(key => async () => {
    const lane = []
    for (const item of byFile[key]) {
      lane.push(await agent(
        `${GM} Session id: validate-fix-${item.repo}-${item.sha.slice(0, 8)}. cwd ${ROOT}. Read ${ROOT}/AGENTS.md and the AGENTS.md of the repo you edit.

Red job ${item.job || '(see ci-status)'} on ${item.sha} in ${item.repo}: ${item.detail || ''}. Reproduce it from ci_log failed_only. Fix the cause in ${item.group || 'the failing file'}. Commit by explicit path (subject at most 50 characters, change only, no attribution trailer), after check-staged-secrets prints RESULT: PASS. git_pull, git_push by full sha, then ci-status for the new sha. Up to three attempts. Return {key: "${item.repo}:${item.sha}", status: "resolved" or "blocked", commit, ci: "green" or "red" or "none", note}.`,
        { phase: 'Validate', label: `fix ${item.repo} ${item.sha.slice(0, 8)}`, schema: RESULT }
      ))
    }
    return lane
  })
)
const outcomes = fixed.flat().filter(Boolean)
log(`validate done: ${outcomes.filter(o => o.status === 'resolved').length} fixed, ${outcomes.filter(o => o.status !== 'resolved').length} still red`)

return { drained: drainedDuring + drainedAfter, validated: red.length, fixed: outcomes.filter(o => o.status === 'resolved').length }
