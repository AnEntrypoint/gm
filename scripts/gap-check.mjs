import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseStream, verbsOf } from "./rss-sampler.mjs";

const MIN_GAP_MS = 55000;

export function largestGap(run, verbs) {
  const own = verbsOf(run, verbs);
  let from = run.start;
  let best = { start: run.start, end: run.start, before: "run start", after: "run end" };
  let previous = "run start";
  for (const v of own) {
    if (v.start - from > best.end - best.start) best = { start: from, end: v.start, before: previous, after: v.seq + " " + v.tool };
    from = Math.max(from, v.end);
    previous = v.seq + " " + v.tool;
  }
  if (run.end - from > best.end - best.start) best = { start: from, end: run.end, before: previous, after: "run end" };
  return best;
}

export function rssAt(samples, at) {
  let found = null;
  for (const s of samples) if (s.at <= at) found = s;
  return found;
}

export function gapReport(parsed) {
  const reports = [];
  for (const run of parsed.events) {
    if (run.tool !== "run_code" || run.end - run.start < MIN_GAP_MS) continue;
    const gap = largestGap(run, parsed.verbs);
    const inside = parsed.samples.filter((s) => s.at >= gap.start && s.at <= gap.end);
    const first = rssAt(parsed.samples, gap.start);
    const last = rssAt(parsed.samples, gap.end);
    const peak = inside.reduce((m, s) => Math.max(m, s.kb), 0);
    reports.push({
      seq: run.seq,
      actionSeq: run.actionSeq,
      durationMs: run.end - run.start,
      gapMs: gap.end - gap.start,
      gapStart: gap.start,
      gapEnd: gap.end,
      before: gap.before,
      after: gap.after,
      startKb: first ? first.kb : null,
      endKb: last ? last.kb : null,
      peakKb: peak,
    });
  }
  return reports;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function line(report) {
  const growth = report.endKb !== null && report.startKb !== null ? report.endKb - report.startKb : 0;
  return "run " + report.seq + " (actionSeq " + report.actionSeq + ") duration " + report.durationMs + " ms; largest verb-free stretch " + report.gapMs + " ms from " + iso(report.gapStart) + " to " + iso(report.gapEnd) + " (after " + report.before + ", before " + report.after + "); RSS " + report.startKb + " KB -> " + report.endKb + " KB (growth " + growth + " KB, peak " + report.peakKb + " KB)";
}

export function check(path) {
  const parsed = parseStream(readFileSync(path, "utf8"));
  const reports = gapReport(parsed);
  for (const report of reports) console.log(line(report));
  const ok = reports.some((r) => r.gapMs >= MIN_GAP_MS);
  console.log(ok ? "gap-check: ok (a run_code has a verb-free stretch of at least 55 s)" : "gap-check: no run_code with a verb-free stretch of at least 55 s");
  return ok ? 0 : 1;
}

function witness() {
  const fixture = [];
  for (let t = 0; t <= 62; t++) {
    const kb = t < 3 ? 760000 : 760000 + 5000 * (t - 2);
    fixture.push("S " + iso(Date.parse("2026-11-19T10:00:00.000Z") + t * 1000) + " " + kb);
  }
  fixture.push("E 2026-11-19T10:00:00.000Z 2026-11-19T10:01:02.000Z 20 run_code 50");
  fixture.push("V 2026-11-19T10:00:00.000Z 2026-11-19T10:00:01.000Z 11 read_file 50");
  const parsed = parseStream(fixture.join("\n"));
  const reports = gapReport(parsed);
  const r = reports[0];
  const ok = reports.length === 1 && r.gapMs === 61000 && r.before === "11 read_file" && r.startKb === 760000 + 5000 * 0 && r.endKb === 760000 + 5000 * 60 && r.peakKb === 1060000;
  console.log(reports.length === 1 ? line(r) : "no run found");
  console.log(ok ? "check-gap-stretch: ok (the verb-free stretch after read_file is found, with its RSS growth)" : "check-gap-stretch: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--witness") {
    process.exitCode = witness();
  } else if (process.argv[2]) {
    process.exitCode = check(process.argv[2]);
  } else {
    console.error("usage: node scripts/gap-check.mjs <stream> | --witness");
    process.exitCode = 2;
  }
}
