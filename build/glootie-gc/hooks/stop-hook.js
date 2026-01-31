#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.cwd();
const prdFile = path.join(projectDir, '.prd');

let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });

const run = () => {
  if (aborted) return { ok: true };

  try {
    // Check if .prd file exists and has content
    if (fs.existsSync(prdFile)) {
      const prdContent = fs.readFileSync(prdFile, 'utf-8').trim();
      if (prdContent.length > 0) {
        // .prd has content, block stopping
        return {
          ok: false,
          reason: `Work items remain in ${prdFile}. Remove completed items as they finish. Current items:\n\n${prdContent}`
        };
      }
    }

    // .prd doesn't exist or is empty, allow stop
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
