import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Usage: check-doc-counts.mjs [root]   (default: the gm checkout this script sits in).
// Every "N nodes", "N edges", "N gate predicates" and "N principles" claim in the site and
// docs must equal a count of one of the three graphs: the state machine
// (gm-config/fsm/graph.json), the hop graph (skills/dream-rsi/gm-graph.json) or the DADA
// graph (skills/dream-rsi/dada-graph.json). Exit 1 on any claim that matches none of them.
// Exit 0 prints RESULT: PASS.

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const fsm = readJson('gm-config/fsm/graph.json');
const hop = readJson('skills/dream-rsi/gm-graph.json');
const dada = readJson('skills/dream-rsi/dada-graph.json');
const principles = (nodes) => nodes.filter((n) => n.kind === 'principle').length;

const allowed = {
  nodes: new Map([[fsm.states.length, 'state machine'], [hop.nodes.length, 'hop graph'], [dada.nodes.length, 'DADA graph']]),
  edges: new Map([[fsm.edges.length, 'state machine'], [hop.edges.length, 'hop graph'], [dada.edges.length, 'DADA graph']]),
  'gate predicates': new Map([[fsm.gates.length, 'state machine']]),
  principles: new Map([
    [principles(fsm.states), 'state machine'],
    [principles(hop.nodes), 'hop graph'],
    [principles(dada.nodes), 'DADA graph'],
  ]),
};

const claim = /\b(\d+) (graph nodes|nodes|edges|gate predicates|principles?)\b/g;
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
let claims = 0;
for (const rel of files) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(claim)) {
      const key = m[2] === 'graph nodes' ? 'nodes' : m[2] === 'principle' ? 'principles' : m[2];
      claims += 1;
      const value = Number(m[1]);
      if (!allowed[key].has(value)) {
        violations.push(`${rel}:${i + 1}: "${m[0]}" matches neither graph (${[...allowed[key].keys()].join(' or ')})`);
      }
    }
  });
}

for (const v of violations) console.log(`[FAIL] ${v}`);
console.log(`checked ${claims} count claim(s) in ${files.length} file(s) against the state machine, hop and DADA graphs`);
if (violations.length) {
  console.log(`RESULT: FAIL (${violations.length} stale count(s))`);
  process.exit(1);
}
console.log('RESULT: PASS');
