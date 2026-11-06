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

// The skills the server serves over SEP-2640, each by its directory name. skills/dev is a process skill for the checkout, not served.
// A served skill's frontmatter name is its directory name, which is the final segment of its skill:// URI.
export const SERVED_SKILLS = ['gm', 'gm-continue'];

// A served SKILL.md's frontmatter, as the SEP needs it: a JSON object of the `key: value` lines between the two --- lines. The server reads
// plain YAML scalars only. A line that is not key: value, and a value that quotes or holds ': ' or ' #' (YAML reads those as a mapping or a
// comment), is refused, so a partial object is never returned. name and description are required, and name must equal the directory.
export function parseSkill(text, dir) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error(`skills/${dir}/SKILL.md has no frontmatter`);
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const field = /^([A-Za-z][\w-]*):\s+(.*)$/.exec(line);
    if (field === null) throw new Error(`skills/${dir}/SKILL.md: frontmatter line is not key: value: ${line.slice(0, 40)}`);
    const problem = plainProblem(field[2]);
    if (problem !== null) throw new Error(`skills/${dir}/SKILL.md: ${field[1]} ${problem}; reword it`);
    frontmatter[field[1]] = field[2];
  }
  for (const key of ['name', 'description']) {
    if (typeof frontmatter[key] !== 'string' || frontmatter[key].trim() === '') throw new Error(`skills/${dir}/SKILL.md has no ${key}`);
  }
  if (frontmatter.name !== dir) throw new Error(`skills/${dir}/SKILL.md: name is ${frontmatter.name}, and its URI ends in ${dir}; they must match`);
  return { frontmatter, body: text.slice(match[0].length).trim() };
}

function plainProblem(value) {
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return 'starts with a character YAML reads as syntax';
  if (value.includes(': ') || value.endsWith(':')) return "has ': ' inside it, which YAML reads as a mapping";
  if (value.includes(' #')) return "has ' #' inside it, which YAML reads as a comment";
  return null;
}

// The default surface serves next_context, run_code and finish, and every other verb is a function on gm inside run_code. A skill
// that names a verb or a tool without the gm. prefix names a tool the default does not serve, so the gate refuses it. The names are
// read when the check runs, because git.mjs imports the gate.
const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'stat_file', 'list_dir', 'run_shell', 'job_start', 'job_status', 'job_stop', 'query_log'];

export function unservedNames() {
  return [...FILE_TOOLS, ...SEARCH_TOOLS, ...WIKI_TOOLS, ...REVIEW_TOOLS,...FETCH_TOOLS, ...CODE_TOOLS, ...GIT_TOOLS, ...ROW_TOOLS].map((tool) => (typeof tool === 'string' ? tool : tool.name));
}

export function ruleBodies() {
  return MCP_RULES.split('\n').filter((line) => /^\d+\. /.test(line)).map((line) => line.replace(/^\d+\. /, ''));
}

// The skills under skills/, each SKILL.md. A bare name of an unserved tool, that is not written as gm.<name>, is a finding. The gm skill
// holds each rule word for word. The check reads the skill without its gm. prefix, so a verb may be written as gm.query_log.
function skillFiles(dir, rel = '') {
  const files = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...skillFiles(dir, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function bareNames(text, names) {
  return names.filter((name) => new RegExp(`(?<![\\w.])${name}\\b`).test(text));
}

export function skillCheck(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return { ok: true, detail: 'no skills' };
  const names = unservedNames();
  const findings = [];
  let count = 0;
  let servedFiles = 0;
  for (const skill of readdirSync(dir)) {
    const file = join(dir, skill, 'SKILL.md');
    if (!existsSync(file)) continue;
    count += 1;
    const text = readFileSync(file, 'utf8');
    for (const name of bareNames(text, names)) findings.push(`${skill} names ${name} without gm.`);
    if (skill === 'gm') {
      const plain = text.replace(/\bgm\./g, '');
      for (const rule of ruleBodies()) if (!plain.includes(rule)) findings.push(`gm skill lacks rule: ${rule.slice(0, 60)}`);
    }
  }
  for (const skill of SERVED_SKILLS) {
    const base = join(dir, skill);
    if (!existsSync(base)) {
      findings.push(`skills/${skill} is missing`);
      continue;
    }
    try {
      parseSkill(readFileSync(join(base, 'SKILL.md'), 'utf8'), skill);
    } catch (err) {
      findings.push(err.message);
    }
    if (!existsSync(join(base, 'WORKFLOWS.md')) && skill === 'gm') findings.push('skills/gm/WORKFLOWS.md is missing');
    for (const path of skillFiles(base)) {
      if (path === 'SKILL.md') continue;
      servedFiles += 1;
      const text = readFileSync(join(base, path), 'utf8');
      for (const name of bareNames(text, names)) findings.push(`skills/${skill}/${path} names ${name} without gm.`);
    }
  }
  return findings.length
    ? { ok: false, detail: findings.slice(0, 3).join(' | ') }
    : { ok: true, detail: `${count} skill(s) and ${servedFiles} served skill file(s) name only served tools; ${SERVED_SKILLS.join(', ')} parse as served skills` };
}
