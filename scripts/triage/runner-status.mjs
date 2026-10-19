#!/usr/bin/env node
// Usage: node scripts/triage/runner-status.mjs [root]
// Cross-platform port of runner-status.sh. Reads <root>/.gm/exec-spool/.status.json and prints
// ALIVE | BUSY | SERVING-STATUS-STALE | DEAD with the same verdict rules.
// Exit codes: 0 for ALIVE, BUSY and SERVING-STATUS-STALE; 1 for DEAD; 2 when no status file exists (no watcher ever started under root).
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || process.cwd();
const statusFile = path.join(root, ".gm", "exec-spool", ".status.json");
if (!fs.existsSync(statusFile)) {
  console.log(`no status file at ${statusFile} -- watcher never started here`);
  process.exit(2);
}
const d = JSON.parse(fs.readFileSync(statusFile, "utf8"));
const now = Date.now();
const age = now - (d.ts || 0);
const pid = d.pid;
const alive = Boolean(pid) && pidAlive(pid);
const busy = (d.busy_until || 0) > now;
const outDir = path.join(path.dirname(statusFile), "out");
let newest = 0;
if (fs.existsSync(outDir)) {
  for (const n of fs.readdirSync(outDir)) {
    if (!n.endsWith(".json")) continue;
    newest = Math.max(newest, fs.statSync(path.join(outDir, n)).mtimeMs);
  }
}
const outAge = newest ? Math.floor((now - newest) / 1000) : null;
const respondedRecently = outAge !== null && outAge < 300;
let verdict;
if (alive && age < 300000) verdict = "ALIVE";
else if (alive && busy) verdict = "BUSY";
else if (!alive && respondedRecently) verdict = "SERVING-STATUS-STALE";
else verdict = "DEAD";
console.log(`${verdict}: heartbeat age ${age} ms, pid ${pid} ${alive ? "present" : "ABSENT"}, runner ${d.runner_version}, queue ${d.queue_depth}, last response ${outAge ?? "none"} s ago`);
if (verdict === "SERVING-STATUS-STALE") {
  console.log("status pid absent but responses are being written: do not start a second watcher; confirm with a health dispatch");
}
const plugins = d.loaded_plugin_versions || {};
console.log("plugins: " + Object.keys(plugins).sort().map((k) => `${k} ${plugins[k]}`).join(", "));
process.exit(verdict === "DEAD" ? 1 : 0);

function pidAlive(p) {
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
