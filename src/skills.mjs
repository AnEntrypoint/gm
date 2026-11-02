import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_TOOLS } from './code-ast.mjs';
import { WIKI_TOOLS } from './wiki-tools.mjs';
import { REVIEW_TOOLS } from './review-tools.mjs';
import { FETCH_TOOLS } from './fetch.mjs';
import { GIT_TOOLS } from './git.mjs';
import { ROW_TOOLS } from './rows.mjs';
import { SEARCH_TOOLS } from './search.mjs';
import { MCP_RULES } from './prompt.mjs';

// The default surface serves next_context, run_code and finish, and every other verb is a function on gm inside run_code. A skill
// that names a verb or a tool without the gm. prefix names a tool the default does not serve, so the gate refuses it. The names are
// read when the check runs, because git.mjs imports the gate.
const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'stat_file', 'list_dir', 'run_shell', 'job_start', 'job_status', 'query_log'];

export function unservedNames() {
  return [...FILE_TOOLS, ...SEARCH_TOOLS, ...WIKI_TOOLS, ...REVIEW_TOOLS,...FETCH_TOOLS, ...CODE_TOOLS, ...GIT_TOOLS, ...ROW_TOOLS].map((tool) => (typeof tool === 'string' ? tool : tool.name));
}

// The rules of an MCP run, one per line, without their numbers.
export function ruleBodies() {
  return MCP_RULES.split('\n').filter((line) => /^\d+\. /.test(line)).map((line) => line.replace(/^\d+\. /, ''));
}

// The skills under skills/, each SKILL.md. A bare name of an unserved tool, that is not written as gm.<name>, is a finding. The gm skill
// holds each rule word for word. The check reads the skill without its gm. prefix, so a verb may be written as gm.query_log.
export function skillCheck(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return { ok: true, detail: 'no skills' };
  const names = unservedNames();
  const findings = [];
  let count = 0;
  for (const skill of readdirSync(dir)) {
    const file = join(dir, skill, 'SKILL.md');
    if (!existsSync(file)) continue;
    count += 1;
    const text = readFileSync(file, 'utf8');
    for (const name of names) {
      if (new RegExp(`(?<![\\w.])${name}\\b`).test(text)) findings.push(`${skill} names ${name} without gm.`);
    }
    if (skill === 'gm') {
      const plain = text.replace(/\bgm\./g, '');
      for (const rule of ruleBodies()) if (!plain.includes(rule)) findings.push(`gm skill lacks rule: ${rule.slice(0, 60)}`);
    }
  }
  return findings.length ? { ok: false, detail: findings.slice(0, 3).join(' | ') } : { ok: true, detail: `${count} skill(s) name only served tools` };
}
