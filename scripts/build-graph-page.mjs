#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const graphPath = path.join(repoRoot, 'skills', 'dream-rsi', 'gm-graph.json')
const pagePath = path.join(repoRoot, 'docs', 'graph.html')
const apiPath = path.join(repoRoot, 'docs', 'api', 'gm-graph.json')

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const byId = new Map(graph.nodes.map((node) => [node.id, node]))
const outgoing = new Map()
for (const edge of graph.edges) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
const kindCount = (kind) => graph.nodes.filter((node) => node.kind === kind).length
const edgeKindCount = (kind) => graph.edges.filter((edge) => edge.kind === kind).length

const phaseNodes = graph.nodes.filter((node) => node.kind === 'phase').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
const principles = graph.nodes.filter((node) => node.kind === 'principle')
const gates = graph.nodes.filter((node) => node.kind === 'gate')
const terminals = graph.nodes.filter((node) => node.kind === 'terminal')
const tensions = graph.nodes.filter((node) => node.kind === 'tension')

const principleCard = (node) => `      <li><strong>${esc(node.book ?? node.label)}</strong>${node.author ? ` <span class="author">${esc(node.author)}</span>` : ''} <code>${esc(node.id)}</code> <span class="fan">${outgoing.get(node.id) ?? 0} outgoing</span></li>`

const phaseSections = phaseNodes.map((phase) => {
  const members = principles.filter((node) => node.phase === phase.phase)
  const tensionMembers = tensions.filter((node) => node.phase === phase.phase)
  return `  <section id="${esc(phase.id.toLowerCase())}">
    <h3>${esc(phase.label)}</h3>
    <p>${members.length} principle${members.length === 1 ? '' : 's'}${tensionMembers.length ? `, ${tensionMembers.length} standing tension${tensionMembers.length === 1 ? '' : 's'}` : ''}.</p>
    <ol>
${members.map(principleCard).join('\n')}
    </ol>
${tensionMembers.length ? `    <p><strong>Standing tensions</strong></p>\n    <ul>\n${tensionMembers.map((node) => `      <li>${esc(node.label)} <code>${esc(node.id)}</code></li>`).join('\n')}\n    </ul>\n` : ''}  </section>`
}).join('\n')

const gateRows = [...gates, ...terminals].map((node) => `      <tr><td><code>${esc(node.id)}</code></td><td>${esc(node.kind)}</td><td>${esc(node.label)}</td><td>${outgoing.get(node.id) ?? 0}</td></tr>`).join('\n')

const edgeRows = graph.edges.map((edge) => `      <tr><td><code>${esc(edge.from)}</code></td><td><code>${esc(edge.to)}</code></td><td>${esc(edge.kind)}</td><td>${esc(edge.condition ?? '')}</td></tr>`).join('\n')

const page = `<p class="lede">The graph is the map a walk follows. A <strong>principle</strong> is one discipline from a named book or author. A <strong>hop</strong> applies one principle to one part of the code, then follows an edge to the next principle. <strong>Phases</strong> group the principles, <strong>gates</strong> guard moves between them, and <strong>tensions</strong> stay open across phases until they are resolved.</p>

<p>This page is generated from <code>skills/dream-rsi/gm-graph.json</code> by <code>scripts/build-graph-page.mjs</code>. The same file is published as <a href="../docs/api/gm-graph.json"><code>docs/api/gm-graph.json</code></a>.</p>

<h2>At a glance</h2>
<table>
  <caption>Graph size</caption>
  <thead><tr><th>Part</th><th>Count</th></tr></thead>
  <tbody>
    <tr><td>Nodes</td><td>${graph.nodes.length}</td></tr>
    <tr><td>Principles</td><td>${kindCount('principle')}</td></tr>
    <tr><td>Phases</td><td>${kindCount('phase')}</td></tr>
    <tr><td>Gates</td><td>${kindCount('gate')}</td></tr>
    <tr><td>Terminals</td><td>${kindCount('terminal')}</td></tr>
    <tr><td>Standing tensions</td><td>${kindCount('tension')}</td></tr>
    <tr><td>Edges</td><td>${graph.edges.length}</td></tr>
    <tr><td>Forward edges</td><td>${edgeKindCount('forward')}</td></tr>
    <tr><td>Back-reference edges</td><td>${edgeKindCount('backreference')}</td></tr>
  </tbody>
</table>

<h2>Phases and their principles</h2>
${phaseSections}

<h2>Gates and terminals</h2>
<table>
  <caption>Gates guard moves; terminals end a walk</caption>
  <thead><tr><th>Node</th><th>Kind</th><th>Condition</th><th>Outgoing edges</th></tr></thead>
  <tbody>
${gateRows}
  </tbody>
</table>

<h2>Every edge</h2>
<details>
  <summary>Show all ${graph.edges.length} edges</summary>
  <table>
    <caption>Edges, from node to node</caption>
    <thead><tr><th>From</th><th>To</th><th>Kind</th><th>Condition</th></tr></thead>
    <tbody>
${edgeRows}
    </tbody>
  </table>
</details>
`

fs.mkdirSync(path.dirname(apiPath), { recursive: true })
fs.writeFileSync(pagePath, page)
fs.copyFileSync(graphPath, apiPath)
console.log(`graph page: ${graph.nodes.length} nodes, ${graph.edges.length} edges -> docs/graph.html`)
