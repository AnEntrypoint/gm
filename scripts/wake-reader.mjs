import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseStream } from "./rss-sampler.mjs";

export const BURST_WAKES = 200;

export function parseStatus(text) {
  const voluntary = /^voluntary_ctxt_switches:\s+(\d+)/m.exec(text);
  const nonvoluntary = /^nonvoluntary_ctxt_switches:\s+(\d+)/m.exec(text);
  return { voluntary: voluntary ? Number(voluntary[1]) : 0, nonvoluntary: nonvoluntary ? Number(nonvoluntary[1]) : 0 };
}

export function parseSchedstat(text) {
  const [runNs, waitNs, slices] = text.trim().split(/\s+/).map(Number);
  return { runNs: runNs || 0, waitNs: waitNs || 0, slices: slices || 0 };
}

export function readTasks(pid) {
  const dir = "/proc/" + pid + "/task";
  let tids;
  try {
    tids = readdirSync(dir);
  } catch (err) {
    return null;
  }
  const total = { voluntary: 0, nonvoluntary: 0, runNs: 0, waitNs: 0, slices: 0, tasks: 0 };
  for (const tid of tids) {
    try {
      const status = parseStatus(readFileSync(dir + "/" + tid + "/status", "utf8"));
      const sched = parseSchedstat(readFileSync(dir + "/" + tid + "/schedstat", "utf8"));
      total.voluntary += status.voluntary;
      total.nonvoluntary += status.nonvoluntary;
      total.runNs += sched.runNs;
      total.waitNs += sched.waitNs;
      total.slices += sched.slices;
      total.tasks += 1;
    } catch (err) {
      continue;
    }
  }
  return total.tasks ? total : null;
}

export function parseWake(text) {
  const samples = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== "W") continue;
    samples.push({ at: Date.parse(f[1]), voluntary: Number(f[2]), nonvoluntary: Number(f[3]), runNs: Number(f[4]), slices: Number(f[5]), tasks: Number(f[6]) });
  }
  return samples;
}

export function rates(samples) {
  const rows = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const seconds = (cur.at - prev.at) / 1000;
    if (seconds <= 0) continue;
    const voluntary = Math.max(0, cur.voluntary - prev.voluntary);
    const nonvoluntary = Math.max(0, cur.nonvoluntary - prev.nonvoluntary);
    rows.push({
      prev: prev.at,
      at: cur.at,
      voluntaryPerSec: voluntary / seconds,
      nonvoluntaryPerSec: nonvoluntary / seconds,
      wakesPerSec: (voluntary + nonvoluntary) / seconds,
      cpuPercent: (Math.max(0, cur.runNs - prev.runNs) / (seconds * 1e9)) * 100,
    });
  }
  return rows;
}

export function attributeVerbs(row, verbs) {
  return verbs.filter((v) => v.start < row.at && v.end >= row.prev);
}

function overlap(item, row) {
  return Math.min(item.end, row.at) - Math.max(item.start, row.prev);
}

function widest(items, row) {
  let best = null;
  for (const item of items) if (!best || overlap(item, row) > overlap(best, row)) best = item;
  return best;
}

export function scopeOf(row, parsed) {
  const verb = widest(attributeVerbs(row, parsed.verbs), row);
  if (verb) return { kind: "verb", seq: verb.seq, tool: verb.tool, run: verb.body };
  const run = widest(parsed.events.filter((e) => e.start < row.at && e.end >= row.prev), row);
  if (run) return { kind: "run", seq: run.seq, tool: run.tool, run: run.actionSeq };
  return { kind: "none" };
}

export function bursts(rows, parsed) {
  return rows.filter((r) => r.wakesPerSec > BURST_WAKES).map((row) => ({ row, scope: scopeOf(row, parsed) }));
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function describe(item) {
  const s = item.scope;
  const where = s.kind === "verb" ? "verb " + s.seq + " " + s.tool + " of run " + s.run : s.kind === "run" ? s.tool + " " + s.seq : "no run or verb";
  return iso(item.row.at) + " wakes/s " + item.row.wakesPerSec.toFixed(1) + " (voluntary " + item.row.voluntaryPerSec.toFixed(1) + ", nonvoluntary " + item.row.nonvoluntaryPerSec.toFixed(1) + ") cpu " + item.row.cpuPercent.toFixed(1) + "% in " + where;
}

export async function sample(pid, outPath, seconds) {
  writeFileSync(outPath, "");
  const end = Date.now() + seconds * 1000;
  let next = Date.now();
  while (Date.now() < end) {
    const at = Date.now();
    const tasks = readTasks(pid);
    if (!tasks) {
      appendFileSync(outPath, "G " + iso(at) + " gone\n");
      return 0;
    }
    appendFileSync(outPath, ["W", iso(at), tasks.voluntary, tasks.nonvoluntary, tasks.runNs, tasks.slices, tasks.tasks].join(" ") + "\n");
    next += 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, next - Date.now())));
  }
  return 0;
}

export function windowed(parsed, windowStart) {
  return {
    samples: parsed.samples,
    events: parsed.events.filter((e) => e.end >= windowStart),
    verbs: parsed.verbs.filter((v) => v.end >= windowStart),
  };
}

export function report(wakePath, streamPath) {
  const samples = parseWake(readFileSync(wakePath, "utf8"));
  const rows = rates(samples);
  const all = parseStream(readFileSync(streamPath, "utf8"));
  const parsed = windowed(all, samples.length ? samples[0].at : 0);
  const playwriter = parsed.verbs.filter((v) => v.tool === "playwriter_execute").length;
  console.log("verb calls inside the window " + parsed.verbs.length + " (playwriter_execute " + playwriter + "), " + (all.verbs.length - parsed.verbs.length) + " from before the window ignored");
  const found = bursts(rows, parsed);
  for (const item of found) console.log(describe(item));
  const peak = rows.reduce((m, r) => (r.wakesPerSec > m.wakesPerSec ? r : m), { wakesPerSec: 0 });
  console.log("wake-report: " + rows.length + " seconds, " + found.length + " bursts above " + BURST_WAKES + " wakes/s, peak " + peak.wakesPerSec.toFixed(1) + " wakes/s");
  return 0;
}

function windowWitness() {
  const base = Date.parse("2026-11-19T10:00:00.000Z");
  const at = (s) => iso(base + s * 1000);
  const all = parseStream([
    "E " + at(0) + " " + at(30) + " 60 run_code 59",
    "V " + at(2) + " " + at(4) + " 61 playwriter_execute 59",
    "V " + at(14) + " " + at(16) + " 62 playwriter_execute 59",
  ].join("\n"));
  const lines = [];
  let vol = 1000;
  for (let t = 10; t <= 30; t++) {
    if (t > 10) vol += t === 15 ? 250 : 5;
    lines.push("W " + at(t) + " " + vol + " 0 0 0 1");
  }
  const samples = parseWake(lines.join("\n"));
  const parsed = windowed(all, samples[0].at);
  const rows = rates(samples);
  const burst = rows.find((r) => r.at === base + 15000);
  const scope = scopeOf(burst, parsed);
  const playwriter = parsed.verbs.filter((v) => v.tool === "playwriter_execute");
  const ok = parsed.verbs.length === 1 && playwriter.length === 1 && playwriter[0].seq === "62" && all.verbs.length - parsed.verbs.length === 1 && scope.kind === "verb" && scope.seq === "62";
  console.log("verb calls inside the window " + parsed.verbs.length + " (playwriter_execute " + playwriter.length + "), " + (all.verbs.length - parsed.verbs.length) + " from before the window ignored");
  console.log("burst " + burst.wakesPerSec + " wakes/s at " + at(15) + " attributed to " + scope.kind + " " + scope.seq + " " + scope.tool);
  console.log(ok ? "check-window-verbs: ok (only the playwriter_execute call inside the window is attributed; the same-length call before it is ignored)" : "check-window-verbs: FAILED");
  return ok ? 0 : 1;
}

function witness() {
  const base = Date.parse("2026-11-19T10:00:00.000Z");
  const at = (s) => iso(base + s * 1000);
  const stream = [
    "E " + at(0) + " " + at(20) + " 20 run_code 50",
    "V " + at(1) + " " + at(8) + " 11 read_file 50",
    "V " + at(9) + " " + at(18) + " 12 run_shell 50",
  ].join("\n");
  const parsed = parseStream(stream);
  const lines = [];
  let vol = 1000;
  let runNs = 0;
  for (let t = 0; t <= 20; t++) {
    if (t > 0) {
      vol += t === 5 ? 250 : t === 14 ? 0 : 5;
      runNs += 1e8;
    }
    lines.push("W " + at(t) + " " + vol + " 0 " + runNs + " 0 1");
  }
  const rows = rates(parseWake(lines.join("\n")));
  const burst = rows.find((r) => r.at === base + 5000);
  const quiet = rows.find((r) => r.at === base + 14000);
  const burstScope = scopeOf(burst, parsed);
  const quietScope = scopeOf(quiet, parsed);
  const status = parseStatus("voluntary_ctxt_switches:\t12\nnonvoluntary_ctxt_switches:\t3\n");
  const sched = parseSchedstat("1000 200 3\n");
  const ok = burst && quiet && burst.wakesPerSec === 250 && burstScope.kind === "verb" && burstScope.seq === "11" && burstScope.tool === "read_file" && quiet.wakesPerSec === 0 && quietScope.kind === "verb" && quietScope.seq === "12" && quietScope.tool === "run_shell" && status.voluntary === 12 && status.nonvoluntary === 3 && sched.runNs === 1000 && sched.slices === 3;
  console.log("burst " + (burst ? burst.wakesPerSec : "none") + " wakes/s at " + at(5) + " attributed to " + burstScope.kind + " " + burstScope.seq + " " + burstScope.tool + " of run " + burstScope.run);
  console.log("quiet " + (quiet ? quiet.wakesPerSec : "none") + " wakes/s at " + at(14) + " attributed to " + quietScope.kind + " " + quietScope.seq + " " + quietScope.tool);
  console.log(ok ? "check-wake-attribution: ok (the burst is attributed to verb 11 read_file, the quiet second to verb 12 run_shell)" : "check-wake-attribution: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--witness") {
    process.exitCode = witness() | windowWitness();
  } else if (mode === "sample" && args.length === 3) {
    process.exitCode = await sample(Number(args[0]), args[1], Number(args[2]));
  } else if (mode === "report" && args.length === 2) {
    process.exitCode = report(args[0], args[1]);
  } else {
    console.error("usage: node scripts/wake-reader.mjs --witness | sample <pid> <out> <seconds> | report <wake-stream> <sampler-stream>");
    process.exitCode = 2;
  }
}
