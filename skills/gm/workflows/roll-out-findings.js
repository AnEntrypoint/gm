export const meta = {
  name: 'roll-out-findings',
  description: 'Roll gm lenses across all repos and file every finding as a PRD row without fixing anything',
  whenToUse: 'Run concurrently with fix-pending-rows to keep the PRD backlog filled',
  phases: [
    { title: 'Roll out', detail: 'one finder per lens files PRD rows' },
    { title: 'Critique', detail: 'completeness critic files rows for uncovered ground' },
  ],
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
]

const REPORT = {
  type: 'object',
  properties: {
    filed: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['filed'],
}

const finderPrompt = (lens, index) => `Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git. Session id: rollout-${index}-1018. cwd /workspace/gm.

Lens: ${lens}.

Look across /workspace/gm and its submodules (rs-plugkit, agentplug, gm-mcp) for defects, friction and improvements seen through this lens. Do NOT edit files, commit, or push anything. For each finding, file exactly one PRD row with prd-add: id "lens${index}-<short slug>" (check prd-list first and skip any id that already exists), subject (at most 70 characters), description starting with "[repo: <gm|rs-plugkit|agentplug|gm-mcp>]", then what is wrong, where (path:line), and the evidence (dispatch ids), and acceptance_criteria that a live dispatch or CI check can witness. Return {filed: [ids you filed], skipped: [ids that already existed]}.`

phase('Roll out')
const reports = await pipeline(LENSES, (lens, _item, index) =>
  agent(finderPrompt(lens, index), { phase: 'Roll out', label: lens.slice(0, 48), schema: REPORT })
)
const round1 = reports.filter(Boolean)
log(`roll-out filed ${round1.reduce((n, r) => n + r.filed.length, 0)} rows across ${LENSES.length} lenses`)

phase('Critique')
const gaps = await agent(
  `Use the gm skill for this, with mcp__gm__gm_codemode for every verb; no Bash grep/find/git. cwd /workspace/gm. Session id: rollout-critic-1018.

Completeness critic. These lenses already ran: ${JSON.stringify(LENSES)}. Find ground none of them covered (a repo, a verb, a platform, a workflow, a failure mode). Do NOT edit files, commit, or push. File one PRD row per gap with prd-add using the same id, subject, description and acceptance rules as the finders (id prefix "critic-"). Return {filed, skipped}.`,
  { phase: 'Critique', label: 'completeness critic', schema: REPORT }
)

const allFiled = round1.flatMap(r => r.filed).concat(gaps ? gaps.filed : [])
log(`roll-out complete: ${allFiled.length} rows filed`)
return { filed: allFiled }
