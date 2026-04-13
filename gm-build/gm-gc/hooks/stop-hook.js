#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const prdFile = path.resolve(process.cwd(), '.prd');
let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });
try {
  if (!aborted && fs.existsSync(prdFile)) {
    const content = fs.readFileSync(prdFile, 'utf-8').trim();
    if (content.length > 0) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Work items remain in .prd. Remove completed items as they finish. Current items:\n\n' + content }, null, 2));
      process.exit(2);
    }
  }
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
}
