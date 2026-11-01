import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { runQuery } from './log.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const OUTPUT_CAP = 200000;
const BARRIER = { barrier: true };

export function createTools({ workspace, log }) {
  const root = resolve(workspace);
  const realRoot = realpathSync(root);

  const confine = (rel) => {
    if (typeof rel !== 'string' || rel === '') return { refused: 'path must be a non-empty string' };
    if (rel.split(/[\\/]+/).includes('..')) return { refused: 'path has a .. segment' };
    const target = resolve(root, rel);
    if (!inside(root, target)) return { refused: 'path is outside the workspace' };
    if (!inside(realRoot, realpathSync(nearestExisting(target)))) {
      return { refused: 'path leads through a link outside the workspace' };
    }
    return { path: target };
  };

  const handlers = {
    async read_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      return { ok: true, output: await readFile(at.path, 'utf8') };
    },

    async write_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      if (typeof args.content !== 'string') return { ok: false, error: 'content must be a string' };
      await mkdir(dirname(at.path), { recursive: true });
      await writeFile(at.path, args.content);
      return { ok: true, output: `wrote ${relative(root, at.path)} (${args.content.length} chars)` };
    },

    async list_dir(args) {
      const at = confine(args.path ?? '.');
      if (at.refused) return refusal(at.refused);
      const entries = (await readdir(at.path, { withFileTypes: true }))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return { ok: true, output: entries.join('\n') };
    },

    run_shell(args) {
      if (typeof args.command !== 'string' || args.command.trim() === '') {
        return { ok: false, error: 'command must be a non-empty string' };
      }
      const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      return shell(root, args.command, timeoutMs);
    },

    query_log(args) {
      if (typeof args.js !== 'string') return { ok: false, error: 'js must be a string' };
      return runQuery(log.events(), args.js);
    },

    finish(args) {
      if (typeof args.witness !== 'string' || args.witness.trim() === '') {
        return { ok: false, error: 'finish needs a non-empty witness string' };
      }
      return { ok: true, finished: true, output: args.witness };
    },
  };

  return {
    // Which workspace paths an action reads or writes. An action with no
    // path (or a barrier) is decided by the loop's wave planner.
    access(name, args) {
      if (name === 'job_status') return { items: [] };
      if (name !== 'read_file' && name !== 'list_dir' && name !== 'write_file') return BARRIER;
      const rel = name === 'list_dir' ? (args.path ?? '.') : args.path;
      const path = workspaceSegments(root, rel);
      if (!path) return BARRIER;
      return { items: [{ path, write: name === 'write_file' }] };
    },

    async run(name, args) {
      if (!Object.hasOwn(handlers, name)) return { ok: false, error: `unknown tool: ${name}` };
      try {
        return await handlers[name](args);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

function workspaceSegments(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.split(/[\\/]+/).includes('..')) return null;
  const target = resolve(root, rel);
  if (!inside(root, target)) return null;
  const parts = relative(root, target).split(sep).filter(Boolean);
  return parts;
}

function refusal(reason) {
  return { ok: false, refused: true, error: `refused: ${reason}` };
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
}

function nearestExisting(target) {
  let current = target;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

function shell(cwd, command, timeoutMs) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return new Promise((done) => {
    let output = '';
    const collect = (chunk) => {
      if (output.length < OUTPUT_CAP) output += chunk;
    };
    const child = spawn(command, { cwd, env, shell: true, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => done({ ok: false, error: err.message }));
    child.on('close', (exitCode, signal) => {
      done({ ok: exitCode === 0, exitCode, signal, output: output.slice(0, OUTPUT_CAP) });
    });
  });
}
