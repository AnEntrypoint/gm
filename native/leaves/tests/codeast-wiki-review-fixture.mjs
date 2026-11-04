import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const FIXED_DATE = '2026-01-02T03:04:05Z';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE };

export const SOURCE_ID = '0123456789ab';
export const OTHER_SOURCE_ID = 'abcdef012345';

const TRACKED = {
  'src/a.mjs': "import { beta } from './b.mjs';\nexport function alpha(x) {\n  return beta(x) + 1;\n}\n",
  'src/b.mjs': 'export function beta(y) {\n  return y * 2;\n}\nexport const holder = { run() { return beta(3); } };\n',
  'src/c.cjs': "const { alpha } = require('./a.mjs');\nmodule.exports = function wrap() {\n  return alpha(2) + this.alpha(1);\n};\n",
  'src/d.ts': "import { alpha } from './a';\nfunction gamma(): number { return alpha(5); }\n",
  'src/e.mjs': "import './c.cjs';\nexport const unused = 1;\n",
  'src/f.mjs': "import { unused } from './e.mjs';\nexport const more = unused;\n",
  'src/bad.js': '// alpha(0) in a comment\nfunction (( alpha(9)\nconst delta = alpha(4);\n',
  'vendor/v.js': 'alpha();\n',
  'docs/spec.md': '# Spec\n\nThe alpha function adds one to beta.\n',
  [`sources/${SOURCE_ID}.txt`]: 'The sky is blue. Water is wet. Caf\\u00e9 is open.\n',
  [`sources/${OTHER_SOURCE_ID}.txt`]: 'Grass is green.\n',
  'sources/index.jsonl': `${JSON.stringify({ url: 'https://example.com/sky', id: SOURCE_ID, at: '2026-01-01T00:00:00.000Z' })}\n${JSON.stringify({ url: 'https://example.com/sky', id: OTHER_SOURCE_ID, at: '2026-03-01T00:00:00.000Z' })}\n`,
  'wiki/index.md': '# Index\n\n- [[sky]] - The sky\n- [[water]] - Water\n- [[ghost]] - Missing page\n',
  'wiki/log.md': '# Log\n\n## [2026-01-01] ingest | Sky\n## [2026-01-01] ingest | Water\n',
  'wiki/sky.md': `---\ntitle: "Sky"\nupdated: "2026-02-01T00:00:00.000Z"\nsources: ["${SOURCE_ID}"]\nclaims: [{"quote":"The sky is blue.","source":"${SOURCE_ID}"}]\ncontradicts: ["water"]\nresolves: []\n---\nThe sky is blue, see [[water]] and [[nowhere]].\nBlue skies and blue water.\n`,
  'wiki/water.md': `---\ntitle: "Water"\nupdated: "2026-01-15T00:00:00.000Z"\nsources: ["${SOURCE_ID}"]\nclaims: [{"quote":"Water is dry.","source":"${SOURCE_ID}"},{"quote":"Grass","source":"${OTHER_SOURCE_ID}"}]\ncontradicts: []\nresolves: ["sky"]\n---\nWater is wet, unlike the [[sky]].\n`,
  'wiki/orphan.md': `---\ntitle: "Orphan"\nupdated: "2026-01-15T00:00:00.000Z"\nsources: ["ffffffffffff"]\nclaims: []\ncontradicts: ["nobody"]\nresolves: ["noone"]\n---\nAlone.\n`,
  'wiki/broken.md': 'no frontmatter here\n',
};

const UNTRACKED = {
  'src/u.js': 'alpha(7);\n',
};

export function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function writeAll(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

export function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'leaf-cwr-'));
  git(root, ['init', '-q', '-b', 'main']);
  writeAll(root, TRACKED);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture']);
  writeAll(root, UNTRACKED);
  return root;
}

export const removeFixture = (root) => rmSync(root, { recursive: true, force: true });

export function nativeHost(workspace, runDir, { page = 37 } = {}) {
  const calls = [];
  let seq = 0;
  const logPath = join(runDir, 'log.jsonl');
  const fail = (error) => ({ ok: false, error });
  return {
    calls,
    workspace,
    runDir,
    run({ argv, cwd, stdin, timeoutMs }) {
      calls.push(['run', argv]);
      const r = spawnSync(argv[0], argv.slice(1), { cwd, input: stdin, timeout: timeoutMs, encoding: 'utf8', env: GIT_ENV });
      return { started: !r.error || r.error.code === 'ETIMEDOUT', exitCode: r.status ?? -1, timedOut: r.error?.code === 'ETIMEDOUT', out: r.stdout ?? '', err: r.stderr ?? '' };
    },
    read_file({ path, unit = 'lines', offset = 0, limit }) {
      calls.push(['read_file', path]);
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch (e) {
        return fail(e.message);
      }
      if (unit !== 'chars') return { ok: true, output: text, next: null };
      const end = Math.min(offset + Math.min(limit ?? page, page), text.length);
      return { ok: true, output: text.slice(offset, end), total: text.length, offset, next: end < text.length ? end : null };
    },
    write_file({ path, content }) {
      calls.push(['write_file', path]);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return { ok: true, output: `wrote ${path}` };
    },
    stat_file({ path }) {
      try {
        const info = statSync(path);
        return { ok: true, output: JSON.stringify({ type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', size: info.size, mtime: info.mtime.toISOString() }) };
      } catch (e) {
        return fail(e.message);
      }
    },
    list_dir({ path }) {
      try {
        return { ok: true, output: readdirSync(path, { withFileTypes: true }).map((entry) => entry.name + (entry.isDirectory() ? '/' : '')).sort().join('\n') };
      } catch (e) {
        return fail(e.message);
      }
    },
    logAppend({ kind, fields }) {
      seq += 1;
      calls.push(['logAppend', kind, fields]);
      appendFileSync(logPath, `${JSON.stringify({ seq, kind, ...fields })}\n`);
      return { ok: true, seq };
    },
    appendRaw(event) {
      seq += 1;
      appendFileSync(logPath, `${JSON.stringify({ seq, ...event })}\n`);
      return seq;
    },
  };
}
