import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function realHost(workspace, runDir = workspace) {
  const calls = [];
  return {
    calls,
    workspace,
    runDir,
    run({ argv, cwd, stdin, timeoutMs }) {
      calls.push(argv);
      const r = spawnSync(argv[0], argv.slice(1), { cwd, input: stdin, timeout: timeoutMs, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
      return { started: !r.error || r.error.code === 'ETIMEDOUT', exitCode: r.status ?? -1, timedOut: r.error?.code === 'ETIMEDOUT', out: r.stdout ?? '', err: r.stderr ?? '' };
    },
    read_file({ path }) {
      try {
        return { ok: true, content: readFileSync(path, 'utf8') };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    write_file({ path, content }) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return { ok: true };
    },
    list_dir({ path }) {
      try {
        return readdirSync(path);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    stat_file({ path }) {
      try {
        return { ok: true, isDirectory: statSync(path).isDirectory() };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    logAppend({ kind, fields }) {
      calls.push([kind, fields]);
    },
    sleep() {},
  };
}

export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'leaf-'));
}

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
