import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BASE = "https://www.spawn.co";
const TOKEN_FILE = process.env.SPAWN_TOKEN_FILE || "/config/.spawn/token";
const APP_ID = "d21d322b-4572-4710-a8d5-eaef4e6daa1f";
const WORLD_ID = "26f64424-cc19-43af-a9c3-666e4559bb05";

const READS = {
  me: () => ({ path: "/api/agent/v1/me" }),
  worlds: () => ({ path: "/api/agent/v1/worlds" }),
  inbox: () => ({ path: "/api/agent/v1/chat/inbox" }),
  docs: ([world = WORLD_ID, section = "all"]) => ({ path: `/api/sdk/v1/${world}/agent/docs?section=${encodeURIComponent(section)}` }),
  rooms: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/agent/rooms` }),
  logs: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/logs` }),
  health: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/agent/health` }),
};

const WRITES = {
  publish: ([appId = APP_ID]) => ({ method: "POST", path: `/api/games/${appId}/publish`, body: {} }),
  "crew-ask": ([appId = APP_ID]) => ({ method: "POST", path: `/api/games/${appId}/crew/ask`, body: {} }),
  "chat-room": ([text, room = "main", world = WORLD_ID, replyTo]) => {
    if (!text) throw new Error("chat-room needs text");
    const body = { world, room, text };
    if (replyTo !== undefined) body.replyTo = Number(replyTo);
    return { method: "POST", path: "/api/agent/v1/chat/room", body };
  },
};

const GIT_PUSH = (dir) => ({ git: true, dir });

const argv = process.argv.slice(2);
const confirm = argv.includes("--yes");
const [verb, ...rest] = argv.filter((a) => a !== "--yes");

function usage() {
  return `usage: node tools/spawn.mjs <verb> [args] [--yes]
reads (GET, always sent):
  me | worlds | inbox
  docs [worldId] [section]        Tome reference, one section or all
  rooms|logs|health [worldId]     live rooms, script log, health
writes (dry run unless --yes):
  publish [appId]                 publish the current main to the public page
  crew-ask [appId]                knock to join another person's world
  chat-room <text> [room] [worldId] [replyTo]
  push <cloneDir>                 git push origin main in a clone
The token is read from ${TOKEN_FILE} and is never printed.`;
}

if (!verb || (!READS[verb] && !WRITES[verb] && verb !== "push")) {
  console.error(usage());
  process.exit(verb ? 2 : 0);
}

function token() {
  return readFileSync(TOKEN_FILE, "utf8").trim();
}

async function send({ method = "GET", path, body }) {
  const headers = { Authorization: `Bearer ${token()}`, Accept: "application/json, text/plain" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${verb} failed: HTTP ${res.status}`);
    process.exit(1);
  }
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

if (READS[verb]) {
  await send({ ...READS[verb](rest) });
} else if (verb === "push") {
  const [dir] = rest;
  if (!dir) {
    console.error(usage());
    process.exit(2);
  }
  const cmd = ["-C", dir, "push", "origin", "HEAD:main"];
  if (!confirm) {
    console.log(`dry run: git ${cmd.join(" ")}`);
    console.log("add --yes to push");
    process.exit(0);
  }
  const r = spawnSync("git", cmd, { encoding: "utf8" });
  process.stdout.write(r.stdout + r.stderr);
  process.exit(r.status ?? 1);
} else {
  let request;
  try {
    request = WRITES[verb](rest);
  } catch (err) {
    console.error(`${verb}: ${err.message}`);
    console.error(usage());
    process.exit(2);
  }
  if (!confirm) {
    console.log(`dry run: ${request.method} ${BASE}${request.path}`);
    console.log(`body: ${JSON.stringify(request.body)}`);
    console.log("add --yes to send");
    process.exit(0);
  }
  await send(request);
}
