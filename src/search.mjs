import { execFile } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 1000000;
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30000;
const SNIPPET_CHARS = 300;
const OUTPUT_PAGE = 20000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_PATTERN_CHARS = 200;
const MODES = ['literal', 'regex', 'word'];

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const SEARCH_TOOLS = [
  {
    name: 'grep',
    description: 'Find text in git-tracked files. mode is literal (default), regex, or word (a whole identifier). Returns path:line text. ignoreCase is optional; limit is 1 to 1000, default 100.',
    inputSchema: obj({ pattern: str, mode: str, ignoreCase: bool, limit: num, offset: num }, ['pattern']),
  },
];

// Grep reads the git-tracked and untracked text files. Each file is re-read only when its mtime or size changes. Search and the wiki
// are in retrieve.mjs.
export function createSearchVerbs({ root, confine }) {
  const files = new Map();

  return {
    async grep({ pattern, mode = 'literal', ignoreCase = false, limit = DEFAULT_LIMIT, offset = 0 }) {
      if (typeof pattern !== 'string' || pattern === '') return fail('pattern must be a non-empty string');
      if (pattern.length > MAX_PATTERN_CHARS) return fail(`pattern must be at most ${MAX_PATTERN_CHARS} characters`);
      if (!MODES.includes(mode)) return fail(`mode must be one of ${MODES.join(', ')}`);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail(`limit must be an integer from 1 to ${MAX_LIMIT}`);
      let matches;
      try {
        matches = matcherFor(pattern, mode, ignoreCase === true);
      } catch (err) {
        return fail(`bad pattern: ${err.message}`);
      }
      const listed = await loadFiles();
      if (listed.error) return fail(listed.error);
      if (!Number.isInteger(offset) || offset < 0) return fail('offset must be a whole number, zero or more');
      const found = [];
      let total = 0;
      let size = 0;
      let next = null;
      for (const entry of listed.entries) {
        entry.lines.forEach((line, i) => {
          if (!matches(line.text)) return;
          total += 1;
          if (total <= offset || next !== null) return;
          const row = `${entry.rel}:${i + 1} ${snippet(line.text)}`;
          if (found.length >= limit || size + row.length > OUTPUT_PAGE) {
            next = total - 1;
            return;
          }
          found.push(row);
          size += row.length + 1;
        });
      }
      const footer = [`(${total} matches; showing ${found.length ? offset : 0} to ${offset + found.length}; ${next === null ? 'no more' : `next offset ${next}`})`];
      return { ok: true, output: [...found, ...footer].join('\n') };
    },
  };

  async function loadFiles() {
    const tracked = await trackedFiles(root);
    if (tracked.error) return tracked;
    const next = new Map();
    const entries = [];
    for (const rel of tracked.paths) {
      const entry = await loadFile(rel);
      if (entry === null) continue;
      next.set(rel, entry);
      entries.push(entry);
    }
    files.clear();
    for (const [rel, entry] of next) files.set(rel, entry);
    return { entries };
  }

  async function loadFile(rel) {
    const at = confine(rel);
    if (at.refused) return null;
    let info;
    try {
      info = await lstat(at.path);
    } catch {
      return null;
    }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const sig = `${info.mtimeMs}:${info.size}`;
    const known = files.get(rel);
    if (known && known.sig === sig) return known;
    const buffer = await readFile(at.path);
    const binary = buffer.subarray(0, 8000).includes(0);
    const lines = binary ? [] : buffer.toString('utf8').split('\n').map((raw) => ({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw }));
    return { rel, sig, lines };
  }
}

async function trackedFiles(root) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: MAX_LIST_BYTES, timeout: LIST_TIMEOUT_MS });
    return { paths: stdout.split('\0').filter((path) => path !== '') };
  } catch {
    return { error: 'grep needs a git repository: git ls-files failed' };
  }
}

function matcherFor(pattern, mode, ignoreCase) {
  const flags = ignoreCase ? 'i' : '';
  if (mode === 'regex') {
    const re = new RegExp(pattern, flags);
    return (text) => re.test(text);
  }
  if (mode === 'word') {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(pattern)}(?![A-Za-z0-9_])`, flags);
    return (text) => re.test(text);
  }
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  return (text) => (ignoreCase ? text.toLowerCase() : text).includes(needle);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippet(text) {
  return text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS)} ...`;
}

function fail(error) {
  return { ok: false, error };
}
