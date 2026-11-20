import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

const [gmPath, bodyPath, outDir, secondsArg] = process.argv.slice(2);
if (!gmPath || !bodyPath || !outDir) {
  console.error("usage: node scripts/gap-repro.mjs <gm binary> <body file> <out dir> [sampler seconds]");
  process.exit(2);
}
const seconds = Number(secondsArg || 80);
const root = resolve(outDir);
const ws = join(root, "ws");
const runDir = join(ws, "runs", "gap");
const stream = join(root, "stream.txt");
const errLog = join(root, "serve.stderr");
mkdirSync(runDir, { recursive: true });
writeFileSync(stream, "");
writeFileSync(errLog, "");
const body = readFileSync(resolve(bodyPath), "utf8");

function exited(child) {
  return child.exitCode === null ? once(child, "exit") : Promise.resolve();
}

function stopUnder(dir) {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let args = "";
    try {
      args = readFileSync("/proc/" + entry + "/cmdline", "utf8");
    } catch (err) {
      continue;
    }
    if (args.includes(dir)) {
      try {
        process.kill(Number(entry), "SIGKILL");
      } catch (err) {
        continue;
      }
    }
  }
}

function childrenOf(pid) {
  const found = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync("/proc/" + entry + "/stat", "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (ppid === pid) found.push(Number(entry));
    } catch (err) {
      continue;
    }
  }
  return found;
}

function commandOf(pid) {
  try {
    return readFileSync("/proc/" + pid + "/cmdline", "utf8").split("\0").join(" ");
  } catch (err) {
    return "";
  }
}

async function workerOf(serverPid) {
  for (let i = 0; i < 100; i++) {
    for (const child of childrenOf(serverPid)) {
      if (commandOf(child).includes("gm-core")) return child;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return 0;
}

const serve = spawn(resolve(gmPath), ["serve", "--workspace", ws, "--run-dir", runDir], { stdio: ["pipe", "pipe", "pipe"], cwd: ws });
serve.stderr.on("data", (chunk) => appendFileSync(errLog, chunk));
const waiting = new Map();
createInterface({ input: serve.stdout }).on("line", (line) => {
  let message = null;
  try { message = JSON.parse(line); } catch (err) { return; }
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
function call(id, method, params, limitMs) {
  return new Promise((resolveCall, rejectCall) => {
    const timer = setTimeout(() => rejectCall(new Error(method + " timed out after " + limitMs + " ms")), limitMs);
    waiting.set(id, (message) => { clearTimeout(timer); resolveCall(message); });
    serve.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

let worker = 0;
let sampler = null;
let reader = null;
try {
  await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gap-repro", version: "1" } }, 120000);
  serve.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  worker = await workerOf(serve.pid);
  if (!worker) throw new Error("no gm-core worker under serve pid " + serve.pid);
  sampler = spawn(process.execPath, ["scripts/rss-sampler.mjs", "sample", String(worker), join(runDir, "log.jsonl"), String(seconds), stream], { stdio: "inherit" });
  reader = spawn(process.execPath, ["scripts/wake-reader.mjs", "sample", String(worker), join(root, "wake.txt"), String(seconds)], { stdio: "inherit" });
  const started = Date.now();
  const reply = await call(2, "tools/call", { name: "run_code", arguments: { body } }, (seconds + 240) * 1000);
  const text = JSON.stringify(reply).slice(0, 400);
  console.log("body_seconds " + ((Date.now() - started) / 1000).toFixed(2));
  console.log("reply " + text);
  await Promise.all([exited(sampler), exited(reader)]);
  console.log("reader_exit " + reader.exitCode);
  console.log("sampler_exit " + sampler.exitCode);
} finally {
  if (worker && existsSync("/proc/" + worker)) process.kill(worker, "SIGTERM");
  serve.kill("SIGTERM");
  await Promise.race([once(serve, "exit"), new Promise((r) => setTimeout(r, 10000))]);
  if (sampler && sampler.exitCode === null) sampler.kill("SIGTERM");
  if (reader && reader.exitCode === null) reader.kill("SIGTERM");
  stopUnder(root);
  console.log("stopped_serve_pid " + serve.pid + " worker_pid " + worker);
}
try {
  execFileSync(process.execPath, ["scripts/gap-check.mjs", stream], { stdio: "inherit" });
} catch (err) {
  process.exitCode = 1;
}
