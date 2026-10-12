#!/usr/bin/env node
// Generates the graph pages that flatspace hosts (docs/graph.html at /graph/ and
// docs/dada-graph.html at /dada-graph/) and mirrors each graph source to docs/api/.
//
// One code path renders every entry of GRAPHS. Every number on a page is derived
// here from that entry's graph JSON. Nothing is hand-written: the description that
// each pageSource YAML carries is rewritten here too, so a graph change cannot leave
// a stale count behind. A graph that cannot be rendered as a walkable node-to-node
// page is a build failure with a named reason code, never a silently broken page.
// Every page is rendered before the first file is written, so a refused graph
// leaves every output untouched.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const GRAPHS = [
  {
    source: 'skills/dream-rsi/gm-graph.json',
    page: 'docs/graph.html',
    api: 'docs/api/gm-graph.json',
    pageSource: 'site/content/pages/graph.yaml',
    title: 'graph',
    subject: 'the full gm graph',
    lede: '<p class="lede">The graph is the map a walk follows. A <strong>principle</strong> is one discipline from a named book or author. A <strong>hop</strong> applies one principle to one part of the code, then follows an edge to the next principle. <strong>Gates</strong> guard the edges they sit on, and <strong>tensions</strong> stay open until they are resolved. There are no phases: every node is independent, and the walk is a graph walk with many paths.</p>',
    guardCaption: 'Gates guard moves; terminals end a walk',
  },
  {
    source: 'skills/dream-rsi/dada-graph.json',
    page: 'docs/dada-graph.html',
    api: 'docs/api/dada-graph.json',
    pageSource: 'site/content/pages/dada-graph.yaml',
    title: 'DADA graph',
    subject: 'the full DADA graph',
    lede: '<p class="lede">The DADA graph uses the same node layout as the gm graph. A <strong>principle</strong> is one discipline from a named book or author, a <strong>tension</strong> stays open until it is resolved, <strong>gates</strong> guard the edges they sit on, and <strong>terminals</strong> mark the end nodes. Each edge is <strong>forward</strong> or a <strong>back-reference</strong>, and most edges carry a condition.</p>',
    guardCaption: 'Gates guard edges; terminals mark the end nodes',
  },
]

const HOPS = 'hop'
const INDEX = 'idx'
const NO_PROVENANCE = '(unattributed)'

const fail = (reasonCode, detail) => {
  const err = new Error(`${reasonCode}: ${detail}`)
  err.reasonCode = reasonCode
  throw err
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const byIdOrder = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })
const anchorOf = (id) => `node-${id}`

const renderGraph = (entry) => {
  const graphPath = path.join(repoRoot, entry.source)
  const pagePath = path.join(repoRoot, entry.page)
  const apiPath = path.join(repoRoot, entry.api)
  const pageSourcePath = path.join(repoRoot, entry.pageSource)

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
    fail('graph_declared_undefined_endpoints', `${entry.source} declares ${declaredBroken.length} undefined endpoint(s): ${declaredBroken.slice(0, 10).join(', ')}`)
  }

  const kindCount = (kind) => nodes.filter((node) => node.kind === kind).length
  const edgeKindCount = (kind) => edges.filter((edge) => edge.kind === kind).length
  for (const [key, actual] of [
    ['node_count', nodes.length],
    ['edge_count', edges.length],
    ['forward_edges', edgeKindCount('forward')],
    ['backreference_edges', edgeKindCount('backreference')],
  ]) {
    if (!(key in graph)) fail('graph_count_missing', `${key} is absent from ${entry.source}; the page derives it and cannot check an absent hand-written count`)
    if (graph[key] !== actual) fail('graph_count_drift', `${key}=${graph[key]} but the graph has ${actual}`)
  }

  const entryPoints = Array.isArray(graph.entry_points) ? graph.entry_points : []
  for (const id of entryPoints) if (!byId.has(id)) fail('graph_undefined_entry_point', id)
  const hasBooks = Array.isArray(graph.book_index)
  const bookIndex = hasBooks ? graph.book_index : []

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

  const buckets = new Map()
  for (const node of nodes) {
    const key = node.provenance ?? NO_PROVENANCE
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(node)
  }
  const bucketOrder = [...buckets.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const phaseRows = bucketOrder.map((key) => {
    const members = buckets.get(key)
    const head = esc(key === NO_PROVENANCE ? 'unattributed' : key)
    const principles = members.filter((node) => node.kind === 'principle').length
    const tensions = members.filter((node) => node.kind === 'tension').length
    const others = members.filter((node) => node.kind !== 'principle' && node.kind !== 'tension').length
    const memberLinks = members.map((node) => nodeLink(node.id, INDEX)).join(', ')
    return `      <tr><td>${head}</td><td>${members.length}</td><td>${principles}</td><td>${tensions}</td><td>${others}</td><td>${memberLinks || 'none'}</td></tr>`
  }).join('\n')

  const nodeSections = nodes.map((node) => {
    const out = outgoing.get(node.id) ?? []
    const incomingList = incoming.get(node.id) ?? []
    const phaseCell = node.provenance ? `concern ${esc(node.provenance)}` : 'unattributed'
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
  const description = `${entry.subject}, generated from ${entry.source}: ${nodes.length} nodes, ${kindCount('principle')} principles, ${bucketOrder.length} concerns of provenance and no phase nodes, ${edges.length} edges; every node is its own anchor and links to every node it touches.`
  const booksRow = hasBooks ? `    <tr><td>Books</td><td>${bookIndex.length}</td></tr>\n` : ''
  const booksSection = hasBooks ? `<h2>Books</h2>
<table>
  <caption>${bookIndex.length} books, each its own node</caption>
  <thead><tr><th>Book</th><th>Node</th><th>Prose</th></tr></thead>
  <tbody>
${bookRows}
  </tbody>
</table>

` : ''

  const page = `${entry.lede}

<p>Every node below is its own anchor, listed flat and in full: ${nodes.length} nodes, none of them behind a bucket. Each one names every node it reaches and every node that reaches it, in both directions, so a walk can start anywhere and move node to node. The concern index above the list is provenance, not a gate: it says where each book came from and points at the same anchors.</p>

<p>This page is generated from <code>${entry.source}</code> by <code>scripts/build-graph-page.mjs</code>. Every count on it is derived from that file at build time. The same file is published as <a href="../${entry.api}"><code>${entry.api}</code></a>.</p>

<h2>At a glance</h2>
<table>
  <caption>Graph size</caption>
  <thead><tr><th>Part</th><th>Count</th></tr></thead>
  <tbody>
    <tr><td>Nodes</td><td>${nodes.length}</td></tr>
    <tr><td>Principles</td><td>${kindCount('principle')}</td></tr>
    <tr><td>Concerns (provenance, not grouping)</td><td>${bucketOrder.length}</td></tr>
    <tr><td>Gates</td><td>${kindCount('gate')}</td></tr>
    <tr><td>Terminals</td><td>${kindCount('terminal')}</td></tr>
    <tr><td>Standing tensions</td><td>${kindCount('tension')}</td></tr>
${booksRow}    <tr><td>Edges</td><td>${edges.length}</td></tr>
    <tr><td>Forward edges</td><td>${edgeKindCount('forward')}</td></tr>
    <tr><td>Back-reference edges</td><td>${edgeKindCount('backreference')}</td></tr>
    <tr><td>Conditioned edges</td><td>${edges.filter((edge) => edge.condition).length}</td></tr>
    <tr><td>Entry points</td><td>${entryPoints.length}</td></tr>
    <tr><td>Node-to-node links on this page</td><td>${linkCount}</td></tr>
    <tr><td>Nodes with no edge</td><td>${unlinked.length}</td></tr>
  </tbody>
</table>

<h2>Concern index</h2>
<table>
  <caption>An index over the same node anchors, not a separate view of them</caption>
  <thead><tr><th>Concern</th><th>Nodes</th><th>Principles</th><th>Tensions</th><th>Other</th><th>Members</th></tr></thead>
  <tbody>
${phaseRows}
  </tbody>
</table>

<h2>Every node</h2>
<p>${nodes.length} nodes, sorted by id. <strong>Out</strong> names every node this node has an edge to; <strong>In</strong> names every node with an edge to it.</p>
${nodeSections}

<h2>Gates and terminals</h2>
<table>
  <caption>${entry.guardCaption}</caption>
  <thead><tr><th>Node</th><th>Kind</th><th>Condition</th><th>Out</th><th>In</th></tr></thead>
  <tbody>
${guardRows}
  </tbody>
</table>

${booksSection}<h2>Every edge</h2>
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

  const sourceText = fs.readFileSync(pageSourcePath, 'utf8')
  if (!/^description:/m.test(sourceText)) fail('graph_page_source_description_missing', `${pageSourcePath} has no description: line to derive`)
  const nextSource = sourceText.replace(/^description:.*$/m, `description: "${esc(description)}"`)

  return { entry, graphPath, pagePath, apiPath, pageSourcePath, sourceText, nextSource, page, nodeCount: nodes.length, edgeCount: edges.length, linkCount }
}

try {
  const rendered = GRAPHS.map(renderGraph)
  for (const r of rendered) {
    if (r.nextSource !== r.sourceText) fs.writeFileSync(r.pageSourcePath, r.nextSource)
    fs.mkdirSync(path.dirname(r.apiPath), { recursive: true })
    fs.writeFileSync(r.pagePath, r.page)
    fs.copyFileSync(r.graphPath, r.apiPath)
    console.log(`${r.entry.title} page: ${r.nodeCount} nodes, ${r.edgeCount} edges, ${r.linkCount} node-to-node links -> ${r.entry.page}`)
  }
} catch (err) {
  process.stderr.write(`::error::[build-graph-page] ${err.message}\n`)
  process.exit(1)
}
