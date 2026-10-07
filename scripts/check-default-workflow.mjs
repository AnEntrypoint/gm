import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const gm = read('skills/gm/SKILL.md');
const resume = read('skills/gm-continue/SKILL.md');
const runtime = read('skills/gm/references/runtime.md');
const surfaces = [gm, resume, read('README.md'), read('AGENTS.md'), read('SKILLS.md'), read('CONTRIBUTING.md')];
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }

check('bounded discoverable skills and complete local references', () => {
  for (const [name, text] of [['gm', gm], ['gm-continue', resume]]) {
    assert.match(text, new RegExp('^---\\nname: ' + name + '\\ndescription: .+\\n---'));
    assert.ok(Buffer.byteLength(text) < 10000, name + ' stays under 10 KB');
    assert.ok(!text.includes('disable-model-invocation: true'));
    assert.ok(!text.includes('\u0000'));
  }
  for (const match of gm.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!match[1].includes('://')) assert.ok(fs.existsSync(path.resolve(root, 'skills/gm', match[1])), match[1]);
  }
});
check('default does not require runtime or universal fan-out', () => {
  assert.match(gm, /Default: use the host's existing authorized tools/);
  assert.match(gm, /neither a subagent nor a second opinion is mandatory/);
  assert.deepEqual(JSON.parse(read('.mcp.json')).mcpServers, {});
});
check('two no-progress reads advance and interruption reuses checkpoint', () => {
  assert.match(gm, /After two inspections with no new information/);
  assert.match(gm, /Resume from that checkpoint after interruption/);
  assert.match(gm, /Reuse checks for unaffected code/);
});
check('long work has handles, deadlines and no blind replay', () => {
  assert.match(gm, /finite timeout/);
  assert.match(gm, /Retain the handle returned by the tool/);
  assert.match(gm, /A missing output file is not proof of liveness/);
  assert.match(runtime, /resume_task/);
  assert.match(runtime, /do not resend the mutation/);
});
check('completion and blockers do not recursively reopen finished work', () => {
  assert.match(gm, /Zero remaining in-scope work means finish now/);
  assert.match(resume, /Closed rows are history/);
  assert.match(resume, /summarize and stop on this invocation/);
  assert.match(resume, /External blockers stay blocked unless new evidence/);
  assert.doesNotMatch(resume, /Skill\(skill=/);
});
check('tests, dirty user work and publication boundaries are preserved', () => {
  assert.match(gm, /Preserve and use tests rather than deleting them/);
  assert.match(gm, /Do not reset, clean, stash, delete or stage unrelated changes/);
  assert.match(gm, /only within the user's or project's applicable authorization/);
  for (const text of surfaces) {
    for (const banned of [/No test files, ever/i, /remove any found, same turn/i, /always fan out subagents/i, /There is no other exit/, /dispatch .*anyway, once/]) assert.doesNotMatch(text, banned);
  }
});
check('fork distribution cannot silently target upstream release repository', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.repository.url, 'https://github.com/SolutionsAsService/gm.git');
  assert.ok(pkg.files.includes('LICENSE'));
  const release = read('.github/workflows/skill-release.yml');
  assert.match(release, /workflow_dispatch:/);
  assert.doesNotMatch(release, /AnEntrypoint\/gm|PUBLISHER_TOKEN|git push|^  push:/m);
  assert.ok(release.includes('github.repository'));
  assert.doesNotMatch(read('.github/workflows/gh-pages.yml'), /^  push:/m);
});
check('original licensing and workflow adaptation credit retained', () => {
  for (const p of ['LICENSE', 'skills/gm/references/LICENSE', 'skills/gm-continue/LICENSE']) assert.match(read(p), /Copyright \(c\) 2026 AnEntrypoint/);
  assert.match(gm, /Pimp My Skill · SolutionsAsService/);
});
console.log(checks + ' static contract checks passed. These guard text/config regressions, not model behavior.');
