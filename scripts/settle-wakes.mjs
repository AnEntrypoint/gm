import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseWake, rates } from "./wake-reader.mjs";

const FIXED = fileURLToPath(new URL("./fixtures/settle-wakes-head.txt", import.meta.url));
const PAUSED = fileURLToPath(new URL("./fixtures/settle-wakes-1ms.txt", import.meta.url));
const TRIM = 3;

export function summary(path) {
  const rows = rates(parseWake(readFileSync(path, "utf8")));
  const body = rows.slice(TRIM, rows.length - TRIM);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { seconds: body.length, wakes: mean(body.map((r) => r.wakesPerSec)), cpu: mean(body.map((r) => r.cpuPercent)) };
}

export function witness(fixedPath = FIXED, pausedPath = PAUSED) {
  const fixed = summary(fixedPath);
  const paused = summary(pausedPath);
  const ok = fixed.wakes < 50 && paused.wakes > 500 && fixed.cpu < paused.cpu;
  console.log("loop wait (HEAD): " + fixed.wakes.toFixed(1) + " wakes/s, " + fixed.cpu.toFixed(2) + "% CPU over " + fixed.seconds + " s of a verbless 60 s body");
  console.log("1 ms pause: " + paused.wakes.toFixed(1) + " wakes/s, " + paused.cpu.toFixed(2) + "% CPU over " + paused.seconds + " s of the same body");
  console.log(ok ? "check-settle-wakes: ok (the 1 ms pause costs about 60 times the wakeups of the loop wait)" : "check-settle-wakes: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--witness") {
    process.exitCode = witness();
  } else {
    console.error("usage: node scripts/settle-wakes.mjs --witness");
    process.exitCode = 2;
  }
}
