import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { spawnSync } from "node:child_process";

const BASE = "https://www.spawn.co";
const TOKEN_FILE = process.env.SPAWN_TOKEN_FILE || "/config/.spawn/token";
const SPAWN_CLI = process.env.SPAWN_CLI || "/config/.bun/bin/spawn";
const APP_ID = "d21d322b-4572-4710-a8d5-eaef4e6daa1f";
const WORLD_ID = "26f64424-cc19-43af-a9c3-666e4559bb05";
const MOD_VERBS = ["install", "update", "list", "status"];

const READS = {
  me: () => ({ path: "/api/agent/v1/me" }),
  worlds: () => ({ path: "/api/agent/v1/worlds" }),
  inbox: () => ({ path: "/api/agent/v1/chat/inbox" }),
  docs: ([world = WORLD_ID, section = "all"]) => ({ path: `/api/sdk/v1/${world}/agent/docs?section=${encodeURIComponent(section)}` }),
  rooms: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/agent/rooms` }),
  logs: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/logs` }),
  health: ([world = WORLD_ID]) => ({ path: `/api/sdk/v1/${world}/agent/health` }),
};

const need = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const WRITES = {
  publish: ([appId = APP_ID]) => ({ method: "POST", path: `/api/games/${appId}/publish`, body: {} }),
  "crew-ask": ([appId = APP_ID]) => ({ method: "POST", path: `/api/games/${appId}/crew/ask`, body: {} }),
  "chat-room": ([text, room = "main", world = WORLD_ID, replyTo]) => {
    need(text, "chat-room needs text");
    const body = { world, room, text };
    if (replyTo !== undefined) body.replyTo = Number(replyTo);
    return { method: "POST", path: "/api/agent/v1/chat/room", body };
  },
  dm: ([to, text]) => {
    need(to && text, "dm needs a recipient and text");
    return { method: "POST", path: "/api/agent/v1/chat/dm", body: { to, text } };
  },
  exec: ([file, world = WORLD_ID]) => {
    need(file, "exec needs a script file");
    return { method: "POST", path: `/api/sdk/v1/${world}/agent/exec`, body: { script: readFileSync(file, "utf8") } };
  },
  "asset-put": ([file, world = WORLD_ID]) => {
    need(file, "asset-put needs a file");
    const bytes = readFileSync(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ext = extname(file).slice(1) || "bin";
    const name = `value.${sha}.${ext}`;
    return { method: "PUT", path: `/api/sdk/v1/${world}/assets/${name}`, raw: bytes, contentType: "application/octet-stream", name, size: bytes.length };
  },
  mod: ([verb, name]) => {
    need(MOD_VERBS.includes(verb), `mod needs one of ${MOD_VERBS.join("|")}`);
    return { cli: [SPAWN_CLI, "mod", verb, ...(name ? [name] : [])] };
  },
};

const GIT_PUSH_VERB = "push";
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
  dm <to> <text>                  direct message, to is e.g. @alice
  exec <scriptFile> [worldId]     run a read-only script in the live room
  asset-put <file> [worldId]      upload bytes as value.<sha256>.<ext>
  mod <install|update|list|status> [name]   the local spawn CLI's mod verbs
  push <cloneDir>                 git push origin HEAD:main in a clone
The token is read from ${TOKEN_FILE} and is never printed.`;
}

const known = verb && (READS[verb] || WRITES[verb] || verb === GIT_PUSH_VERB);
if (!known) {
  console.error(usage());
  process.exit(verb ? 2 : 0);
}

function token() {
  return readFileSync(TOKEN_FILE, "utf8").trim();
}

async function send({ method = "GET", path, body, raw, contentType, name, size }) {
  const headers = { Authorization: `Bearer ${token()}`, Accept: "application/json, text/plain" };
  let payload;
  if (raw !== undefined) {
    headers["Content-Type"] = contentType;
    payload = raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${verb} failed: HTTP ${res.status}`);
    process.exit(1);
  }
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  if (name) console.error(`uploaded ${name} (${size} bytes)`);
}

function runCli(argvList) {
  const r = spawnSync(argvList[0], argvList.slice(1), { encoding: "utf8" });
  process.stdout.write(r.stdout + r.stderr);
  process.exit(r.status ?? 1);
}

if (READS[verb]) {
  await send(READS[verb](rest));
} else if (verb === GIT_PUSH_VERB) {
  const [dir] = rest;
  need(dir, "push needs a clone directory");
  const cmd = ["-C", dir, "push", "origin", "HEAD:main"];
  if (!confirm) {
    console.log(`dry run: git ${cmd.join(" ")}`);
    console.log("add --yes to push");
    process.exit(0);
  }
  runCli(["git", ...cmd]);
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
    if (request.cli) console.log(`dry run: ${request.cli.join(" ")}`);
    else {
      console.log(`dry run: ${request.method} ${BASE}${request.path}`);
      if (request.name) console.log(`file: ${basename(rest[0])} -> ${request.name} (${request.size} bytes)`);
      if (request.body !== undefined) console.log(`body: ${JSON.stringify(request.body).slice(0, 300)}`);
    }
    console.log("add --yes to send");
    process.exit(0);
  }
  if (request.cli) runCli(request.cli);
  else await send(request);
}
