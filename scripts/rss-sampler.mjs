import { appendFileSync, openSync, readSync, closeSync, statSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SPIKE_KB = 65536;
const SAMPLE_MS = 1000;

export function parseStream(text) {
  const samples = [];
  const events = [];
  const verbs = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(" ");
    if (parts[0] === "S" && parts.length === 3) {
      samples.push({ at: Date.parse(parts[1]), kb: Number(parts[2]) });
    } else if (parts[0] === "E" && parts.length >= 5) {
      events.push({ start: Date.parse(parts[1]), end: Date.parse(parts[2]), seq: parts[3], tool: parts[4], actionSeq: parts[5] || "-" });
    } else if (parts[0] === "V" && parts.length === 6) {
      verbs.push({ start: Date.parse(parts[1]), end: Date.parse(parts[2]), seq: parts[3], tool: parts[4], body: parts[5] });
    }
  }
  return { samples, events, verbs };
}

export function verbsOf(runCode, verbs) {
  return verbs.filter((v) => v.body === runCode.actionSeq).sort((a, b) => a.start - b.start);
}

export function attribute(prev, cur, events) {
  return events.filter((e) => e.start < cur.at && e.end >= prev.at);
}

export function attributeVerbs(prev, cur, verbs) {
  return verbs.filter((v) => v.start < cur.at && v.end >= prev.at);
}

export function spikes(samples, events, verbs) {
  const found = [];
  for (let i = 1; i < samples.length; i++) {
    const step = samples[i].kb - samples[i - 1].kb;
    if (step < SPIKE_KB) continue;
    found.push({
      at: samples[i].at,
      kb: samples[i].kb,
      step,
      hits: attribute(samples[i - 1], samples[i], events),
      verbHits: attributeVerbs(samples[i - 1], samples[i], verbs),
    });
  }
  return found;
}

export function recordLine(record) {
  if (typeof record.durMs !== "number" || typeof record.t !== "string") return null;
  const end = Date.parse(record.t);
  const start = end - record.durMs;
  const span = new Date(start).toISOString() + " " + new Date(end).toISOString();
  if (record.kind === "code-call" && record.body !== undefined) {
    return "V " + span + " " + record.seq + " " + record.tool + " " + record.body;
  }
  if (record.kind === "code-call" || record.kind === "result") {
    return "E " + span + " " + record.seq + " " + (record.tool || "run") + " " + (record.actionSeq ?? "-");
  }
  if (record.kind === "job") return "E " + span + " " + record.seq + " job -";
  return null;
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
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (err) {
    return { text: "", offset };
  }
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
      const out = recordLine(record);
      if (out) appendFileSync(outPath, out + "\n");
    }
    if (Date.now() - began >= seconds * 1000) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, tick + SAMPLE_MS - Date.now())));
  }
}

function describeSpike(spike, parsed) {
  const iso = (ms) => new Date(ms).toISOString();
  const verbText = spike.verbHits.length ? spike.verbHits.map((v) => v.seq + " " + v.tool).join(",") : "nothing";
  const parents = spike.hits.filter((e) => e.actionSeq !== "-" || e.tool === "run_code").map((e) => e.seq + " " + e.tool);
  const sequence = parents.map((p) => {
    const run = parsed.events.find((e) => e.seq === p.split(" ")[0]);
    return run ? verbsOf(run, parsed.verbs).map((v) => v.seq + " " + v.tool + " " + iso(v.start) + "-" + iso(v.end)).join(" | ") : "";
  });
  return iso(spike.at) + " step " + spike.step + " KB; verb " + verbText + "; run " + (parents.join(",") || "none") + (sequence.some((s) => s) ? "; verbs of run: " + sequence.filter((s) => s).join(" || ") : "");
}

function witness() {
  const fixture = [
    "S 2026-11-19T10:00:00.000Z 760000",
    "S 2026-11-19T10:00:01.000Z 760100",
    "S 2026-11-19T10:00:02.000Z 760200",
    "S 2026-11-19T10:00:03.000Z 760200",
    "S 2026-11-19T10:00:04.000Z 760300",
    "S 2026-11-19T10:00:05.000Z 760300",
    "S 2026-11-19T10:00:06.000Z 1310000",
    "S 2026-11-19T10:00:07.000Z 760300",
    "S 2026-11-19T10:00:08.000Z 760300",
    "S 2026-11-19T10:00:09.000Z 760300",
    "E 2026-11-19T10:00:00.000Z 2026-11-19T10:00:09.000Z 20 run_code 50",
    "V 2026-11-19T10:00:01.000Z 2026-11-19T10:00:02.000Z 11 write_file 50",
    "V 2026-11-19T10:00:05.000Z 2026-11-19T10:00:07.000Z 12 run_shell 50",
  ].join("\n");
  const parsed = parseStream(fixture);
  const found = spikes(parsed.samples, parsed.events, parsed.verbs);
  const sequence = verbsOf(parsed.events[0], parsed.verbs).map((v) => v.seq + " " + v.tool).join(",");
  const verbHit = found.length === 1 && found[0].verbHits.length === 1 ? found[0].verbHits[0].seq + " " + found[0].verbHits[0].tool : "nothing";
  const ok = found.length === 1 && verbHit === "12 run_shell" && sequence === "11 write_file,12 run_shell";
  console.log("spikes " + found.length + " at " + (found[0] ? new Date(found[0].at).toISOString() : "none") + " step " + (found[0] ? found[0].step : 0) + " KB attributed to verb " + verbHit + " of run_code 20 (verbs of run_code 20: " + sequence + ")");
  console.log(ok ? "check-rss-verbs: ok (the spike is attributed to the verb it sits in, not to run_code)" : "check-rss-verbs: FAILED (the spike is not attributed to run_shell inside run_code 20)");
  return ok ? 0 : 1;
}

function report(path) {
  const parsed = parseStream(readFileSync(path, "utf8"));
  for (const spike of spikes(parsed.samples, parsed.events, parsed.verbs)) console.log(describeSpike(spike, parsed));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === "--witness") {
    process.exitCode = witness();
  } else if (mode === "sample") {
    await sample(Number(process.argv[3]), process.argv[4], Number(process.argv[5]), process.argv[6]);
  } else if (mode === "report") {
    process.exitCode = report(process.argv[3]);
  } else {
    console.error("usage: node scripts/rss-sampler.mjs --witness | sample <pid> <run-log> <seconds> <out> | report <stream>");
    process.exitCode = 2;
  }
}
