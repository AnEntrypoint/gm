import { readFileSync } from "node:fs";

const BASE = "https://www.spawn.co";
const TOKEN_FILE = process.env.SPAWN_TOKEN_FILE || "/config/.spawn/token";

const DOORS = {
  me: () => "/api/agent/v1/me",
  worlds: () => "/api/agent/v1/worlds",
  inbox: () => "/api/agent/v1/chat/inbox",
  docs: ([world, section]) => `/api/sdk/v1/${world}/agent/docs?section=${encodeURIComponent(section || "all")}`,
  rooms: ([world]) => `/api/sdk/v1/${world}/agent/rooms`,
  logs: ([world]) => `/api/sdk/v1/${world}/logs`,
  health: ([world]) => `/api/sdk/v1/${world}/agent/health`,
};

const [door, ...args] = process.argv.slice(2);

function usage() {
  return `usage: node tools/spawn-read.mjs <${Object.keys(DOORS).join("|")}> [args]
  me | worlds | inbox                 identity, worlds, chat inbox
  docs <worldId> [section]            Tome reference, one section or all
  rooms|logs|health <worldId>         live rooms, script log, health
Read-only: every call is a GET. The token is read from ${TOKEN_FILE} and never printed.`;
}

if (!door || !DOORS[door]) {
  console.error(usage());
  process.exit(door ? 2 : 0);
}

const needsWorld = ["docs", "rooms", "logs", "health"].includes(door);
if (needsWorld && !args[0]) {
  console.error(usage());
  process.exit(2);
}

const token = readFileSync(TOKEN_FILE, "utf8").trim();
const url = BASE + DOORS[door](args);
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/plain" } });
const body = await res.text();
if (!res.ok) {
  console.error(`${door} failed: HTTP ${res.status}`);
  process.exit(1);
}
process.stdout.write(body.endsWith("\n") ? body : body + "\n");
