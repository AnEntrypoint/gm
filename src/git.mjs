import { relative } from 'node:path';
import { runCommand } from './exec.mjs';
import { runGate } from './gate.mjs';

const GIT_TIMEOUT_MS = 120000;
const GH_TIMEOUT_MS = 60000;
const CHECK_TIMEOUT_MS = 15000;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };
const MAX_COUNT = 200;
const REF = /^[A-Za-z0-9._\/@-]{1,200}$/;
export const SHA = /^[0-9a-f]{7,40}$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ORIGIN = /github\.com[:\/]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/;

const str = { type: 'string' };
const bool = { type: 'boolean' };
const num = { type: 'number' };
const strings = { type: 'array', items: { type: 'string' } };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const GIT_TOOLS = [
  { name: 'git_status', description: 'Working tree status: the branch and the changed paths (porcelain v1).', inputSchema: obj({}) },
  { name: 'git_add', description: 'Stage the given workspace paths. Each path is explicit; "." is refused.', inputSchema: obj({ paths: strings }, ['paths']) },
  { name: 'git_rm', description: 'Remove the given workspace paths from the disk and the index, with git rm, so the removal is staged. Each path is explicit; "." is refused. Commit it with git_commit, which runs the commit gate.', inputSchema: obj({ paths: strings }, ['paths']) },
  { name: 'git_commit', description: 'Commit only the given paths, with the message. Stage new files with git_add first. The commit gate runs first: syntax of every module, ASCII of every tracked text file, every doc path and KEEP path exists, and a smoke run with a negative control. A failed check refuses the commit, and gate reports each check with its time.', inputSchema: obj({ message: str, paths: strings }, ['message', 'paths']) },
  { name: 'git_push', description: 'Push main to origin and set its upstream. Refused unless the current branch is main.', inputSchema: obj({}) },
  { name: 'git_log', description: 'The last count commits, one line each, optionally only for one path (count 1 to 200, default 20).', inputSchema: obj({ count: num, path: str }) },
  { name: 'git_diff', description: 'Diff of the given paths (default: all), or of the staged index when staged is true.', inputSchema: obj({ paths: strings, staged: bool }) },
  { name: 'git_show', description: 'Commit message and changed files for a ref (default HEAD).', inputSchema: obj({ ref: str }) },
  { name: 'git_fetch', description: 'Fetch origin. The working tree is not changed.', inputSchema: obj({}) },
  { name: 'git_pull', description: 'Fast-forward pull of the current branch from its upstream. Never merges.', inputSchema: obj({}) },
  { name: 'git_checkout', description: 'Switch to an existing branch, tag or commit. Creates nothing.', inputSchema: obj({ ref: str }, ['ref']) },
  { name: 'git_branch', description: 'List local branches. The current branch is marked with *.', inputSchema: obj({}) },
  { name: 'ci_status', description: 'GitHub Actions runs for a commit (default HEAD) with status and conclusion. repo is owner/name and defaults to origin.', inputSchema: obj({ sha: str, repo: str }) },
];

export function commitExists(root, sha) {
  return runCommand('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS, env: GIT_ENV }).then((result) => result.ok);
}

export function createGitVerbs({ root, confine, log }) {
  const gitRaw = (args, timeoutMs = GIT_TIMEOUT_MS) => runCommand('git', args, { cwd: root, timeoutMs, env: GIT_ENV });
  const git = async (args, timeoutMs) => verbOf(args[0], await gitRaw(args, timeoutMs));

  function pathArgs(list) {
    if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'string')) {
      return { error: 'paths must be a non-empty array of strings' };
    }
    const rels = [];
    for (const path of list) {
      const at = confine(path);
      if (at.refused) return { error: at.refused };
      const rel = relative(root, at.path);
      if (rel === '') return { error: 'refused: "." names the whole workspace; name each path explicitly' };
      rels.push(rel);
    }
    return { args: ['--', ...rels] };
  }

  async function currentBranch() {
    const result = await gitRaw(['rev-parse', '--abbrev-ref', 'HEAD'], CHECK_TIMEOUT_MS);
    return result.ok ? result.output.trim() : null;
  }

  async function originRepo() {
    const url = await gitRaw(['remote', 'get-url', 'origin'], CHECK_TIMEOUT_MS);
    const match = url.ok ? ORIGIN.exec(url.output.trim()) : null;
    return match ? `${match[1]}/${match[2]}` : null;
  }

  async function ciStatus(sha, repo) {
    if (sha !== undefined && !SHA.test(sha)) return fail('sha must be 7 to 40 lowercase hex digits');
    if (repo !== undefined && !REPO.test(repo)) return fail('repo must be owner/name');
    const head = await gitRaw(['rev-parse', '--verify', `${sha ?? 'HEAD'}^{commit}`], CHECK_TIMEOUT_MS);
    if (!head.ok) return fail(`no commit ${sha ?? 'HEAD'} in this repository`);
    const name = repo ?? (await originRepo());
    if (name === null) return fail('origin is not a GitHub remote; pass repo as owner/name');
    const full = head.output.trim();
    const api = await runCommand('gh', ['api', `repos/${name}/actions/runs?head_sha=${full}&per_page=20`], { cwd: root, timeoutMs: GH_TIMEOUT_MS });
    if (!api.ok) return { ok: false, error: api.error ?? `gh api exited ${api.exitCode}`, output: api.output.trim() };
    let runs;
    try {
      runs = JSON.parse(api.output).workflow_runs ?? [];
    } catch {
      return fail('gh api did not return JSON');
    }
    const lines = runs.map((run) => `${run.name} ${run.status} ${run.conclusion ?? '-'} ${run.html_url}`);
    return { ok: true, output: [`${name} ${full}`, ...(lines.length ? lines : ['no workflow runs'])].join('\n') };
  }

  return {
    async git_status() {
      return git(['status', '--porcelain=v1', '--branch']);
    },

    async git_rm({ paths }) {
      const scope = pathArgs(paths);
      return scope.error ? fail(scope.error) : git(['rm', ...scope.args]);
    },

    async git_add({ paths }) {
      const scope = pathArgs(paths);
      return scope.error ? fail(scope.error) : git(['add', ...scope.args]);
    },

    async git_commit({ message, paths }) {
      if (typeof message !== 'string' || message.trim() === '') return fail('message must be a non-empty string');
      const scope = pathArgs(paths);
      if (scope.error) return fail(scope.error);
      const gate = await runGate(root);
      if (!gate.ok) return { ok: false, error: `refused: the commit gate failed: ${gate.failed.join(', ')}`, gate: gate.checks };
      return { ...(await git(['commit', '-m', message, ...scope.args])), gate: gate.checks };
    },

    async git_push() {
      const branchStart = log.now();
      const branch = await currentBranch();
      log.append('stage', { tool: 'git_push', stage: 'branch', startMono: branchStart, branch });
      if (branch !== 'main') return fail(`refused: git_push sends only main, and the current branch is ${branch ?? 'unknown'}`);
      const pushStart = log.now();
      const result = await git(['push', '--set-upstream', 'origin', 'main'], GIT_TIMEOUT_MS);
      log.append('stage', { tool: 'git_push', stage: 'push', startMono: pushStart, ok: result.ok });
      return result;
    },

    async git_log({ count = 20, path }) {
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return fail(`count must be an integer from 1 to ${MAX_COUNT}`);
      const scope = path === undefined ? { args: [] } : pathArgs([path]);
      return scope.error ? fail(scope.error) : git(['log', '--oneline', '--no-color', '-n', String(count), ...scope.args]);
    },

    async git_diff({ paths, staged = false }) {
      const scope = paths === undefined ? { args: [] } : pathArgs(paths);
      if (scope.error) return fail(scope.error);
      return git(['diff', '--no-color', ...(staged === true ? ['--cached'] : []), ...scope.args]);
    },

    async git_show({ ref = 'HEAD' }) {
      const bad = badRef(ref);
      return bad ? fail(bad) : git(['show', '--no-color', '--stat', ref]);
    },

    git_fetch: () => git(['fetch', 'origin']),

    git_pull: () => git(['pull', '--ff-only']),

    async git_checkout({ ref }) {
      const bad = badRef(ref);
      return bad ? fail(bad) : git(['checkout', ref]);
    },

    git_branch: () => git(['branch', '--no-color', '--list']),

    ci_status: ({ sha, repo }) => ciStatus(sha, repo),
  };
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
