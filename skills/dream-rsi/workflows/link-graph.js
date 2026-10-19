export const meta = {
  name: 'link-graph',
  description: 'Propose inbound handover edges for unreachable graph nodes, judge each one, and apply the accepted edges to the merged graph',
  whenToUse: 'After gm-graph.json is merged, or whenever check-discipline-tree reports unreached nodes',
  phases: [
    { title: 'Propose', detail: 'one proposer per cluster links each unreached node from a reachable node' },
    { title: 'Judge', detail: 'one judge per cluster accepts only handovers that read as true' },
    { title: 'Apply', detail: 'write accepted edges into the graph and re-run the discipline check' },
  ],
}

const GRAPH = '/workspace/gm/skills/dream-rsi/gm-graph.json'
const CHECK = 'scripts/check-discipline-tree.mjs'
const CLUSTERS = [
  'dada:STANCE', 'dada:RULES', 'dada:BREAK', 'dada:EXPRESS', 'dada:SYSTEM', 'dada:CANON', 'dada:CAT',
  'dada:REASON', 'dada:WELCOME', 'dada:CRITICS', 'dada:LENSES', 'dada:PANEL', 'dada:ADAPT', 'dada:AUTONOMY',
]

const GM = 'Use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path. Use mcp__gm__gm_codemode (load via ToolSearch "select:mcp__gm__gm_codemode") for every verb; no Bash grep/find/git except node.'

const EDGES = {
  type: 'object',
  properties: {
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          condition: { type: 'string' },
        },
        required: ['from', 'to', 'condition'],
      },
    },
  },
  required: ['edges'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          accept: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['from', 'to', 'accept'],
      },
    },
  },
  required: ['verdicts'],
}

const proposePrompt = (cluster, retryTargets) => `${GM} Session id: link-propose-${cluster.replace(/[^A-Za-z0-9]+/g, '-')}. cwd /workspace/gm.

Read ${GRAPH} with exec_js (node fs, JSON.parse). Compute reachability from its entry_points by breadth-first search over edges. ${retryTargets ? `Only these unreached nodes need a link now: ${JSON.stringify(retryTargets)}.` : `Your unreached nodes are the principle-kind nodes whose provenance is ${cluster} and that the search does not reach.`}

For each such node T, propose ONE inbound edge {from: R, to: T, kind: "forward", condition: C}. R must be a reachable principle node whose discipline genuinely hands over to T's discipline (a method that precedes, feeds or checks T's method). C is the rhetoric: one short handover sentence naming what R hands T and why, in the form "<verb phrase>" such as "checks persuasion with" or "names the target audience for". Both ids must exist in the graph. Do not propose self-edges. Return {edges: [{from, to, condition}]} and nothing else.`

const judgePrompt = (cluster, edges) => `${GM} Session id: link-judge-${cluster.replace(/[^A-Za-z0-9]+/g, '-')}. cwd /workspace/gm.

Read the labels of each endpoint in ${GRAPH} with exec_js. For each proposed edge below decide accept true only when: the source discipline genuinely precedes, feeds or checks the target discipline, AND the condition reads as a true handover sentence for that pair. Otherwise accept false with a one-line reason. Be strict: a link that is merely topical is rejected.

Proposed edges: ${JSON.stringify(edges)}

Return {verdicts: [{from, to, accept, reason}]} covering every proposed edge.`

const applyPrompt = (accepted) => `${GM} Session id: link-apply. cwd /workspace/gm.

Apply these accepted edges to ${GRAPH} with exec_js (node fs): append each {from, to, kind: "forward", condition} unless an edge with the same from, to and kind already exists; then recount edge_count, forward_edges and backreference_edges. Then run node ${CHECK} from /workspace/gm and report its RESULT line. Do not edit any other file.

Accepted edges: ${JSON.stringify(accepted)}

Return {added: <number appended>, check: <the RESULT line>}.`

phase('Propose')
const proposals = await pipeline(CLUSTERS, cluster =>
  agent(proposePrompt(cluster, null), { phase: 'Propose', label: `propose ${cluster}`, schema: EDGES })
)
const proposed = proposals.filter(Boolean).flatMap(p => p.edges || [])
log(`propose: ${proposed.length} edges across ${CLUSTERS.length} clusters`)

phase('Judge')
const judged = await pipeline(CLUSTERS, async (cluster, _item, index) => {
  const mine = proposals[index] ? proposals[index].edges || [] : []
  if (mine.length === 0) return { cluster, accepted: [], rejected: [] }
  const v = await agent(judgePrompt(cluster, mine), { phase: 'Judge', label: `judge ${cluster}`, schema: VERDICTS })
  const verdicts = v && v.verdicts ? v.verdicts : []
  const accepted = mine.filter(e => verdicts.some(x => x.from === e.from && x.to === e.to && x.accept))
  const rejected = mine.filter(e => !accepted.includes(e))
  return { cluster, accepted, rejected }
})

const accepted = judged.filter(Boolean).flatMap(j => j.accepted)
const rejectedTargets = judged.filter(Boolean).flatMap(j => j.rejected.map(e => e.to))
log(`judge: ${accepted.length} accepted, ${rejectedTargets.length} rejected`)

if (rejectedTargets.length) {
  const retry = await agent(proposePrompt('retry', rejectedTargets), { phase: 'Propose', label: 'retry rejected targets', schema: EDGES })
  const retryEdges = retry && retry.edges ? retry.edges : []
  const v2 = retryEdges.length
    ? await agent(judgePrompt('retry', retryEdges), { phase: 'Judge', label: 'judge retry', schema: VERDICTS })
    : null
  const ok = v2 && v2.verdicts ? retryEdges.filter(e => v2.verdicts.some(x => x.from === e.from && x.to === e.to && x.accept)) : []
  accepted.push(...ok)
  log(`retry: ${ok.length} more accepted of ${retryEdges.length}`)
}

phase('Apply')
const applied = accepted.length
  ? await agent(applyPrompt(accepted), { phase: 'Apply', label: 'apply accepted edges', schema: { type: 'object', properties: { added: { type: 'number' }, check: { type: 'string' } }, required: ['added'] } })
  : { added: 0, check: 'nothing accepted' }
log(`apply: ${applied && applied.added} edges added; ${applied && applied.check}`)
return { proposed: proposed.length, accepted: accepted.length, applied }
