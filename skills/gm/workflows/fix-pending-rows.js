export const meta = {
  name: 'fix-pending-rows',
  description: 'Run tests and CI/CD follow-up concurrently with rollout, fix what they expose, and resolve rows rollout left open',
  whenToUse: 'Run concurrently with roll-out-findings at the start of every /gm run',
  phases: [
    { title: 'Scan', detail: 'ci-status for recent pushed shas, plus rows rollout left open' },
    { title: 'Fix', detail: 'one sequential lane per file group; groups run in parallel' },
    { title: 'Wrap', detail: 'summarise what went green and what stayed red' },
  ],
}

const MAX_ROUNDS = 8
const AGENT_CAP = 150
let agentsSpent = 0
const guarded = (prompt, opts) => {
  if (agentsSpent >= AGENT_CAP) return Promise.resolve(null)
  agentsSpent++
  return agent(prompt, opts)
}

const SCAN = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          key: { type: 'string' },
          repo: { type: 'string' },
          group: { type: 'string' },
          sha: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['kind', 'key', 'repo', 'group'],
      },
    },
  },
  required: ['items'],
}

const RESULT = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    status: { type: 'string' },
    commit: { type: 'string' },
    ci: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['key', 'status'],
}

const scanPrompt = (handled) => `Use the gm skill for this, with mcp__gm__gm_codemode for every verb; no Bash grep/find/git. cwd /workspace/gm. Session id: test-scan-1018.

Find the work for the test and CI/CD follow-up. Do NOT edit or commit anything.
1. For each repo (gm, rs-plugkit, agentplug, gm-mcp), list its last 30 commits on main and read ci-status for each sha. Each red job is one item: kind "ci", key "<repo>:<sha>:<job>", repo, group = the repo-relative file the failing step names (from ci_log failed_only), sha, detail = the failing step and its error line.
2. prd-list {"status":"pending"}. Each open row is one item: kind "row", key = the row id, repo from its "[repo: ...]" prefix (default gm), group from its "[group: ...]" prefix, detail = its subject. Skip any key in ${JSON.stringify(handled)}.
Return {items}.`

const fixPrompt = (item) => `Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git. Session id: test-${item.key.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}. cwd /workspace/gm. Read /workspace/gm/AGENTS.md and the AGENTS.md of the repo you edit.

${item.kind === 'ci'
  ? `CI job failing on ${item.sha} in ${item.repo}: ${item.detail}. Debug it with ci_log failed_only, fix the cause in ${item.group}, commit by explicit path (subject at most 50 characters, change only, no attribution trailer), git_pull, git_push with the full sha, then ci-status for the new sha. Up to 3 attempts.`
  : `Open row ${item.key} (repo ${item.repo}, group ${item.group}): ${item.detail}. Rollout left it open. Read it with prd-list {"id":"${item.key}"}, make the minimal fix in ${item.group}, commit by explicit path, git_pull, git_push with the full sha, prove it with a live dispatch, and prd-resolve with that witness. Do NOT wait on CI beyond one ci-status read.`}

Run no local compile or build unless the build setting is on. Fix nothing else; file any other finding with prd-add.

Return {key: "${item.key}", status: "resolved" or "red" or "blocked", commit, ci: "green", "red" or "none", note}.`

phase('Scan')
const handled = []
const outcomes = []
for (let round = 1; round <= MAX_ROUNDS; round++) {
  if (agentsSpent >= AGENT_CAP) {
    log(`agent cap ${AGENT_CAP} reached; stopping for relaunch`)
    break
  }
  const scan = await guarded(scanPrompt(handled), { phase: 'Scan', label: `scan round ${round}`, schema: SCAN })
  const items = scan && scan.items ? scan.items : []
  if (items.length === 0) {
    log(`round ${round}: nothing red and no open rows`)
    break
  }
  log(`round ${round}: ${items.length} items (${items.filter(i => i.kind === 'ci').length} red CI, ${items.filter(i => i.kind === 'row').length} open rows)`)
  const byGroup = {}
  for (const item of items) {
    const key = `${item.repo}:${item.group}`
    if (!byGroup[key]) byGroup[key] = []
    byGroup[key].push(item)
    handled.push(item.key)
  }
  phase('Fix')
  const round_ = await parallel(
    Object.keys(byGroup).map(key => async () => {
      const lane = []
      for (const item of byGroup[key]) {
        lane.push(await guarded(fixPrompt(item), { phase: 'Fix', label: item.key.slice(0, 60), schema: RESULT }))
      }
      return lane
    })
  )
  for (const r of round_.flat().filter(Boolean)) outcomes.push(r)
  log(`round ${round} done: ${outcomes.filter(o => o.status === 'resolved' || o.ci === 'green').length} green so far`)
}

phase('Wrap')
const green = outcomes.filter(o => o.status === 'resolved' || o.ci === 'green').map(o => o.key)
const red = outcomes.filter(o => o.status !== 'resolved' && o.ci !== 'green').map(o => ({ key: o.key, note: o.note }))
log(`test follow-up: ${green.length} green, ${red.length} still red or blocked`)
return { green, red }
