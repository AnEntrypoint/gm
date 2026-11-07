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

export const SERVED_SKILLS = ['gm', 'gm-continue'];

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

const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'stat_file', 'list_dir', 'run_shell', 'job_start', 'job_status', 'job_stop', 'query_log', 'task_set'];

export function unservedNames() {
  return [...FILE_TOOLS, ...SEARCH_TOOLS, ...WIKI_TOOLS, ...REVIEW_TOOLS,...FETCH_TOOLS, ...CODE_TOOLS, ...GIT_TOOLS, ...ROW_TOOLS].map((tool) => (typeof tool === 'string' ? tool : tool.name));
}

export function ruleBodies() {
  return MCP_RULES.split('\n').filter((line) => /^\d+\. /.test(line)).map((line) => line.replace(/^\d+\. /, ''));
}

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
