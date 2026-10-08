'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GRAPH = path.join(ROOT, 'skills', 'dream-rsi', 'lean-graph.json');
const OBSERVATIONS = path.join(ROOT, '.gm', 'dream-rsi');
const LEDGER = path.join(ROOT, '.gm', 'dream-rsi', 'lean-traversal.json');

const fault = (code, detail) => ({ fault: code, detail });

function loadGraph(file = GRAPH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadObservations(base = OBSERVATIONS) {
  const byId = new Map();
  if (!fs.existsSync(base)) return byId;
  for (const session of fs.readdirSync(base)) {
    const file = path.join(base, session, 'observations.json');
    if (!fs.existsSync(file)) continue;
    for (const rec of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (rec && rec.dispatch_id) byId.set(rec.dispatch_id, Object.assign({}, rec, { session }));
    }
  }
  return byId;
}

function loadLedger(file = LEDGER) {
  if (!fs.existsSync(file)) return { walks: [], backreferences: [], audit: [] };
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  ledger.walks = ledger.walks || [];
  ledger.backreferences = ledger.backreferences || [];
  ledger.audit = ledger.audit || [];
  return ledger;
}

function backrefKey(ref) {
  return ref.from + '|' + ref.to + '|' + ref.condition;
}

function preflight(graph, row) {
  const node = graph.nodes.find(n => n.id === row.node);
  if (!node) return fault('JANK_DETECTED', 'node ' + row.node + ' is not in the graph');
  if (node.kind === 'phase') return fault('JANK_DETECTED', 'phase containers are not traversable');
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) return fault('JANK_DETECTED', 'no evidence ids');
  if (new Set(row.evidence).size !== row.evidence.length) return fault('JANK_DETECTED', 'duplicate evidence id');
  if (row.backreference) {
    const edge = graph.edges.find(e => e.kind === 'backreference' && e.from === row.backreference.from && e.to === row.backreference.to && e.condition === row.backreference.condition);
    if (!edge) return fault('JANK_DETECTED', 'backreference is not a graph edge with that condition');
  }
  return null;
}

function mapState(row, byId) {
  const missing = row.evidence.filter(id => !byId.has(id));
  if (missing.length) return fault('STATE_UNMAPPED', 'dispatch ids absent from observation logs: ' + missing.join(','));
  return null;
}

function validateRow(graph, byId, row) {
  if (!row || typeof row !== 'object') return fault('IO_FAULT', 'row is not an object');
  const pre = preflight(graph, row);
  if (pre) return pre;
  const mapped = mapState(row, byId);
  if (mapped) return mapped;
  if (row.verdict === 'DERIVED') {
    if (!Array.isArray(row.derivation) || row.derivation.length === 0) return fault('SELF_REJECTED', 'derived without derivation steps');
    if (!row.falsification_attempt) return fault('SELF_REJECTED', 'no loopback falsification attempt recorded');
  }
  return null;
}

function applyRows(graph, byId, rows, file = LEDGER) {
  const ledger = loadLedger(file);
  const results = [];
  for (const row of rows) {
    if (row && row.fault) {
      ledger.audit.push({ node: row.node, outcome: row.fault, detail: row.detail || '' });
      results.push({ node: row.node, outcome: row.fault, detail: row.detail || '' });
      continue;
    }
    const bad = validateRow(graph, byId, row);
    if (bad) {
      ledger.audit.push({ node: row && row.node, outcome: bad.fault, detail: bad.detail });
      results.push({ node: row && row.node, outcome: bad.fault, detail: bad.detail });
      continue;
    }
    if (row.verdict !== 'DERIVED') {
      ledger.audit.push({ node: row.node, outcome: 'NOT_DERIVED', detail: row.falsification_attempt || '' });
      results.push({ node: row.node, outcome: 'NOT_DERIVED' });
      continue;
    }
    const sessions = [...new Set(row.evidence.map(id => byId.get(id).session))];
    ledger.walks.push({ node: row.node, dispatch_ids: row.evidence, session: sessions.join(','), note: row.derivation.join(' ') });
    if (row.backreference) ledger.backreferences.push({ edge: backrefKey(row.backreference), dispatch_ids: row.evidence });
    results.push({ node: row.node, outcome: 'ACCEPTED' });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 1) + '\n');
  return results;
}

function coverage(graph, byId, file = LEDGER) {
  const ledger = loadLedger(file);
  const verified = w => w.dispatch_ids.length > 0 && w.dispatch_ids.every(id => byId.has(id));
  const traversable = graph.nodes.filter(n => n.kind !== 'phase');
  const walked = new Set(ledger.walks.filter(verified).map(w => w.node));
  const backEdges = graph.edges.filter(e => e.kind === 'backreference');
  const firedKeys = new Set(ledger.backreferences.filter(b => b.dispatch_ids.every(id => byId.has(id))).map(b => b.edge));
  const forward = graph.edges.filter(e => e.kind === 'forward');
  return {
    traversable_nodes: traversable.length,
    nodes_verified: traversable.filter(n => walked.has(n.id)).length,
    backreference_edges: backEdges.length,
    backreferences_verified: backEdges.filter(e => firedKeys.has(backrefKey(e))).length,
    forward_edge_coverage_approx: Number((forward.filter(e => walked.has(e.from) && walked.has(e.to)).length / forward.length).toFixed(3)),
    rejected_walks: ledger.walks.filter(w => !verified(w)).map(w => ({ node: w.node, missing_dispatch_ids: w.dispatch_ids.filter(id => !byId.has(id)) })),
    unwalked_nodes: traversable.filter(n => !walked.has(n.id)).map(n => ({ id: n.id, kind: n.kind, phase: n.phase }))
  };
}

module.exports = { loadGraph, loadObservations, loadLedger, validateRow, applyRows, coverage, LEDGER, GRAPH, OBSERVATIONS };

if (require.main === module) {
  const cmd = process.argv[2];
  const graph = loadGraph();
  const byId = loadObservations();
  if (cmd === 'coverage') {
    console.log(JSON.stringify(coverage(graph, byId), null, 1));
  } else if (cmd === 'apply') {
    const rows = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    console.log(JSON.stringify(applyRows(graph, byId, rows), null, 1));
  } else {
    console.error('usage: audit.js coverage | apply <rows.json>');
    process.exit(2);
  }
}
