import { statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { runCommand } from './exec.mjs';
import { errorTypeOf, retrying } from './retry.mjs';
import { resultZone1, resultZone2 } from './compact.mjs';

const GIT_TIMEOUT_MS = 120000;
const GH_TIMEOUT_MS = 60000;
const CHECK_TIMEOUT_MS = 15000;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };
const MAX_COUNT = 200;
const REF = /^[A-Za-z0-9._\/@-]{1,200}$/;
export const SHA = /^[0-9a-f]{7,40}$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ORIGIN = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/\s]+@)?([^\/:\s]+)(?::\d+)?[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/i;

const str = { type: 'string' };
const bool = { type: 'boolean' };
const num = { type: 'number' };
const strings = { type: 'array', items: { type: 'string' } };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const scoped = (properties = {}, required = []) => obj({ cwd: str, ...properties }, required);

export const GIT_TOOLS = [
  { name: 'git_status', description: 'Working tree status: the branch and the changed paths (porcelain v1). cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped() },
  { name: 'git_add', description: 'Stage the given workspace paths. Each path is explicit; "." is refused. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ paths: strings }, ['paths']) },
  { name: 'git_rm', description: 'Remove the given workspace paths from the disk and the index, with git rm, so the removal is staged. Each path is explicit; "." is refused. Commit it with git_commit, which runs the commit gate. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ paths: strings }, ['paths']) },
  { name: 'git_commit', description: 'Commit only the given paths, with the message. Stage new files with git_add first. The commit gate runs first: syntax of every module, ASCII of every tracked text file, every doc path and KEEP path exists, and a smoke run with a negative control. A failed check refuses the commit. gate reports each check with its time, and notCovered lists what the gate does not check. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ message: str, paths: strings }, ['message', 'paths']) },
  { name: 'git_push', description: 'Push main to origin and set its upstream. Refused unless the current branch is main. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped() },
  { name: 'git_log', description: 'The last count commits, one line each, optionally only for one path (count 1 to 200, default 20). cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ count: num, path: str }) },
  { name: 'git_diff', description: 'Diff of the given paths (default: all), or of the staged index when staged is true. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ paths: strings, staged: bool }) },
  { name: 'git_show', description: 'Commit message and changed files for a ref (default HEAD). cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ ref: str }) },
  { name: 'git_fetch', description: 'Fetch origin. The working tree is not changed. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped() },
  { name: 'git_pull', description: 'Fast-forward pull of the current branch from its upstream. Never merges. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped() },
  { name: 'git_checkout', description: 'Switch to an existing branch, tag or commit. Creates nothing. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ ref: str }, ['ref']) },
  { name: 'git_branch', description: 'List local branches. The current branch is marked with *. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped() },
  { name: 'ci_status', description: 'GitHub Actions runs for a commit (default HEAD), every page of them, with status and conclusion. repo is owner/name and defaults to origin; when it comes from origin, gh calls origin\'s host, whatever that host is. cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.', inputSchema: scoped({ sha: str, repo: str }) },
];

export function commitExists(root, sha) {
  return runCommand('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS, env: GIT_ENV }).then((result) => result.ok);
}

const GIT_RESULTS = ['git_status', 'git_add', 'git_rm', 'git_commit', 'git_push', 'git_fetch', 'git_pull', 'git_checkout', 'git_branch', 'ci_status'];
const GIT_LISTINGS = ['git_log', 'git_diff', 'git_show'];
export const COMPACT = {
  tools: {
    ...Object.fromEntries(GIT_RESULTS.map((name) => [name, { zone1: resultZone1, zone2: resultZone2 }])),
    ...Object.fromEntries(GIT_LISTINGS.map((name) => [name, { zone1: resultZone1, zone2: () => null }])),
  },
};

export function createGitVerbs({ root, confine, log }) {
  const gitIn = (dir, args, timeoutMs = GIT_TIMEOUT_MS) => runCommand('git', args, { cwd: dir, timeoutMs, env: GIT_ENV });
  const git = async (dir, args, timeoutMs) => verbOf(args[0], await gitIn(dir, args, timeoutMs));

  const retried = (tool, attempt) =>
    retrying({
      tool,
      log,
      attempt: async () => {
        const result = await attempt();
        return { result, errorType: errorTypeOf(result) };
      },
    });

  async function repoAt(cwd) {
    if (cwd === undefined) return { dir: root };
    if (typeof cwd !== 'string' || cwd === '') return { error: 'cwd must be a non-empty path' };
    const dir = resolve(root, cwd);
    if (!isDirectory(dir)) return { error: `no such directory: ${cwd}` };
    const inside = await gitIn(dir, ['rev-parse', '--show-toplevel'], CHECK_TIMEOUT_MS);
    return inside.ok ? { dir } : { error: `cwd ${cwd} is not inside a git repository` };
  }

  const inRepo = (run) => async (args = {}) => {
    const where = await repoAt(args.cwd);
    return where.error === undefined ? run(where.dir, args) : fail(where.error);
  };

  function pathArgs(dir, list) {
    if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'string')) {
      return { error: 'paths must be a non-empty array of strings' };
    }
    const rels = [];
    for (const path of list) {
      const at = dir === root ? confine(path) : { path: resolve(dir, path) };
      if (at.refused) return { error: at.refused };
      const rel = relative(dir, at.path);
      if (rel === '') return { error: 'refused: "." names the whole workspace; name each path explicitly' };
      rels.push(rel);
    }
    return { args: ['--', ...rels] };
  }

  async function currentBranch(dir) {
    const result = await gitIn(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], CHECK_TIMEOUT_MS);
    return result.ok ? result.output.trim() : null;
  }

  async function originRepo(dir) {
    const url = await gitIn(dir, ['remote', 'get-url', 'origin'], CHECK_TIMEOUT_MS);
    const match = url.ok ? ORIGIN.exec(url.output.trim()) : null;
    return match ? { host: match[1], name: `${match[2]}/${match[3]}` } : null;
  }

  async function ciStatus(dir, sha, repo) {
    if (sha !== undefined && !SHA.test(sha)) return fail('sha must be 7 to 40 lowercase hex digits');
    if (repo !== undefined && !REPO.test(repo)) return fail('repo must be owner/name');
    const head = await gitIn(dir, ['rev-parse', '--verify', `${sha ?? 'HEAD'}^{commit}`], CHECK_TIMEOUT_MS);
    if (!head.ok) return fail(`no commit ${sha ?? 'HEAD'} in this repository`);
    const origin = repo === undefined ? await originRepo(dir) : { host: null, name: repo };
    if (origin === null) return fail('origin has no owner/name path; pass repo as owner/name');
    const { host, name } = origin;
    if (!REPO.test(name)) return fail('origin has no owner/name path; pass repo as owner/name');
    const full = head.output.trim();
    const hostArgs = host === null ? [] : ['--hostname', host];
    const api = await retried('ci_status', () => runCommand('gh', ['api', ...hostArgs, '--paginate', '--slurp', `repos/${name}/actions/runs?head_sha=${full}&per_page=100`], { cwd: dir, timeoutMs: GH_TIMEOUT_MS }));
    if (!api.ok) return { ok: false, error: api.error ?? `gh api exited ${api.exitCode}`, output: api.output.trim(), attempts: api.attempts };
    let runs;
    try {
      runs = JSON.parse(api.output).flatMap((page) => page.workflow_runs ?? []);
    } catch {
      return fail('gh api did not return JSON');
    }
    const lines = runs.map((run) => `${run.name} ${run.status} ${run.conclusion ?? '-'} ${run.html_url}`);
    return { ok: true, output: [`${name} ${full}`, ...(lines.length ? lines : ['no workflow runs'])].join('\n') };
  }

  return {
    git_status: inRepo((dir) => git(dir, ['status', '--porcelain=v1', '--branch'])),

    git_rm: inRepo((dir, { paths }) => {
      const scope = pathArgs(dir, paths);
      return scope.error ? fail(scope.error) : git(dir, ['rm', ...scope.args]);
    }),

    git_add: inRepo((dir, { paths }) => {
      const scope = pathArgs(dir, paths);
      return scope.error ? fail(scope.error) : git(dir, ['add', ...scope.args]);
    }),

    git_commit: inRepo(async (dir, { message, paths }) => {
      if (typeof message !== 'string' || message.trim() === '') return fail('message must be a non-empty string');
      const scope = pathArgs(dir, paths);
      if (scope.error) return fail(scope.error);
      const { runGate } = await import('./gate.mjs');
      const gate = await runGate(dir, scope.args.slice(1));
      if (!gate.ok) {
        const reasons = gate.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
        return { ok: false, error: `refused: the commit gate failed: ${reasons.join('; ')}`, gate: gate.checks, notCovered: gate.notCovered };
      }
      const result = await git(dir, ['commit', '-m', message, ...scope.args]);
      if (result.ok) {
        const head = await gitIn(dir, ['rev-parse', '--short', 'HEAD'], CHECK_TIMEOUT_MS);
        log.append('commit', { sha: head.ok ? head.output.trim() : null, message: message.split('\n')[0], paths: scope.args.slice(1), gate: gate.checks, notCovered: gate.notCovered });
      }
      return { ...result, gate: gate.checks, notCovered: gate.notCovered };
    }),

    git_push: inRepo(async (dir) => {
      const branchStart = log.now();
      const branch = await currentBranch(dir);
      log.append('stage', { tool: 'git_push', stage: 'branch', startMono: branchStart, branch });
      if (branch !== 'main') return fail(`refused: git_push sends only main, and the current branch is ${branch ?? 'unknown'}`);
      const pushStart = log.now();
      const result = await retried('git_push', () => git(dir, ['push', '--set-upstream', 'origin', 'main'], GIT_TIMEOUT_MS));
      log.append('stage', { tool: 'git_push', stage: 'push', startMono: pushStart, ok: result.ok });
      return result;
    }),

    git_log: inRepo((dir, { count = 20, path }) => {
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return fail(`count must be an integer from 1 to ${MAX_COUNT}`);
      const scope = path === undefined ? { args: [] } : pathArgs(dir, [path]);
      return scope.error ? fail(scope.error) : git(dir, ['log', '--oneline', '--no-color', '-n', String(count), ...scope.args]);
    }),

    git_diff: inRepo((dir, { paths, staged = false }) => {
      const scope = paths === undefined ? { args: [] } : pathArgs(dir, paths);
      if (scope.error) return fail(scope.error);
      return git(dir, ['diff', '--no-color', ...(staged === true ? ['--cached'] : []), ...scope.args]);
    }),

    git_show: inRepo((dir, { ref = 'HEAD' }) => {
      const bad = badRef(ref);
      return bad ? fail(bad) : git(dir, ['show', '--no-color', '--stat', ref]);
    }),

    git_fetch: inRepo((dir) => retried('git_fetch', () => git(dir, ['fetch', 'origin']))),

    git_pull: inRepo((dir) => git(dir, ['pull', '--ff-only'])),

    git_checkout: inRepo((dir, { ref }) => {
      const bad = badRef(ref);
      return bad ? fail(bad) : git(dir, ['checkout', ref]);
    }),

    git_branch: inRepo((dir) => git(dir, ['branch', '--no-color', '--list'])),

    ci_status: inRepo((dir, { sha, repo }) => ciStatus(dir, sha, repo)),
  };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function badRef(ref) {
  return typeof ref === 'string' && REF.test(ref) && !ref.startsWith('-') ? null : 'ref must be a branch, tag or commit name';
}

function verbOf(sub, result) {
  if (result.ok) return { ok: true, output: result.output.trim() || '(no output)' };
  return { ok: false, error: result.error ?? `git ${sub} exited ${result.exitCode}`, output: result.output.trim() };
}

function fail(error) {
  return { ok: false, error };
}
