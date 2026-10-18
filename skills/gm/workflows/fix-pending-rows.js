export const meta = {
  name: 'fix-pending-rows',
  description: 'Fix open PRD rows concurrently per repo, debug live, follow CI/CD to green, and resolve each row only with a witness',
  whenToUse: 'Run concurrently with roll-out-findings to drain the PRD backlog',
  phases: [
    { title: 'Fix', detail: 'one sequential lane per repo; rows inside a repo never run in parallel' },
    { title: 'Wrap', detail: 'summarise what resolved and what stayed blocked' },
  ],
}

const REPOS = ['gm', 'rs-plugkit', 'agentplug', 'gm-mcp']
const MAX_ROUNDS = 8

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
          subject: { type: 'string' },
        },
        required: ['id', 'repo'],
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

const listPrompt = (skip) => `Use the gm skill for this, with mcp__gm__gm_codemode for every verb; no Bash grep/find/git. cwd /workspace/gm. Session id: fix-list-1018.

List every OPEN PRD row with prd-list {"status":"pending"}. Skip these ids (already handled this run): ${JSON.stringify(skip)}. For each remaining row, read its description and return {id, repo, subject}. repo is the value in its "[repo: ...]" prefix; if there is none, use "gm". Return {rows}. Do not edit anything.`

const fixPrompt = (row) => `Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git. Session id: fix-${row.id}. cwd /workspace/gm. Read /workspace/gm/AGENTS.md and the AGENTS.md of the repo you edit.

Row: ${row.id} — ${row.subject}. Read it fully with prd-list {"id":"${row.id}"}.

Steps:
1. Reproduce it live first with a dispatch and keep its dispatch id.
2. Make the minimal fix in its repo (${row.repo}). Fix nothing else; file any other finding with prd-add.
3. Build when the repo needs it (rs-plugkit: --features slim; if the default CARGO_HOME is unwritable use CARGO_HOME=/tmp/cargo-home-drsi RUSTUP_HOME=/tmp/rustup-drsi).
4. Witness the fix through a live dispatch and keep that dispatch id.
5. Run node scripts/check-staged-secrets.mjs from that repo; it must print RESULT: PASS.
6. Commit by explicit path (subject at most 50 characters, change only, no attribution trailer). git_pull, then git_push with rev set to the full sha.
7. Watch CI with ci_status for the pushed sha. If a job fails, debug it with ci_log failed_only, fix it, push again. Up to 3 attempts.
8. Close the row with prd-resolve {id, witness_evidence, witness_dispatch_id} only when the witness passed AND CI is green. Otherwise leave the row open.

Return {id, status: "resolved" or "blocked", commit, witness_dispatch_id, ci: "green", "red" or "none", note}. A blocked row gives its exact blocker in note.`

phase('Fix')
const handled = []
const resolved = []
const blocked = []
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const listed = await agent(listPrompt(handled), { phase: 'Fix', label: `list round ${round}`, schema: ROWS })
  const rows = listed && listed.rows ? listed.rows : []
  if (rows.length === 0) {
    log(`round ${round}: no open rows left`)
    break
  }
  log(`round ${round}: ${rows.length} open rows across repos`)
  const byRepo = {}
  for (const row of rows) {
    const key = REPOS.includes(row.repo) ? row.repo : 'gm'
    if (!byRepo[key]) byRepo[key] = []
    byRepo[key].push(row)
    handled.push(row.id)
  }
  const outcomes = await parallel(
    Object.keys(byRepo).map(repo => async () => {
      const lane = []
      for (const row of byRepo[repo]) {
        lane.push(await agent(fixPrompt(row), { phase: 'Fix', label: `${repo}:${row.id}`, schema: RESULT }))
      }
      return lane
    })
  )
  for (const result of outcomes.flat().filter(Boolean)) {
    if (result.status === 'resolved') resolved.push(result)
    else blocked.push(result)
  }
  log(`round ${round} done: ${resolved.length} resolved, ${blocked.length} blocked so far`)
}

phase('Wrap')
log(`fix run finished: ${resolved.length} resolved, ${blocked.length} blocked`)
return { resolved: resolved.map(r => r.id), blocked: blocked.map(r => ({ id: r.id, note: r.note })) }
