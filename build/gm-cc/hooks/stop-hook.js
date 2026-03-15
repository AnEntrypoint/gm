#!/usr/bin/env bun

if (process.env.AGENTGUI_SUBPROCESS === '1') {
  console.log(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

const fs = require('fs');
const path = require('path');

const projectDir = process.cwd();
const prdFile = path.resolve(projectDir, '.prd');

let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });

const run = () => {
  if (aborted) return { ok: true };

  try {
    if (fs.existsSync(prdFile)) {
      const prdContent = fs.readFileSync(prdFile, 'utf-8').trim();
      if (prdContent.length > 0) {
        return {
          ok: false,
          reason: `Work items remain in ${prdFile}. Remove completed items as they finish. Current items:\n\n${prdContent}`
        };
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: true };
  }
};

try {
  const result = run();

  if (!result.ok) {
    console.log(JSON.stringify({
      decision: 'block',
      reason: result.reason
    }, null, 2));
    process.exit(2);
  }

  console.log(JSON.stringify({
    decision: 'approve'
  }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({
    decision: 'approve'
  }, null, 2));
  process.exit(0);
}
