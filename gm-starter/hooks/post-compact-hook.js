#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  const lastSkill = fs.readFileSync(path.join(process.cwd(), '.gm', 'lastskill'), 'utf8').trim();
  if (lastSkill) {
    process.stdout.write(JSON.stringify({
      type: 'text',
      text: `Last active skill before compaction: \`${lastSkill}\`. Invoke the Skill tool with skill: "${lastSkill}" to resume it.`
    }) + '\n');
  }
} catch (_) {}
