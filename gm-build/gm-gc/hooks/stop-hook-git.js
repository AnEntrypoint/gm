#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
const counterPath = path.join(require('os').tmpdir(), 'gm-gc-git-' + crypto.createHash('md5').update(projectDir).digest('hex') + '.json');
const readCounter = () => { try { return JSON.parse(fs.readFileSync(counterPath, 'utf-8')); } catch (e) { return { count: 0, lastHash: null }; } };
const writeCounter = (d) => { try { fs.writeFileSync(counterPath, JSON.stringify(d)); } catch (e) {} };
const gitHash = () => { try { return execSync('git rev-parse HEAD', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim(); } catch (e) { return null; } };
const getStatus = () => {
  try { execSync('git rev-parse --git-dir', { cwd: projectDir, stdio: 'pipe' }); } catch (e) { return null; }
  const status = execSync('git status --porcelain', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
  let unpushed = 0;
  try { unpushed = parseInt(execSync('git rev-list --count @{u}..HEAD', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim()) || 0; } catch (e) { unpushed = -1; }
  return { isDirty: status.length > 0, unpushed };
};
try {
  const st = getStatus();
  if (!st) { console.log(JSON.stringify({ decision: 'approve' })); process.exit(0); }
  const hash = gitHash();
  const counter = readCounter();
  if (counter.lastHash && hash && counter.lastHash !== hash) { counter.count = 0; counter.lastHash = hash; writeCounter(counter); }
  const issues = [];
  if (st.isDirty) issues.push('uncommitted changes');
  if (st.unpushed > 0) issues.push(st.unpushed + ' commit(s) not pushed');
  if (st.unpushed === -1) issues.push('push status unknown');
  if (issues.length > 0) {
    counter.count = (counter.count || 0) + 1;
    counter.lastHash = hash;
    writeCounter(counter);
    if (counter.count === 1) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Git: ' + issues.join(', ') + '. Commit and push before ending session.' }, null, 2));
      process.exit(2);
    }
    console.log(JSON.stringify({ decision: 'approve', reason: 'Git warning #' + counter.count + ': ' + issues.join(', ') }, null, 2));
    process.exit(0);
  }
  if (counter.count > 0) { counter.count = 0; writeCounter(counter); }
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
}
