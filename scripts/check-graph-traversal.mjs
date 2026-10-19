import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const fsm = readJson('gm-config/fsm/graph.json');
const hop = readJson('skills/dream-rsi/gm-graph.json');

const failures = [];
const fail = (msg) => failures.push(msg);

function reach(starts, adjacency) {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const u = queue.shift();
    for (const v of adjacency.get(u) ?? []) {
      if (!seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return seen;
}

function adjacencyOf(edges) {
  const adjacency = new Map();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from).push(e.to);
  }
  return adjacency;
}

function checkStateMachine() {
  const fsmStates = new Map(fsm.states.map((s) => [s.key, s]));
  const fsmAdj = adjacencyOf(fsm.edges);
  for (const e of fsm.edges) {
    if (!fsmStates.has(e.from)) fail(`fsm: edge from unknown state ${e.from}`);
    if (!fsmStates.has(e.to)) fail(`fsm: edge to unknown state ${e.to}`);
  }
  const initial = fsm.policy.initial_phase;
  const terminal = fsm.policy.terminal_phase;
  const fsmReached = reach([initial], fsmAdj);
  for (const key of fsmStates.keys()) {
    if (!fsmReached.has(key)) fail(`fsm: ${key} is unreachable from ${initial}`);
  }
  if (!fsmReached.has(terminal)) fail(`fsm: terminal ${terminal} is unreachable from ${initial}`);
  for (const [key, state] of fsmStates) {
    if (state.kind !== 'terminal' && !fsmAdj.has(key)) fail(`fsm: non-terminal ${key} (${state.kind}) is a dead end`);
  }
  if (!(fsmAdj.get('COMPLETE') ?? []).includes(terminal)) fail(`fsm: COMPLETE has no edge to ${terminal}`);
  return { fsmStates, fsmReached, initial };
}

function checkHopGraph() {
  const hopNodes = new Map(hop.nodes.map((n) => [n.id, n]));
  const hopAdj = adjacencyOf(hop.edges);
  for (const e of hop.edges) {
    if (!hopNodes.has(e.from)) fail(`hop: edge from unknown node ${e.from}`);
    if (!hopNodes.has(e.to)) fail(`hop: edge to unknown node ${e.to}`);
  }
  for (const entry of hop.entry_points) {
    if (!hopNodes.has(entry)) fail(`hop: entry point ${entry} is not a node`);
  }
  const reached = reach(hop.entry_points, hopAdj);
  for (const id of hopNodes.keys()) {
    if (!reached.has(id)) fail(`hop: ${id} is unreachable from every entry point`);
  }
  for (const name of ['terminal', 'halt']) {
    const id = hop.convergence[name];
    if (!hopNodes.has(id)) fail(`hop: convergence.${name} ${id} is not a node`);
    else if (hopNodes.get(id).kind !== 'terminal') fail(`hop: convergence.${name} ${id} is a ${hopNodes.get(id).kind}, not a terminal`);
  }
  return hopNodes;
}

function checkSharedNodeKinds(fsmStates, hopNodes) {
  for (const [id, node] of hopNodes) {
    const other = fsmStates.get(id);
    if (other && other.kind !== node.kind) fail(`kind mismatch for ${id}: state machine says ${other.kind}, hop graph says ${node.kind}`);
  }
}

const { fsmStates, fsmReached, initial } = checkStateMachine();
const hopNodes = checkHopGraph();
checkSharedNodeKinds(fsmStates, hopNodes);

for (const f of failures) console.log(`[FAIL] ${f}`);
console.log(`traversed the state machine (${fsmReached.size}/${fsmStates.size} reachable from ${initial}) and the hop graph (${hop.entry_points.length} entry point(s), ${hopNodes.size} nodes)`);
if (failures.length) {
  console.log(`RESULT: FAIL (${failures.length} failure(s))`);
  process.exit(1);
}
console.log('RESULT: PASS');
