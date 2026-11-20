import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSchedstat, parseStatus } from "./wake-reader.mjs";

export const TICK_US = 10000;
export const LOAD_PERCENT = 50;
const FIXTURE = fileURLToPath(new URL("./fixtures/settle-pass-peer.txt", import.meta.url));
const EXIT_FIXTURE = fileURLToPath(new URL("./fixtures/settle-pass-exit.txt", import.meta.url));

const iso = (ms) => new Date(ms).toISOString();

export function parseTaskStat(text) {
  const f = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return { utime: Number(f[11]), stime: Number(f[12]) };
}

export function parseIo(text) {
  const syscr = /^syscr:\s+(\d+)/m.exec(text);
  const syscw = /^syscw:\s+(\d+)/m.exec(text);
  return { syscr: syscr ? Number(syscr[1]) : 0, syscw: syscw ? Number(syscw[1]) : 0 };
}

export function readProcess(pid) {
  const dir = "/proc/" + pid + "/task";
  let tids;
  try {
    tids = readdirSync(dir);
  } catch (err) {
    return null;
  }
  const threads = [];
  for (const tid of tids) {
    try {
      const stat = parseTaskStat(readFileSync(dir + "/" + tid + "/stat", "utf8"));
      const status = parseStatus(readFileSync(dir + "/" + tid + "/status", "utf8"));
      const sched = parseSchedstat(readFileSync(dir + "/" + tid + "/schedstat", "utf8"));
      threads.push({ tid, utime: stat.utime, stime: stat.stime, vol: status.voluntary, non: status.nonvoluntary, runNs: sched.runNs, slices: sched.slices });
    } catch (err) {
      continue;
    }
  }
  let io = { syscr: 0, syscw: 0 };
  try {
    io = parseIo(readFileSync("/proc/" + pid + "/io", "utf8"));
  } catch (err) {
    io = { syscr: 0, syscw: 0 };
  }
  let group = { utime: null, stime: null };
  try {
    group = parseTaskStat(readFileSync("/proc/" + pid + "/stat", "utf8"));
  } catch (err) {
    group = { utime: null, stime: null };
  }
  return { threads, syscr: io.syscr, syscw: io.syscw, utime: group.utime, stime: group.stime };
}

export function parseSamples(text) {
  const procs = [];
  const threads = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "P") procs.push({ at: Date.parse(f[1]), syscr: Number(f[2]), syscw: Number(f[3]), utime: f[4] === undefined ? null : Number(f[4]), stime: f[5] === undefined ? null : Number(f[5]) });
    if (f[0] === "T") threads.push({ at: Date.parse(f[1]), tid: f[2], utime: Number(f[3]), stime: Number(f[4]), vol: Number(f[5]), non: Number(f[6]), runNs: Number(f[7]), slices: Number(f[8]) });
  }
  return { procs, threads };
}

export function threadTicks(parsed) {
  const first = new Map();
  const last = new Map();
  for (const t of parsed.threads) {
    if (!first.has(t.tid)) first.set(t.tid, t);
    last.set(t.tid, t);
  }
  let ticks = 0;
  for (const [tid, end] of last) {
    const start = first.get(tid);
    ticks += end.utime + end.stime - (start.utime + start.stime);
  }
  return ticks;
}

export function processTotal(parsed) {
  const stat = parsed.procs.filter((p) => p.utime !== null);
  if (stat.length > 1) {
    const first = stat[0];
    const last = stat[stat.length - 1];
    return { ticks: last.utime + last.stime - (first.utime + first.stime), elapsedMs: last.at - first.at, source: "stat" };
  }
  const times = parsed.threads.map((t) => t.at);
  const elapsedMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
  return { ticks: threadTicks(parsed), elapsedMs, source: "threads" };
}

function busiestThread(threads) {
  const first = new Map();
  const last = new Map();
  for (const t of threads) {
    if (!first.has(t.tid)) first.set(t.tid, t);
    last.set(t.tid, t);
  }
  let best = null;
  for (const [tid, end] of last) {
    const start = first.get(tid);
    const vol = end.vol - start.vol;
    if (!best || vol > best.vol) best = { tid, vol };
  }
  return best ? best.tid : null;
}

export function perPass(parsed) {
  const tid = busiestThread(parsed.threads);
  const mine = parsed.threads.filter((t) => t.tid === tid);
  const totals = { passes: 0, stime: 0, utime: 0, runNs: 0, slices: 0, elapsedMs: 0 };
  for (let i = 1; i < mine.length; i++) {
    const prev = mine[i - 1];
    const cur = mine[i];
    totals.passes += cur.vol - prev.vol;
    totals.stime += cur.stime - prev.stime;
    totals.utime += cur.utime - prev.utime;
    totals.runNs += cur.runNs - prev.runNs;
    totals.slices += cur.slices - prev.slices;
    totals.elapsedMs += cur.at - prev.at;
  }
  const procDelta = { syscr: 0, syscw: 0 };
  if (parsed.procs.length > 1) {
    const p0 = parsed.procs[0];
    const p1 = parsed.procs[parsed.procs.length - 1];
    procDelta.syscr = p1.syscr - p0.syscr;
    procDelta.syscw = p1.syscw - p0.syscw;
  }
  const passes = totals.passes;
  const group = processTotal(parsed);
  return {
    tid,
    passes,
    passesPerSec: totals.elapsedMs ? (passes * 1000) / totals.elapsedMs : 0,
    kernelUsPerPass: passes ? (totals.stime * TICK_US) / passes : 0,
    userUsPerPass: passes ? (totals.utime * TICK_US) / passes : 0,
    runUsPerPass: passes ? totals.runNs / 1000 / passes : 0,
    slicesPerPass: passes ? totals.slices / passes : 0,
    syscrPerPass: passes ? procDelta.syscr / passes : 0,
    syscwPerPass: passes ? procDelta.syscw / passes : 0,
    processTicks: group.ticks,
    processSource: group.source,
    processCpuPercent: group.elapsedMs ? (group.ticks * TICK_US * 100) / (group.elapsedMs * 1000) : 0,
    threadTicks: threadTicks(parsed),
  };
}

export function describePerPass(result) {
  const loaded = result.processCpuPercent >= LOAD_PERCENT ? "yes" : "no";
  return "settle-pass: thread " + result.tid + " passes " + result.passes + " (" + result.passesPerSec.toFixed(1) + "/s) kernel_us_per_pass " + result.kernelUsPerPass.toFixed(1) + " user_us_per_pass " + result.userUsPerPass.toFixed(1) + " run_us_per_pass " + result.runUsPerPass.toFixed(1) + " slices_per_pass " + result.slicesPerPass.toFixed(2) + " syscr_per_pass " + result.syscrPerPass.toFixed(2) + " syscw_per_pass " + result.syscwPerPass.toFixed(2) + " process_cpu " + result.processCpuPercent.toFixed(1) + "% (" + result.processSource + ", process ticks " + result.processTicks + ", thread ticks " + result.threadTicks + ") loaded " + loaded;
}

export async function sample(pid, outPath, seconds) {
  writeFileSync(outPath, "");
  const end = Date.now() + seconds * 1000;
  let next = Date.now();
  while (Date.now() < end) {
    const at = Date.now();
    const proc = readProcess(pid);
    if (!proc) {
      appendFileSync(outPath, "G " + iso(at) + " gone\n");
      return 0;
    }
    const lines = ["P " + iso(at) + " " + proc.syscr + " " + proc.syscw + " " + proc.utime + " " + proc.stime];
    for (const t of proc.threads) lines.push(["T", iso(at), t.tid, t.utime, t.stime, t.vol, t.non, t.runNs, t.slices].join(" "));
    appendFileSync(outPath, lines.join("\n") + "\n");
    next += 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, next - Date.now())));
  }
  return 0;
}

export function report(path) {
  const result = perPass(parseSamples(readFileSync(path, "utf8")));
  console.log(describePerPass(result));
  return 0;
}

const EXPECTED = { tid: "1923859", passes: 16132, kernelUsPerPass: 574, userUsPerPass: 74.4, fixtureCpu: 69.7 };
const EXIT = { processTicks: 360, threadTicks: 360, cpu: 60, loaded: true };

function near(a, b) {
  return Math.abs(a - b) <= 0.05 * Math.max(1, Math.abs(b));
}

function within(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function witness() {
  const fixture = perPass(parseSamples(readFileSync(FIXTURE, "utf8")));
  const exit = perPass(parseSamples(readFileSync(EXIT_FIXTURE, "utf8")));
  const fixtureOk = fixture.passes === EXPECTED.passes && near(fixture.kernelUsPerPass, EXPECTED.kernelUsPerPass) && near(fixture.userUsPerPass, EXPECTED.userUsPerPass) && fixture.tid === EXPECTED.tid && within(fixture.processCpuPercent, EXPECTED.fixtureCpu, 0.05) && fixture.processTicks >= fixture.threadTicks;
  const exitOk = exit.processSource === "stat" && exit.processTicks === EXIT.processTicks && exit.threadTicks === EXIT.threadTicks && exit.processTicks >= exit.threadTicks && within(exit.processCpuPercent, EXIT.cpu, 0.05) && (exit.processCpuPercent >= LOAD_PERCENT) === EXIT.loaded;
  console.log(describePerPass(fixture));
  console.log(describePerPass(exit));
  const ok = fixtureOk && exitOk;
  console.log(ok ? "check-settle-pass: ok (the recorded settle thread keeps its 16132 passes and 574.0 us kernel per pass; the exit case counts the exited thread: process " + exit.processTicks + " ticks, threads " + exit.threadTicks + ", loaded " + (exit.processCpuPercent >= LOAD_PERCENT ? "yes" : "no") + ")" : "check-settle-pass: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--witness") {
    process.exitCode = witness();
  } else if (mode === "sample" && args.length === 3) {
    process.exitCode = await sample(Number(args[0]), args[1], Number(args[2]));
  } else if (mode === "report" && args.length === 1) {
    process.exitCode = report(args[0]);
  } else {
    console.error("usage: node scripts/settle-pass.mjs --witness | sample <pid> <out> <seconds> | report <sample>");
    process.exitCode = 2;
  }
}
