import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Usage: check-doc-counts.mjs [root]   (default: the gm checkout this script sits in).
// Every count claim in the site and docs must equal a count of one of the three graphs: the
// state machine (gm-config/fsm/graph.json), the hop graph (skills/dream-rsi/gm-graph.json) or
// the DADA graph (skills/dream-rsi/dada-graph.json). Exit 1 on any claim that matches none of
// them, and print RESULT: PASS otherwise.

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const fsm = readJson('gm-config/fsm/graph.json');
const hop = readJson('skills/dream-rsi/gm-graph.json');
const dada = readJson('skills/dream-rsi/dada-graph.json');

// Each graph as {label, nodes, edges, gates, terminals, principles}. The state machine keeps its
// nodes under "states"; the hop and DADA graphs keep them under "nodes".
const graphs = [
  { label: 'state machine', nodes: fsm.states, edges: fsm.edges, predicates: fsm.gates.length },
  { label: 'hop graph', nodes: hop.nodes, edges: hop.edges },
  { label: 'DADA graph', nodes: dada.nodes, edges: dada.edges },
].map((g) => ({
  predicates: g.predicates ?? null,
  label: g.label,
  count: {
    nodes: g.nodes.length,
    edges: g.edges.length,
    principles: g.nodes.filter((n) => n.kind === 'principle').length,
    gates: g.nodes.filter((n) => n.kind === 'gate').length,
    terminals: g.nodes.filter((n) => n.kind === 'terminal').length,
    predicates: g.predicates,
  },
}));

// Each claim kind maps to the counts that may satisfy it.
const allowedFor = (kind) => graphs
  .filter((g) => g.count[kind] !== null && g.count[kind] !== undefined)
  .map((g) => [g.count[kind], g.label]);

const claims = [
  { kind: 'nodes', re: /\b(\d+) (?:graph )?nodes\b/g, groups: [1] },
  { kind: 'edges', re: /\b(\d+) edges\b/g, groups: [1] },
  { kind: 'predicates', re: /\b(\d+) gate predicates\b/g, groups: [1] },
  { kind: 'principles', re: /\b(\d+) principles?\b/g, groups: [1] },
  { kind: 'gates', re: /\b(\d+) gate(?:-kind states| nodes)\b/g, groups: [1] },
  { kind: 'terminals', re: /\b(\d+) terminal nodes\b/g, groups: [1] },
  { kind: 'gates', re: /\b(\d+) gate and (\d+) terminal\b/g, groups: [1] },
  { kind: 'terminals', re: /\b(\d+) gate and (\d+) terminal\b/g, groups: [2] },
  { kind: 'gates', re: /<td>gate nodes<\/td><td>(\d+)<\/td>/g, groups: [1] },
  { kind: 'terminals', re: /<td>terminal nodes<\/td><td>(\d+)<\/td>/g, groups: [1] },
];

const files = [];
const walk = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs)) walk(path.join(rel, name));
  } else if (/\.(html|md|yaml|yml)$/.test(rel) && !rel.endsWith('paper-review-wood.md')) {
    files.push(rel);
  }
};
for (const rel of ['README.md', 'docs', 'site/content']) walk(rel);

const violations = [];
let checked = 0;
for (const rel of files) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const claim of claims) {
      for (const m of line.matchAll(claim.re)) {
        for (const group of claim.groups) {
          const value = Number(m[group]);
          const allowed = allowedFor(claim.kind);
          checked += 1;
          if (!allowed.some(([count]) => count === value)) {
            violations.push(`${rel}:${i + 1}: "${m[0]}" is not a ${claim.kind} count of any graph (${allowed.map(([c, l]) => `${c} ${l}`).join(', ')})`);
          }
        }
      }
    }
  });
}

for (const v of violations) console.log(`[FAIL] ${v}`);
console.log(`checked ${checked} count claim(s) in ${files.length} file(s) against the state machine, hop and DADA graphs`);
if (violations.length) {
  console.log(`RESULT: FAIL (${violations.length} stale count(s))`);
  process.exit(1);
}
console.log('RESULT: PASS');
