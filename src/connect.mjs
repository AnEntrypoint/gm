import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// What the host reads once, when it connects: the server name and title, the capabilities and the instructions in the initialize reply, and the
// relay file the host runs. The host does not read them again when the server reloads, so a change to any of them needs a reconnect.
// connectCheck compares them with CONNECT_SHA, and a change fails the gate until its new value is recorded here, which is the owner's
// acceptance of that reconnect (DESIGN.md, Reconnect).
export const SERVER_NAME = 'gm';
export const SERVER_TITLE = 'gm run worker';
export const CAPABILITIES = { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true, subscribe: true }, logging: {}, completions: {}, extensions: { 'io.modelcontextprotocol/skills': {} } };

const CODE_INSTRUCTIONS = "One tool does the work: run_code. Its body is JavaScript in the project, and each verb is a function on gm, for example await gm.read_file({ path }). The verb list is in run_code's description, gm.verbs() returns each verb's details, and finish ends the run and is not a verb. Start each step with next_context.";
const TOOLS_INSTRUCTIONS = "Each verb is a tool. Start each step with next_context, and end the run with finish and a witness.";
const RESOURCES_POINTER = "Resources: skill://<name>/<file> reads a served skill file. run://<run>/log reads a run's event log, and run://<run>/witness its witness; resources/templates/list names the templates. Subscribe to a skill file with resources/subscribe to be told when it changes on disk. Log messages follow logging/setLevel, and completion/complete suggests skill names and run ids.";
// The rules of a run and the routes for pending events are in the gm skill, which next_context names each step. They are not repeated here,
// so a change to the rules or the routes is a change to the skill and needs no reconnect.
const SKILL_POINTER = 'The gm skill holds the rules of a run, the routes for pending events, and the way to hand work to a child session. Read it when a run starts, and read it again after a compaction. Read skill://gm/SKILL.md with ReadMcpResourceTool (server gm), or run the gm prompt (mcp__gm__gm). The host\'s Skill tool does not list it, so do not call it with the Skill tool. The gm-continue skill plans the open rows of gm and hands them to the gm skill. Read skill://gm-continue/SKILL.md with ReadMcpResourceTool (server gm), or run the gm-continue prompt (mcp__gm__gm-continue). The host\'s Skill tool does not list it, so do not call it with the Skill tool.';

export function connectReply(surface) {
  return { capabilities: CAPABILITIES, instructions: `${surface === 'code' ? CODE_INSTRUCTIONS : TOOLS_INSTRUCTIONS}\n\n${RESOURCES_POINTER}\n\n${SKILL_POINTER}` };
}

export function connectSha(root) {
  const text = JSON.stringify({ name: SERVER_NAME, title: SERVER_TITLE, capabilities: CAPABILITIES, code: connectReply('code').instructions, tools: connectReply('tools').instructions });
  return createHash('sha256').update(text).update(readFileSync(join(root, 'tools', 'relay.mjs'))).digest('hex');
}

// Recorded when the owner accepts the connect-time text as it is now. It is the value connectSha returns for this checkout.
export const CONNECT_SHA = '5b5766751cef2d91697a89fd339f41b832eb1eed629ce6ba6ce34c97c63d642a';

export function connectCheck(root) {
  const sha = connectSha(root);
  if (sha !== CONNECT_SHA) return { ok: false, detail: `connect-time text changed (${sha.slice(0, 16)}): a host reconnect is needed. Record the value in CONNECT_SHA (src/connect.mjs) once the owner accepts it` };
  return { ok: true, detail: `connect-time text ${sha.slice(0, 16)}` };
}
