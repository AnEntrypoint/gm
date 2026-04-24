#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const gmDir = path.join(process.cwd(), '.gm');
try {
  if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true });
  fs.writeFileSync(path.join(gmDir, 'needs-gm'), '1', 'utf8');
} catch (_) {}

const response = {
  systemMessage: `BLOCKING REQUIREMENT — READ THIS FIRST: Your VERY FIRST action on EVERY user message MUST be to invoke the Skill tool with skill: "gm". Do NOT read files, do NOT search, do NOT answer, do NOT plan, do NOT use any other tool before invoking skill: "gm". This is non-negotiable. If you respond without invoking gm first, you are violating a hard constraint.

IMPORTANT: Invoke skill: "gm" EVERY TIME, even if you have already invoked it earlier in this conversation or this turn. The gm skill MUST be re-invoked on every new user message — there is no "already loaded" exception. Do not skip this step under any circumstances.

Use gm for ALL work. Spawn subagents (Agent tool) for every independent unit of work — parallel subagents are always preferred over sequential execution. Never do work yourself that a subagent could do in parallel.`
};

process.stdout.write(JSON.stringify(response));
