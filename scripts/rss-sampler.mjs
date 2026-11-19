import { appendFileSync, openSync, readSync, closeSync, statSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SPIKE_KB = 65536;
const SAMPLE_MS = 1000;
const EVENT_KINDS = ["code-call", "result", "job"];

export function parseStream(text) {
  const samples = [];
  const events = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(" ");
    if (parts[0] === "S" && parts.length === 3) {
      samples.push({ at: Date.parse(parts[1]), kb: Number(parts[2]) });
    } else if (parts[0] === "E" && parts.length === 5) {
      events.push({ start: Date.parse(parts[1]), end: Date.parse(parts[2]), seq: parts[3], tool: parts[4] });
    }
  }
  return { samples, events };
}

export function attribute(prev, cur, events) {
  return events.filter((e) => e.start < cur.at && e.end >= prev.at);
}

export function spikes(samples, events) {
  const found = [];
  for (let i = 1; i < samples.length; i++) {
    const step = samples[i].kb - samples[i - 1].kb;
    if (step < SPIKE_KB) continue;
    found.push({ at: samples[i].at, kb: samples[i].kb, step, hits: attribute(samples[i - 1], samples[i], events) });
  }
  return found;
}

export function eventLine(record) {
  if (typeof record.durMs !== "number" || typeof record.t !== "string") return null;
  if (!EVENT_KINDS.includes(record.kind)) return null;
  const end = Date.parse(record.t);
  const start = end - record.durMs;
  const tool = record.tool || "job";
  return "E " + new Date(start).toISOString() + " " + new Date(end).toISOString() + " " + record.seq + " " + tool;
}

function rssOf(pid) {
  let text = "";
  try {
    text = readFileSync("/proc/" + pid + "/status", "utf8");
  } catch (err) {
    return null;
  }
  const line = text.split("\n").find((l) => l.startsWith("VmRSS:"));
  return line ? Number(line.split(/\s+/)[1]) : null;
}

function readNewLog(path, offset) {
  const size = statSync(path).size;
  if (size <= offset) return { text: "", offset };
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(size - offset);
  readSync(fd, buffer, 0, buffer.length, offset);
  closeSync(fd);
  return { text: buffer.toString("utf8"), offset: size };
}

async function sample(pid, logPath, seconds, outPath) {
  const began = Date.now();
  let offset = 0;
  let pending = "";
  for (;;) {
    const tick = Date.now();
    const rss = rssOf(pid);
    if (rss === null) {
      appendFileSync(outPath, "G " + new Date(tick).toISOString() + " gone\n");
      break;
    }
    appendFileSync(outPath, "S " + new Date(tick).toISOString() + " " + rss + "\n");
    const chunk = readNewLog(logPath, offset);
    offset = chunk.offset;
    const lines = (pending + chunk.text).split("\n");
    pending = lines.pop();
    for (const line of lines) {
      let record = null;
      try { record = JSON.parse(line); } catch (err) { continue; }
      const out = eventLine(record);
      if (out) appendFileSync(outPath, out + "\n");
    }
    if (Date.now() - began >= seconds * 1000) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, tick + SAMPLE_MS - Date.now())));
  }
}

function witness() {
  const fixture = [
    "S 2026-11-19T10:00:00.000Z 760000",
    "S 2026-11-19T10:00:01.000Z 760100",
    "S 2026-11-19T10:00:02.000Z 760200",
    "S 2026-11-19T10:00:03.000Z 1310000",
    "S 2026-11-19T10:00:04.000Z 760300",
    "S 2026-11-19T10:00:05.000Z 760300",
    "S 2026-11-19T10:00:06.000Z 760300",
    "S 2026-11-19T10:00:07.000Z 760300",
    "S 2026-11-19T10:00:08.000Z 760300",
    "E 2026-11-19T10:00:02.000Z 2026-11-19T10:00:04.000Z 1 run_shell",
    "E 2026-11-19T10:00:06.000Z 2026-11-19T10:00:09.000Z 2 run_code",
  ].join("\n");
  const { samples, events } = parseStream(fixture);
  const found = spikes(samples, events);
  const attributed = found.map((s) => s.hits.map((e) => e.seq + " " + e.tool).join(","));
  const ok = found.length === 1 && attributed[0] === "1 run_shell";
  const when = found[0] ? new Date(found[0].at).toISOString() : "none";
  console.log("spikes " + found.length + " at " + when + " step " + (found[0] ? found[0].step : 0) + " KB attributed to " + (attributed[0] || "nothing"));
  console.log(ok ? "check-rss-join: ok (a spike inside run_shell is attributed to it and not to run_code)" : "check-rss-join: FAILED (the spike is not attributed to run_shell)");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === "--witness") {
    process.exitCode = witness();
  } else if (mode === "sample") {
    await sample(Number(process.argv[3]), process.argv[4], Number(process.argv[5]), process.argv[6]);
  } else {
    console.error("usage: node scripts/rss-sampler.mjs --witness | sample <pid> <run-log> <seconds> <out>");
    process.exitCode = 2;
  }
}
