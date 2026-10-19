#!/usr/bin/env node
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
    subject: 'the hop graph, the catalogue of principles that gm-hop walks',
    lede: '<p class="lede">The hop graph is the map a hop follows. A <strong>principle</strong> is one discipline from a named book or author. A <strong>hop</strong> applies one principle to one part of the code, then follows an edge to the next principle. <strong>Gates</strong> guard the edges they sit on, and <strong>tensions</strong> stay open until they are resolved. There are no phases: every node is independent, and the walk is a graph walk with many paths. This file is separate from the state machine that enforces the walk, <code>gm-config/fsm/graph.json</code>, which has its own states and gates.</p>',
    guardCaption: 'Gates guard moves; terminals end a walk',
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

const FIG = { nodeW: 200, nodeH: 62, colGap: 44, rowGap: 22, pad: 16 }

const clip = (text, max) => {
  const s = String(text ?? '')
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

// Draws the gate skeleton: the entry point, its direct targets, every gate and terminal,
// and each edge among them. Positions come from the edges, so the figure is derived.
const skeletonFigure = (graph, byId, edges, slug, title) => {
  const entryIds = Array.isArray(graph.entry_points) ? graph.entry_points : []
  const inSet = new Set(entryIds)
  for (const node of graph.nodes) if (node.kind === 'gate' || node.kind === 'terminal') inSet.add(node.id)
  const figEdges = edges.filter((edge) => inSet.has(edge.from) && inSet.has(edge.to))
  if (figEdges.length === 0) return ''

  const hasIncoming = new Set(figEdges.map((edge) => edge.to))
  const rank = new Map()
  const queue = []
  for (const id of inSet) if (!hasIncoming.has(id)) { rank.set(id, 0); queue.push(id) }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const edge of figEdges) {
      if (edge.from === id && !rank.has(edge.to)) { rank.set(edge.to, rank.get(id) + 1); queue.push(edge.to) }
    }
  }
  for (const id of inSet) if (!rank.has(id)) rank.set(id, 0)

  const columns = []
  for (const id of inSet) {
    const r = rank.get(id)
    if (!columns[r]) columns[r] = []
    columns[r].push(id)
  }
  for (const column of columns) column.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const position = new Map()
  columns.forEach((column, r) => column.forEach((id, row) => {
    position.set(id, { x: FIG.pad + r * (FIG.nodeW + FIG.colGap), y: FIG.pad + row * (FIG.nodeH + FIG.rowGap) })
  }))
  const width = FIG.pad * 2 + columns.length * FIG.nodeW + (columns.length - 1) * FIG.colGap
  const tallest = Math.max(...columns.map((column) => column.length))
  const hasBackEdge = figEdges.some((edge) => rank.get(edge.to) <= rank.get(edge.from))
  const height = FIG.pad * 2 + tallest * FIG.nodeH + (tallest - 1) * FIG.rowGap + (hasBackEdge ? 56 : 0)
  const arrow = `skeleton-arrow-${slug}`

  const edgeSvg = figEdges.map((edge) => {
    const a = position.get(edge.from)
    const b = position.get(edge.to)
    let path
    let lx
    let ly
    if (rank.get(edge.to) > rank.get(edge.from)) {
      const x1 = a.x + FIG.nodeW
      const y1 = a.y + FIG.nodeH / 2
      const x2 = b.x
      const y2 = b.y + FIG.nodeH / 2
      path = `M${x1},${y1} L${x2},${y2}`
      lx = (x1 + x2) / 2
      ly = (y1 + y2) / 2 - 4
    } else {
      const x1 = a.x + FIG.nodeW / 2
      const y1 = a.y + FIG.nodeH
      const x2 = b.x + FIG.nodeW / 2
      const y2 = b.y + FIG.nodeH
      const dip = Math.max(y1, y2) + 44
      path = `M${x1},${y1} Q${(x1 + x2) / 2},${dip} ${x2},${y2}`
      lx = (x1 + x2) / 2
      ly = dip - 6
    }
    return `<path d="${path}" fill="none" stroke="currentColor" marker-end="url(#${arrow})"/>`
  }).join('\n')

  const nodeSvg = columns.flat().map((id) => {
    const p = position.get(id)
    const node = byId.get(id)
    const dash = node && node.kind === 'terminal' ? ' stroke-dasharray="6 4"' : ''
    const label = node ? (node.book || node.label) : id
    return `<g><title>${esc(id + ': ' + label)}</title>` +
      `<rect x="${p.x}" y="${p.y}" width="${FIG.nodeW}" height="${FIG.nodeH}" rx="6" fill="none" stroke="currentColor"${dash}/>` +
      `<text x="${p.x + 10}" y="${p.y + 24}" font-size="14" font-weight="700" fill="currentColor">${esc(clip(id, 26))}</text>` +
      `<text x="${p.x + 10}" y="${p.y + 46}" font-size="13" fill="currentColor">${esc(clip(label, 28))}</text></g>`
  }).join('\n')

  const summary = figEdges.map((edge) => `${edge.from} to ${edge.to}${edge.condition ? ' when ' + edge.condition : ''}`).join('; ')
  return `<figure class="graph-skeleton">
<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-labelledby="skeleton-${slug}-title skeleton-${slug}-desc" xmlns="http://www.w3.org/2000/svg">
<title id="skeleton-${slug}-title">Gate skeleton of the ${esc(title)}</title>
<desc id="skeleton-${slug}-desc">${esc(summary)}</desc>
<defs><marker id="${arrow}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
${edgeSvg}
${nodeSvg}
</svg>
<figcaption>The entry point, every gate and terminal, and each edge among them, drawn from the graph's edges. Dashed boxes are terminals. The entry point's direct targets are listed under Start here.<br>${figEdges.filter((edge) => edge.condition).map((edge) => `${esc(edge.from)} to ${esc(edge.to)} when ${esc(edge.condition)}`).join('; ')}</figcaption>
</figure>`
}

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

  const unlinked = nodes.filter((node) => !outgoing.has(node.id) && !incoming.has(node.id))
  if (unlinked.length > 0) {
    fail('graph_unlinked_node', `${unlinked.length} node(s) carry no edge in either direction: ${unlinked.slice(0, 10).map((node) => node.id).join(', ')}`)
  }

  const nodeLink = (id, cls) => `<a class="${cls}" href="#${esc(anchorOf(id))}" title="${esc(titleOf(id))}" aria-label="${esc(id + ': ' + titleOf(id))}">${esc(id)}</a>`
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
    const members_cell = members.length === 0
      ? 'none'
      : `<details><summary>Members (${members.length})</summary>${memberLinks}</details>`
    return `      <tr><td>${head}</td><td>${members.length}</td><td>${principles}</td><td>${tensions}</td><td>${others}</td><td>${members_cell}</td></tr>`
  }).join('\n')

  const nodeSections = nodes.map((node) => {
    const out = outgoing.get(node.id) ?? []
    const incomingList = incoming.get(node.id) ?? []
    const phaseCell = node.provenance ? `concern ${esc(node.provenance)}` : 'unattributed'
    const heading = node.book
      ? `<code>${esc(node.id)}</code> ${esc(node.book)}${node.author ? ` <span class="author">${esc(node.author)}</span>` : ''}`
      : `<code>${esc(node.id)}</code> ${esc(node.label)}`
    const searchText = [node.id, node.label, node.book, node.author, node.kind, node.provenance].filter(Boolean).join(' ').toLowerCase()
    return `  <section class="graph-node" id="${esc(anchorOf(node.id))}" data-search="${esc(searchText)}">
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
  const description = `${entry.subject}, generated from ${entry.source}: ${nodes.length} nodes, ${kindCount('principle')} principles, ${bucketOrder.length} provenance concerns and no phase nodes, ${edges.length} edges; every node is its own anchor and links to every node it touches.`
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

  const startNode = entryPoints[0]
  const convergence = graph.convergence && typeof graph.convergence === 'object' ? graph.convergence : null
  const targetList = edges
    .filter((edge) => edge.from === startNode)
    .map((edge) => `<a href="#${esc(anchorOf(edge.to))}"><code>${esc(edge.to)}</code></a>${edge.condition && edge.condition.length <= 100 ? ' when ' + esc(edge.condition) : ''}`)
    .join(', ')
  const startHere = startNode
    ? `<p>The entry point is <a href="#${esc(anchorOf(startNode))}"><code>${esc(startNode)}</code></a>: ${esc(labelOf(startNode))}. Every gate and terminal is listed under <a href="#gates-and-terminals">Gates and terminals</a>.</p>${targetList ? `\n<p>Direct targets of the entry point: ${targetList}.</p>` : ''}${convergence ? `\n<p>The walk converges when ${esc(convergence.reached_when)}. Terminal: <code>${esc(convergence.terminal)}</code>. Halt: <code>${esc(convergence.halt)}</code>.</p>` : ''}`
    : '<p>This graph declares no entry point.</p>'

  const skeletonHtml = skeletonFigure(graph, byId, edges, entry.page.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(), entry.title)

  const page = `${entry.lede}

<p>Every node below is its own anchor, listed flat and in full: ${nodes.length} nodes, none of them behind a bucket. Each one names every node it reaches and every node that reaches it, in both directions, so a walk can start anywhere and move node to node. The concern index above the list is provenance, not a gate: it says where each book came from and points at the same anchors.</p>

<p>This page is generated from <code>${entry.source}</code> by <code>scripts/build-graph-page.mjs</code>. Every count on it is derived from that file at build time. The same file is published as <a href="../${entry.api}"><code>${entry.api}</code></a>.</p>

<nav class="page-jump" aria-label="Sections of this page">
<a href="#start-here">Start here</a> · <a href="#concern-index">Concern index</a> · <a href="#every-node">Every node</a> · <a href="#gates-and-terminals">Gates and terminals</a> · <a href="#every-edge">Every edge</a>
</nav>

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

<h2 id="start-here">Start here</h2>
${startHere}
${skeletonHtml}

<h2 id="concern-index">Concern index</h2>
<table>
  <caption>An index over the same node anchors, not a separate view of them</caption>
  <thead><tr><th>Concern</th><th>Nodes</th><th>Principles</th><th>Tensions</th><th>Other</th><th>Members</th></tr></thead>
  <tbody>
${phaseRows}
  </tbody>
</table>

<h2 id="every-node">Every node</h2>
<p>${nodes.length} nodes, sorted by id. <strong>Out</strong> names every node this node has an edge to; <strong>In</strong> names every node with an edge to it.</p>
<form class="node-filter" role="search" onsubmit="return false">
  <label for="node-filter-input">Filter the nodes</label>
  <input id="node-filter-input" type="search" autocomplete="off" placeholder="Id, label, book or author" aria-describedby="node-filter-status">
  <p id="node-filter-status" role="status">Showing ${nodes.length} of ${nodes.length} nodes.</p>
</form>
${nodeSections}

<h2 id="gates-and-terminals">Gates and terminals</h2>
<table>
  <caption>${entry.guardCaption}</caption>
  <thead><tr><th>Node</th><th>Kind</th><th>Condition</th><th>Out</th><th>In</th></tr></thead>
  <tbody>
${guardRows}
  </tbody>
</table>

${booksSection}<h2 id="every-edge">Every edge</h2>
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
<script>
(() => {
  const input = document.getElementById('node-filter-input')
  const status = document.getElementById('node-filter-status')
  const sections = [...document.querySelectorAll('section.graph-node')]
  if (!input || !status || sections.length === 0) return
  const matches = (section, query) => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return terms.every((term) => section.dataset.search.includes(term))
  }
  const update = () => {
    let shown = 0
    for (const section of sections) {
      const hit = matches(section, input.value)
      section.hidden = !hit
      if (hit) shown += 1
    }
    status.textContent = 'Showing ' + shown + ' of ' + sections.length + ' nodes.'
  }
  const reveal = () => {
    let id = ''
    try { id = decodeURIComponent(location.hash.slice(1)) } catch (err) { return }
    const target = id && document.getElementById(id)
    if (target && target.classList.contains('graph-node') && target.hidden) {
      input.value = ''
      update()
    }
  }
  input.addEventListener('input', update)
  window.addEventListener('hashchange', reveal)
  reveal()
})()
</script>
`

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
