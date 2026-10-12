#!/usr/bin/env node
// Generates docs/graph.html (the body flatspace hosts at /graph/) and mirrors the
// graph source to docs/api/gm-graph.json.
//
// Every number on the page is derived here from skills/dream-rsi/gm-graph.json.
// Nothing is hand-written: the page description that site/content/pages/graph.yaml
// carries is rewritten here too, so a graph change cannot leave a stale count
// behind. A graph that cannot be rendered as a walkable node-to-node page is a
// build failure with a named reason code, never a silently broken page.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const graphPath = path.join(repoRoot, 'skills', 'dream-rsi', 'gm-graph.json')
const pagePath = path.join(repoRoot, 'docs', 'graph.html')
const apiPath = path.join(repoRoot, 'docs', 'api', 'gm-graph.json')
const pageSourcePath = path.join(repoRoot, 'site', 'content', 'pages', 'graph.yaml')

const fail = (reasonCode, detail) => {
  const err = new Error(`${reasonCode}: ${detail}`)
  err.reasonCode = reasonCode
  throw err
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const byIdOrder = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })
const anchorOf = (id) => `node-${id}`

const build = () => {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) fail('graph_nodes_missing', `${graphPath} carries no nodes[]`)
  if (!Array.isArray(graph.edges)) fail('graph_edges_missing', `${graphPath} carries no edges[]`)

  const nodes = graph.nodes.slice().sort(byIdOrder)
  const edges = graph.edges

  const byId = new Map()
  for (const node of nodes) {
    if (typeof node.id !== 'string' || node.id === '') fail('graph_node_without_id', JSON.stringify(node).slice(0, 120))
    if (byId.has(node.id)) fail('graph_duplicate_node_id', node.id)
    byId.set(node.id, node)
  }

  // A broken edge would render as a link to an anchor that does not exist, so the
  // page is refused instead of shipped with dead traversal.
  const broken = edges.filter((edge) => !byId.has(edge.from) || !byId.has(edge.to))
  if (broken.length > 0) {
    const named = broken.slice(0, 10).map((edge) => `${edge.from} -> ${edge.to}`).join(', ')
    const rest = broken.length > 10 ? ` (+${broken.length - 10} more)` : ''
    fail('graph_undefined_edge_endpoint', `${broken.length} edge(s) name a node that does not exist: ${named}${rest}`)
  }
  const declaredBroken = Array.isArray(graph.undefined_endpoints) ? graph.undefined_endpoints : []
  if (declaredBroken.length > 0) {
    fail('graph_declared_undefined_endpoints', `gm-graph.json declares ${declaredBroken.length} undefined endpoint(s): ${declaredBroken.slice(0, 10).join(', ')}`)
  }

  const kindCount = (kind) => nodes.filter((node) => node.kind === kind).length
  const edgeKindCount = (kind) => edges.filter((edge) => edge.kind === kind).length
  for (const [key, actual] of [
    ['node_count', nodes.length],
    ['edge_count', edges.length],
    ['forward_edges', edgeKindCount('forward')],
    ['backreference_edges', edgeKindCount('backreference')],
  ]) {
    if (!(key in graph)) fail('graph_count_missing', `${key} is absent from gm-graph.json; the page derives it and cannot check an absent hand-written count`)
    if (graph[key] !== actual) fail('graph_count_drift', `${key}=${graph[key]} but the graph has ${actual}`)
  }

  const entryPoints = Array.isArray(graph.entry_points) ? graph.entry_points : []
  for (const id of entryPoints) if (!byId.has(id)) fail('graph_undefined_entry_point', id)
  const bookIndex = Array.isArray(graph.book_index) ? graph.book_index : []

  const labelOf = (id) => byId.get(id)?.label ?? id
  const titleOf = (id) => {
    const node = byId.get(id)
    if (!node) return id
    return node.book ? `${node.book}${node.author ? ` - ${node.author}` : ''}` : node.label
  }

  const outgoing = new Map()
  const incoming = new Map()
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    if (!incoming.has(edge.to)) incoming.set(edge.to, [])
    outgoing.get(edge.from).push(edge)
    incoming.get(edge.to).push(edge)
  }

  // A node with no edge in either direction is unreachable by traversal: it would
  // sit on the page with nothing to click and nowhere to be clicked from.
  const unlinked = nodes.filter((node) => !outgoing.has(node.id) && !incoming.has(node.id))
  if (unlinked.length > 0) {
    fail('graph_unlinked_node', `${unlinked.length} node(s) carry no edge in either direction: ${unlinked.slice(0, 10).map((node) => node.id).join(', ')}`)
  }

  const HOPS = 'hop'
  const INDEX = 'idx'
  const nodeLink = (id, cls) => `<a class="${cls}" href="#${esc(anchorOf(id))}" title="${esc(titleOf(id))}">${esc(id)}</a>`
  const edgeRun = (list, side) => {
    if (!list || list.length === 0) return 'none'
    return list.map((edge) => {
      const other = side === 'out' ? edge.to : edge.from
      const condition = edge.condition ? ` <span class="edge-condition">when ${esc(edge.condition)}</span>` : ''
      const back = edge.kind === 'backreference' ? ' <span class="edge-kind">back-reference</span>' : ''
      return nodeLink(other, HOPS) + condition + back
    }).join(', ')
  }

  const phaseNodes = nodes.filter((node) => node.kind === 'phase')
  const phaseNodeByValue = new Map(phaseNodes.map((node) => [node.phase, node]))
  const NO_PHASE = '(no phase)'
  const buckets = new Map()
  for (const node of nodes) {
    const key = node.phase ?? NO_PHASE
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(node)
  }
  const bucketOrder = [
    ...phaseNodes.map((node) => node.phase),
    ...[...buckets.keys()].filter((key) => key !== NO_PHASE && !phaseNodeByValue.has(key)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ...(buckets.has(NO_PHASE) ? [NO_PHASE] : []),
  ]

  const phaseRows = bucketOrder.map((key) => {
    const members = buckets.get(key)
    const phaseNode = phaseNodeByValue.get(key)
    const head = phaseNode
      ? nodeLink(phaseNode.id, INDEX)
      : esc(key === NO_PHASE ? 'no phase' : key)
    const principles = members.filter((node) => node.kind === 'principle').length
    const tensions = members.filter((node) => node.kind === 'tension').length
    const others = members.filter((node) => node.kind !== 'principle' && node.kind !== 'tension' && node !== phaseNode).length
    const memberLinks = members.filter((node) => node !== phaseNode).map((node) => nodeLink(node.id, INDEX)).join(', ')
    return `      <tr><td>${head}</td><td>${members.length}</td><td>${principles}</td><td>${tensions}</td><td>${others}</td><td>${memberLinks || 'none'}</td></tr>`
  }).join('\n')

  const nodeSections = nodes.map((node) => {
    const out = outgoing.get(node.id) ?? []
    const incomingList = incoming.get(node.id) ?? []
    const phaseNode = node.phase ? phaseNodeByValue.get(node.phase) : null
    const phaseCell = node.phase
      ? `phase ${phaseNode ? nodeLink(phaseNode.id, INDEX) : esc(node.phase)}`
      : 'no phase'
    const heading = node.book
      ? `<code>${esc(node.id)}</code> ${esc(node.book)}${node.author ? ` <span class="author">${esc(node.author)}</span>` : ''}`
      : `<code>${esc(node.id)}</code> ${esc(node.label)}`
    return `  <section class="graph-node" id="${esc(anchorOf(node.id))}">
    <h3>${heading}</h3>
    <p class="graph-node-meta">${esc(node.kind)} · ${phaseCell} · ${out.length} out · ${incomingList.length} in</p>
    <p class="graph-node-edges"><strong>Out</strong> ${edgeRun(out, 'out')}</p>
    <p class="graph-node-edges"><strong>In</strong> ${edgeRun(incomingList, 'in')}</p>
  </section>`
  }).join('\n')

  const guardRows = nodes.filter((node) => node.kind === 'gate' || node.kind === 'terminal').map((node) => {
    const out = outgoing.get(node.id) ?? []
    const incomingList = incoming.get(node.id) ?? []
    return `      <tr><td>${nodeLink(node.id, INDEX)}</td><td>${esc(node.kind)}</td><td>${esc(node.label)}</td><td>${out.length}</td><td>${incomingList.length}</td></tr>`
  }).join('\n')

  const bookRows = bookIndex.map((entry) => {
    const known = byId.has(entry.node)
    return `      <tr><td><code>${esc(entry.mermaid)}</code></td><td>${known ? nodeLink(entry.node, INDEX) : esc(entry.node)}</td><td><code>${esc(entry.prose)}</code></td></tr>`
  }).join('\n')

  const edgeRows = edges.map((edge) => `      <tr><td>${nodeLink(edge.from, INDEX)}</td><td>${nodeLink(edge.to, INDEX)}</td><td>${esc(edge.kind)}</td><td>${esc(edge.condition ?? '')}</td></tr>`).join('\n')

  const linkCount = edges.length * 2
  const description = `the full gm graph, generated from skills/dream-rsi/gm-graph.json: ${nodes.length} nodes, ${kindCount('principle')} principles, ${phaseNodes.length} phases, ${edges.length} edges; every node is its own anchor and links to every node it touches.`

  const page = `<p class="lede">The graph is the map a walk follows. A <strong>principle</strong> is one discipline from a named book or author. A <strong>hop</strong> applies one principle to one part of the code, then follows an edge to the next principle. <strong>Phases</strong> group the principles, <strong>gates</strong> guard moves between them, and <strong>tensions</strong> stay open across phases until they are resolved.</p>

<p>Every node below is its own anchor, listed flat and in full: ${nodes.length} nodes, none of them behind a bucket. Each one names every node it reaches and every node that reaches it, in both directions, so a walk can start anywhere and move node to node. The phase table above the list is an index, not a gate: it points at the same anchors.</p>

<p>This page is generated from <code>skills/dream-rsi/gm-graph.json</code> by <code>scripts/build-graph-page.mjs</code>. Every count on it is derived from that file at build time. The same file is published as <a href="../docs/api/gm-graph.json"><code>docs/api/gm-graph.json</code></a>.</p>

<h2>At a glance</h2>
<table>
  <caption>Graph size</caption>
  <thead><tr><th>Part</th><th>Count</th></tr></thead>
  <tbody>
    <tr><td>Nodes</td><td>${nodes.length}</td></tr>
    <tr><td>Principles</td><td>${kindCount('principle')}</td></tr>
    <tr><td>Phases</td><td>${kindCount('phase')}</td></tr>
    <tr><td>Gates</td><td>${kindCount('gate')}</td></tr>
    <tr><td>Terminals</td><td>${kindCount('terminal')}</td></tr>
    <tr><td>Standing tensions</td><td>${kindCount('tension')}</td></tr>
    <tr><td>Books</td><td>${bookIndex.length}</td></tr>
    <tr><td>Edges</td><td>${edges.length}</td></tr>
    <tr><td>Forward edges</td><td>${edgeKindCount('forward')}</td></tr>
    <tr><td>Back-reference edges</td><td>${edgeKindCount('backreference')}</td></tr>
    <tr><td>Conditioned edges</td><td>${edges.filter((edge) => edge.condition).length}</td></tr>
    <tr><td>Entry points</td><td>${entryPoints.length}</td></tr>
    <tr><td>Node-to-node links on this page</td><td>${linkCount}</td></tr>
    <tr><td>Nodes with no edge</td><td>${unlinked.length}</td></tr>
  </tbody>
</table>

<h2>Phase index</h2>
<table>
  <caption>An index over the same node anchors, not a separate view of them</caption>
  <thead><tr><th>Phase</th><th>Nodes</th><th>Principles</th><th>Tensions</th><th>Other</th><th>Members</th></tr></thead>
  <tbody>
${phaseRows}
  </tbody>
</table>

<h2>Every node</h2>
<p>${nodes.length} nodes, sorted by id. <strong>Out</strong> names every node this node has an edge to; <strong>In</strong> names every node with an edge to it.</p>
${nodeSections}

<h2>Gates and terminals</h2>
<table>
  <caption>Gates guard moves; terminals end a walk</caption>
  <thead><tr><th>Node</th><th>Kind</th><th>Condition</th><th>Out</th><th>In</th></tr></thead>
  <tbody>
${guardRows}
  </tbody>
</table>

<h2>Books</h2>
<table>
  <caption>${bookIndex.length} books, each its own node</caption>
  <thead><tr><th>Book</th><th>Node</th><th>Prose</th></tr></thead>
  <tbody>
${bookRows}
  </tbody>
</table>

<h2>Every edge</h2>
<details>
  <summary>Show all ${edges.length} edges</summary>
  <table>
    <caption>Edges, from node to node</caption>
    <thead><tr><th>From</th><th>To</th><th>Kind</th><th>Condition</th></tr></thead>
    <tbody>
${edgeRows}
    </tbody>
  </table>
</details>
`

  // The page is only walkable if every anchor exists and every hop link rendered.
  for (const node of nodes) {
    if (!page.includes(`id="${anchorOf(node.id)}"`)) fail('graph_page_missing_anchor', `no anchor rendered for ${node.id}`)
  }
  const renderedHops = page.split(`class="${HOPS}"`).length - 1
  if (renderedHops !== linkCount) fail('graph_page_link_count_mismatch', `${renderedHops} hop links rendered, ${linkCount} expected`)

  const source = fs.readFileSync(pageSourcePath, 'utf8')
  if (!/^description:/m.test(source)) fail('graph_page_source_description_missing', `${pageSourcePath} has no description: line to derive`)
  const nextSource = source.replace(/^description:.*$/m, `description: "${esc(description)}"`)
  if (nextSource !== source) fs.writeFileSync(pageSourcePath, nextSource)

  fs.mkdirSync(path.dirname(apiPath), { recursive: true })
  fs.writeFileSync(pagePath, page)
  fs.copyFileSync(graphPath, apiPath)
  console.log(`graph page: ${nodes.length} nodes, ${edges.length} edges, ${linkCount} node-to-node links -> docs/graph.html`)
}

try {
  build()
} catch (err) {
  process.stderr.write(`::error::[build-graph-page] ${err.message}\n`)
  process.exit(1)
}
