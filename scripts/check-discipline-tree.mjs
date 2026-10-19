import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graphPath = path.join(root, 'skills', 'dream-rsi', 'gm-graph.json');

const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

function fail(name, detail) {
  record(name, false, detail);
  console.log(`[FAIL] ${name}: ${detail}`);
  console.log(`RESULT: FAIL (${checks.filter((c) => !c.ok).length} failure(s) over ${checks.length} check(s))`);
  process.exit(1);
}

let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
} catch (err) {
  fail('graph-parses', `${path.relative(root, graphPath)} does not parse: ${err.message}`);
}
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const edges = Array.isArray(graph.edges) ? graph.edges : [];
const rel = path.relative(root, graphPath).split(path.sep).join('/');

const byId = new Map();
const duplicateIds = [];
for (const n of nodes) {
  if (byId.has(n.id)) duplicateIds.push(n.id);
  byId.set(n.id, n);
}

const provenanceOf = (id) => (byId.get(id) || {}).provenance;
const inDeg = new Map(nodes.map((n) => [n.id, 0]));
const outDeg = new Map(nodes.map((n) => [n.id, 0]));
const crossDeg = new Map(nodes.map((n) => [n.id, 0]));
const undefinedEndpoints = [];
const duplicateEdges = [];
const badKind = [];
const seenEdge = new Set();
for (const e of edges) {
  if (!byId.has(e.from)) undefinedEndpoints.push(`from ${e.from}`);
  if (!byId.has(e.to)) undefinedEndpoints.push(`to ${e.to}`);
  const key = `${e.from}>${e.to}>${e.kind}`;
  if (seenEdge.has(key)) duplicateEdges.push(key);
  seenEdge.add(key);
  if (e.kind !== 'forward' && e.kind !== 'backreference') badKind.push(key);
  if (byId.has(e.from)) outDeg.set(e.from, outDeg.get(e.from) + 1);
  if (byId.has(e.to)) inDeg.set(e.to, inDeg.get(e.to) + 1);
  const fromProvenance = provenanceOf(e.from);
  const toProvenance = provenanceOf(e.to);
  if (byId.has(e.from) && byId.has(e.to) && fromProvenance !== toProvenance && fromProvenance !== null && toProvenance !== null) {
    crossDeg.set(e.from, crossDeg.get(e.from) + 1);
    crossDeg.set(e.to, crossDeg.get(e.to) + 1);
  }
}

const entryPoints = new Set(Array.isArray(graph.entry_points) ? graph.entry_points : []);
const isolated = nodes.filter((n) => inDeg.get(n.id) === 0 && outDeg.get(n.id) === 0);
const noIn = nodes.filter((n) => inDeg.get(n.id) === 0 && !entryPoints.has(n.id));
const noOut = nodes.filter((n) => outDeg.get(n.id) === 0);
const bookNodes = nodes.filter((n) => typeof n.book === 'string' && n.book.length > 0);
const partitioned = (set) => set.filter((n) => crossDeg.get(n.id) === 0);

const index = Array.isArray(graph.book_index) ? graph.book_index : [];
const indexMermaid = index.map((r) => r.mermaid);
const indexDuplicateMermaid = indexMermaid.filter((m, i) => indexMermaid.indexOf(m) !== i);
const indexUnresolved = index.filter((r) => !byId.has(r.node));
const indexBookless = index.filter((r) => byId.has(r.node) && !(byId.get(r.node).book || '').length);
const indexNodes = index.map((r) => byId.get(r.node)).filter(Boolean);

const unconditioned = edges.filter((e) => !e.condition);
const ceiling = graph.unconditioned_edge_ceiling;
const convergence = graph.convergence || {};

const named = (ids) => ids.map((n) => (typeof n === 'string' ? n : n.id)).join(', ');

record('graph-parses', true, rel);
if (graph.node_count !== nodes.length) fail('node-count-matches', `node_count ${graph.node_count} over ${nodes.length} nodes`);
record('node-count-matches', true, `${graph.node_count}`);
if (graph.edge_count !== edges.length) fail('edge-count-matches', `edge_count ${graph.edge_count} over ${edges.length} edges`);
record('edge-count-matches', true, `${graph.edge_count}`);
const forward = edges.filter((e) => e.kind === 'forward').length;
const back = edges.filter((e) => e.kind === 'backreference').length;
if (graph.forward_edges !== forward || graph.backreference_edges !== back) {
  fail('edge-kind-counts-match', `declared ${graph.forward_edges}/${graph.backreference_edges} over ${forward}/${back}`);
}
record('edge-kind-counts-match', true, `forward ${forward} backreference ${back}`);
if (duplicateIds.length) fail('node-ids-unique', named(duplicateIds));
record('node-ids-unique', true, `${nodes.length} ids`);
if (undefinedEndpoints.length) fail('edge-endpoints-resolve', named(undefinedEndpoints));
record('edge-endpoints-resolve', true, `${edges.length} edges`);
if (duplicateEdges.length) fail('edges-unique', named(duplicateEdges));
record('edges-unique', true, `${edges.length} edges`);
if (badKind.length) fail('edge-kind-known', named(badKind));
record('edge-kind-known', true, `${edges.length} edges`);

console.log(`isolated nodes: ${isolated.length}`);
if (isolated.length) fail('zero-isolated-nodes', named(isolated));
record('zero-isolated-nodes', true, `0 of ${nodes.length}`);
console.log(`nodes with no in-edge: ${noIn.length}${entryPoints.size ? ` (entry points exempt: ${[...entryPoints].join(', ')})` : ''}`);
if (noIn.length) fail('zero-unreached-nodes', named(noIn));
record('zero-unreached-nodes', true, `0 of ${nodes.length}`);
const deadEnds = noOut.filter((n) => n.kind !== 'terminal');
console.log(`nodes with no out-edge (terminals exempt): ${deadEnds.length}`);
if (deadEnds.length) fail('zero-dead-end-nodes', named(deadEnds));
record('zero-dead-end-nodes', true, `0 of ${nodes.length}`);

console.log(`book nodes: ${bookNodes.length}`);
console.log(`provenance-partitioned books: ${partitioned(bookNodes).length}`);
if (partitioned(bookNodes).length) fail('zero-provenance-partitioned-books', named(partitioned(bookNodes)));
record('zero-provenance-partitioned-books', true, `0 of ${bookNodes.length}`);

if (index.length !== 55) fail('book-index-complete', `book_index has ${index.length} rows, expected 55`);
record('book-index-complete', true, `${index.length} rows`);
if (indexDuplicateMermaid.length) fail('book-index-mermaid-unique', named(indexDuplicateMermaid));
record('book-index-mermaid-unique', true, `${index.length} rows`);
if (indexUnresolved.length) fail('book-index-resolves', named(indexUnresolved.map((r) => r.node)));
record('book-index-resolves', true, `${index.length} rows`);
if (indexBookless.length) fail('book-index-nodes-carry-a-book', named(indexBookless.map((r) => r.node)));
record('book-index-nodes-carry-a-book', true, `${index.length} rows`);
console.log(`provenance-partitioned anchor books: ${partitioned(indexNodes).length}`);
if (partitioned(indexNodes).length) fail('zero-provenance-partitioned-anchors', named(partitioned(indexNodes)));
record('zero-provenance-partitioned-anchors', true, `0 of ${indexNodes.length}`);

const booklessAuthor = bookNodes.filter((n) => !(typeof n.author === 'string' && n.author.length));
if (booklessAuthor.length) fail('book-nodes-name-an-author', named(booklessAuthor));
record('book-nodes-name-an-author', true, `${bookNodes.length} book nodes`);
const labelMismatch = bookNodes.filter((n) => !n.label.startsWith(n.book));
if (labelMismatch.length) fail('book-label-carries-the-book', named(labelMismatch));
record('book-label-carries-the-book', true, `${bookNodes.length} book nodes`);

console.log(`edges without a condition: ${unconditioned.length} (ceiling ${ceiling})`);
if (typeof ceiling !== 'number') fail('unconditioned-edge-ceiling-declared', 'graph.unconditioned_edge_ceiling is not a number');
record('unconditioned-edge-ceiling-declared', true, `${ceiling}`);
if (unconditioned.length > ceiling) {
  fail('unconditioned-edge-ratchet', `${unconditioned.length} unconditioned edges exceed the ceiling ${ceiling}: a new edge must carry the condition that nominates it`);
}
record('unconditioned-edge-ratchet', true, `${unconditioned.length} <= ${ceiling}`);

if (!byId.has(convergence.terminal) || byId.get(convergence.terminal).kind !== 'terminal') {
  fail('convergence-terminal-is-a-terminal-node', `convergence.terminal ${JSON.stringify(convergence.terminal)}`);
}
record('convergence-terminal-is-a-terminal-node', true, convergence.terminal);
const missingDeclared = (convergence.declared_by || []).filter((id) => !byId.has(id));
if (missingDeclared.length) fail('convergence-declared-by-resolves', named(missingDeclared));
record('convergence-declared-by-resolves', true, `${(convergence.declared_by || []).length} nodes`);
if (typeof convergence.measure !== 'string' || !convergence.measure.length) {
  fail('convergence-declares-a-measure', 'a traversal with no measure cannot be shown to have moved');
}
record('convergence-declares-a-measure', true, convergence.measure);
const missingEntry = [...entryPoints].filter((id) => !byId.has(id));
if (missingEntry.length) fail('entry-points-resolve', named(missingEntry));
record('entry-points-resolve', true, `${entryPoints.size} entry point(s)`);

const failed = checks.filter((c) => !c.ok).length;
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} failure(s) over ${checks.length} check(s))`);
process.exit(failed === 0 ? 0 : 1);
