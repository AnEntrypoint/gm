import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// What the host reads once, when it connects: the server name, the capabilities and the instructions in the initialize reply, and the
// relay file the host runs. The host does not read them again when the server reloads, so a change to any of them needs a reconnect.
// connectCheck compares them with CONNECT_SHA, and a change fails the gate until its new value is recorded here, which is the owner's
// acceptance of that reconnect (DESIGN.md, Reconnect).
export const SERVER_NAME = 'gm';
export const CAPABILITIES = { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } };

// The instructions the host sees at initialize. The code surface names run_code, and the verbs are functions on gm.
const CODE_INSTRUCTIONS = "One tool does the work: run_code. Its body is JavaScript in the project, and each verb is a function on gm, for example await gm.read_file({ path }). The verb list is in run_code's description, gm.verbs() returns each verb's details, and finish ends the run and is not a verb. Start each step with next_context.";
const TOOLS_INSTRUCTIONS = "Each verb is a tool. Start each step with next_context, and end the run with finish and a witness.";
// The rules of a run and the routes for pending events are in the gm skill, which next_context names each step. They are not repeated here,
// so a change to the rules or the routes is a change to the skill and needs no reconnect.
const SKILL_POINTER = 'The gm skill, resource gm://skill/SKILL.md or the gm prompt, holds the rules of a run, the routes for pending events, and the way to hand work to a child session. Read it when a run starts, and read it again after a compaction.';

export function connectReply(surface) {
  return { capabilities: CAPABILITIES, instructions: `${surface === 'code' ? CODE_INSTRUCTIONS : TOOLS_INSTRUCTIONS}\n\n${SKILL_POINTER}` };
}

// The value the gate expects: the name, the capabilities, the instructions of both surfaces, and the bytes of tools/relay.mjs.
export function connectSha(root) {
  const text = JSON.stringify({ name: SERVER_NAME, capabilities: CAPABILITIES, code: connectReply('code').instructions, tools: connectReply('tools').instructions });
  return createHash('sha256').update(text).update(readFileSync(join(root, 'tools', 'relay.mjs'))).digest('hex');
}

// Recorded when the owner accepts the connect-time text as it is now. It is the value connectSha returns for this checkout.
export const CONNECT_SHA = '740b70f60adc89b8d239a74183d80275bc9fd665180c5bbf045eab3f58d198db';

export function connectCheck(root) {
  const sha = connectSha(root);
  if (sha !== CONNECT_SHA) return { ok: false, detail: `connect-time text changed (${sha.slice(0, 16)}): a host reconnect is needed. Record the value in CONNECT_SHA (src/connect.mjs) once the owner accepts it` };
  return { ok: true, detail: `connect-time text ${sha.slice(0, 16)}` };
}
