const GIT_TIMEOUT_MS = 120000;
const GH_TIMEOUT_MS = 60000;
const CHECK_TIMEOUT_MS = 15000;
const MAX_COUNT = 200;
const RETRIES = 3;
const BASE_MS = 1000;
const CAP_MS = 16000;
const JITTER = 0.2;
const REF = /^[A-Za-z0-9._\/@-]{1,200}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ORIGIN = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/\s]+@)?([^\/:\s]+)(?::\d+)?[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/i;
const TRANSIENT_TEXT = [
  [/connection refused|econnrefused/i, 'ECONNREFUSED'],
  [/failed to connect|error connecting to/i, 'connect'],
  [/connection reset|econnreset|reset by peer|und_err_socket/i, 'ECONNRESET'],
  [/timed out|timeout|etimedout|aborterror|aborted/i, 'ETIMEDOUT'],
  [/hung up unexpectedly|remote end hung up|socket hang up/i, 'hung-up'],
  [/temporary failure in name resolution/i, 'EAI_AGAIN'],
  [/(?:HTTP|returned error:?|status code)\s*(408|429|5\d\d)\b/i, 'HTTP'],
];
const URL_TEXT = /[a-z][a-z0-9+.-]*:\/\/\S*/gi;
const HOST_TEXT = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;

const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const SCOPE = ' cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.';
const scoped = (properties = {}, required = []) => obj({ cwd: str, ...properties }, required);
const paths = { type: 'array', items: str };

const fail = (error) => ({ ok: false, error });

const isAbsolute = (path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

function normalize(path) {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? '';
  const parts = [];
  for (const part of path.slice(drive.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return drive + (path.startsWith('/') || path.slice(drive.length).startsWith('\\') ? '/' : '') + parts.join('/');
}

const resolvePath = (base, path) => normalize(isAbsolute(path) ? path : `${base}/${path}`);

function relativePath(base, path) {
  const from = normalize(base).split('/').filter(Boolean);
  const to = normalize(path).split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

function transientType(text) {
  const message = text.replace(URL_TEXT, ' ').replace(HOST_TEXT, ' ');
  for (const [pattern, type] of TRANSIENT_TEXT) {
    const match = pattern.exec(message);
    if (match) return type === 'HTTP' ? `HTTP-${match[1]}` : type;
  }
  return null;
}

const errorTypeOf = (result) => (result.ok ? null : transientType(`${result.error ?? ''}\n${result.output ?? ''}`));

function backoffMs(attempt) {
  const base = Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS);
  return Math.round(base * (1 + JITTER * (2 * Math.random() - 1)));
}

function pause(ms) {
  if (typeof host.sleep === 'function') host.sleep({ ms });
  else host.run({ argv: ['sleep', String(ms / 1000)], timeoutMs: ms + 5000 });
}

function retrying(tool, attempt) {
  for (let n = 1; ; n += 1) {
    const result = attempt();
    const errorType = errorTypeOf(result);
    if (errorType === null) return { ...result, attempts: n };
    if (n > RETRIES) return { ...result, attempts: n, exhausted: true };
    const delayMs = backoffMs(n);
    host.logAppend({ kind: 'retry', fields: { tool, attempt: n, errorType, delayMs } });
    pause(delayMs);
  }
}

function exec(program, argv, cwd, timeoutMs) {
  const full = program === 'git' ? ['--literal-pathspecs', ...argv] : argv;
  const reply = host.run({ argv: [program, ...full], cwd, timeoutMs });
  const output = `${reply.out ?? ''}${reply.err ?? ''}`;
  if (!reply.started) return { ok: false, error: `could not start ${program}`, output, exitCode: -1 };
  if (reply.timedOut) return { ok: false, error: `${program} timed out after ${timeoutMs} ms`, output, exitCode: reply.exitCode };
  return { ok: reply.exitCode === 0, output, exitCode: reply.exitCode };
}

const gitIn = (dir, argv, timeoutMs = GIT_TIMEOUT_MS) => exec('git', argv, dir, timeoutMs);

function verbOf(sub, result) {
  if (result.ok) return { ok: true, output: result.output.trim() || '(no output)' };
  return { ok: false, error: result.error ?? `git ${sub} exited ${result.exitCode}`, output: result.output.trim() };
}

const git = (dir, argv, timeoutMs) => verbOf(argv[0], gitIn(dir, argv, timeoutMs));

function repoAt(cwd) {
  const root = host.workspace;
  if (cwd === undefined) return { dir: root };
  if (typeof cwd !== 'string' || cwd === '') return { error: 'cwd must be a non-empty path' };
  const dir = resolvePath(root, cwd);
  const stat = host.stat_file({ path: dir });
  if (stat?.ok === false || stat?.isDirectory === false || stat?.type === 'file') return { error: `no such directory: ${cwd}` };
  const inside = gitIn(dir, ['rev-parse', '--show-toplevel'], CHECK_TIMEOUT_MS);
  return inside.ok ? { dir } : { error: `cwd ${cwd} is not inside a git repository` };
}

const inRepo = (run) => (args = {}) => {
  const where = repoAt(args.cwd);
  return where.error === undefined ? run(where.dir, args) : fail(where.error);
};

function pathArgs(dir, list) {
  if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'string')) {
    return { error: 'paths must be a non-empty array of strings' };
  }
  const rels = [];
  for (const path of list) {
    const absolute = resolvePath(dir, path);
    if (dir === host.workspace) {
      const outside = relativePath(host.workspace, absolute);
      if (outside === '..' || outside.startsWith('../')) return { error: `refused: path is outside the workspace: ${path}` };
    }
    const rel = relativePath(dir, absolute);
    if (rel === '') return { error: 'refused: "." names the whole workspace; name each path explicitly' };
    rels.push(rel);
  }
  return { args: ['--', ...rels] };
}

const badRef = (ref) => (typeof ref === 'string' && REF.test(ref) && !ref.startsWith('-') ? null : 'ref must be a branch, tag or commit name');

function ciStatus(dir, sha, repo) {
  if (sha !== undefined && !SHA.test(sha)) return fail('sha must be 7 to 40 lowercase hex digits');
  if (repo !== undefined && !REPO.test(repo)) return fail('repo must be owner/name');
  const head = gitIn(dir, ['rev-parse', '--verify', `${sha ?? 'HEAD'}^{commit}`], CHECK_TIMEOUT_MS);
  if (!head.ok) return fail(`no commit ${sha ?? 'HEAD'} in this repository`);
  let origin = { host: null, name: repo };
  if (repo === undefined) {
    const url = gitIn(dir, ['remote', 'get-url', 'origin'], CHECK_TIMEOUT_MS);
    const match = url.ok ? ORIGIN.exec(url.output.trim()) : null;
    origin = match ? { host: match[1], name: `${match[2]}/${match[3]}` } : null;
  }
  if (origin === null || !REPO.test(origin.name)) return fail('origin has no owner/name path; pass repo as owner/name');
  const full = head.output.trim();
  const hostArgs = origin.host === null ? [] : ['--hostname', origin.host];
  const api = retrying('ci_status', () => {
    const reply = exec('gh', ['api', ...hostArgs, '--paginate', '--slurp', `repos/${origin.name}/actions/runs?head_sha=${full}&per_page=100`], dir, GH_TIMEOUT_MS);
    return reply.ok ? reply : { ok: false, error: reply.error ?? `gh api exited ${reply.exitCode}`, output: reply.output.trim() };
  });
  if (!api.ok) return { ok: false, error: api.error ?? `gh api exited ${api.exitCode}`, output: api.output.trim(), attempts: api.attempts };
  let runs;
  try {
    runs = JSON.parse(api.output).flatMap((page) => page.workflow_runs ?? []);
  } catch {
    return fail('gh api did not return JSON');
  }
  const lines = runs.map((run) => `${run.name} ${run.status} ${run.conclusion ?? '-'} ${run.html_url}`);
  return { ok: true, output: [`${origin.name} ${full}`, ...(lines.length ? lines : ['no workflow runs'])].join('\n') };
}

const withPaths = (run) => (dir, { paths: list }) => {
  const scope = pathArgs(dir, list);
  return scope.error ? fail(scope.error) : run(dir, scope.args);
};

const handlers = {
  git_status: (dir) => git(dir, ['status', '--porcelain=v1', '--branch']),
  git_rm: withPaths((dir, args) => git(dir, ['rm', ...args])),
  git_add: withPaths((dir, args) => git(dir, ['add', ...args])),
  git_commit: (dir, { message, paths: list, author }) => {
    if (typeof message !== 'string' || message.trim() === '') return fail('message must be a non-empty string');
    const scope = pathArgs(dir, list);
    if (scope.error) return fail(scope.error);
    if (author !== undefined && (typeof author !== 'string' || author.trim() === '' || /[<>\r\n]/.test(author))) return fail('author must be a name without <, > or line breaks; the configured git email is kept');
    const authorArgs = [];
    if (author !== undefined) {
      const email = gitIn(dir, ['config', 'user.email'], CHECK_TIMEOUT_MS);
      if (!email.ok || email.output.trim() === '') return fail('author needs user.email set in this repository');
      authorArgs.push(`--author=${author.trim()} <${email.output.trim()}>`);
    }
    const result = git(dir, ['commit', ...authorArgs, '-m', message, ...scope.args]);
    if (result.ok) {
      const head = gitIn(dir, ['rev-parse', '--short', 'HEAD'], CHECK_TIMEOUT_MS);
      host.logAppend({ kind: 'commit', fields: { sha: head.ok ? head.output.trim() : null, message: message.split('\n')[0], paths: scope.args.slice(1) } });
    }
    return result;
  },
  git_push: (dir) => {
    const current = gitIn(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], CHECK_TIMEOUT_MS);
    const branch = current.ok ? current.output.trim() : null;
    if (branch !== 'main') return fail(`refused: git_push sends only main, and the current branch is ${branch ?? 'unknown'}`);
    return retrying('git_push', () => git(dir, ['push', '--set-upstream', 'origin', 'main']));
  },
  git_log: (dir, { count = 20, path }) => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return fail(`count must be an integer from 1 to ${MAX_COUNT}`);
    const scope = path === undefined ? { args: [] } : pathArgs(dir, [path]);
    return scope.error ? fail(scope.error) : git(dir, ['log', '--oneline', '--no-color', '-n', String(count), ...scope.args]);
  },
  git_diff: (dir, { paths: list, staged = false }) => {
    const scope = list === undefined ? { args: [] } : pathArgs(dir, list);
    if (scope.error) return fail(scope.error);
    return git(dir, ['diff', '--no-color', ...(staged === true ? ['--cached'] : []), ...scope.args]);
  },
  git_show: (dir, { ref = 'HEAD' }) => badRef(ref) ? fail(badRef(ref)) : git(dir, ['show', '--no-color', '--stat', ref]),
  git_fetch: (dir) => retrying('git_fetch', () => git(dir, ['fetch', 'origin'])),
  git_pull: (dir) => retrying('git_pull', () => git(dir, ['pull', '--ff-only'])),
  git_checkout: (dir, { ref }) => badRef(ref) ? fail(badRef(ref)) : git(dir, ['checkout', ref]),
  git_branch: (dir) => git(dir, ['branch', '--no-color', '--list']),
  ci_status: (dir, { sha, repo }) => ciStatus(dir, sha, repo),
};

const DESCRIPTIONS = {
  git_status: ['Working tree status: the branch and the changed paths (porcelain v1).', scoped()],
  git_add: ['Stage the given workspace paths. Each path is explicit; "." is refused.', scoped({ paths }, ['paths'])],
  git_rm: ['Remove the given workspace paths from the disk and the index, with git rm, so the removal is staged. Each path is explicit; "." is refused. Commit it with git_commit.', scoped({ paths }, ['paths'])],
  git_commit: ['Commit only the given paths, with the message. Stage new files with git_add first. author, when given, is the author name; the repository user.email is kept.', scoped({ message: str, paths, author: str }, ['message', 'paths'])],
  git_push: ['Push main to origin and set its upstream. Refused unless the current branch is main.', scoped()],
  git_log: ['The last count commits, one line each, optionally only for one path (count 1 to 200, default 20).', scoped({ count: { type: 'number' }, path: str })],
  git_diff: ['Diff of the given paths (default: all), or of the staged index when staged is true.', scoped({ paths, staged: { type: 'boolean' } })],
  git_show: ['Commit message and changed files for a ref (default HEAD).', scoped({ ref: str })],
  git_fetch: ['Fetch origin. The working tree is not changed.', scoped()],
  git_pull: ['Fast-forward pull of the current branch from its upstream. Never merges.', scoped()],
  git_checkout: ['Switch to an existing branch, tag or commit. Creates nothing.', scoped({ ref: str }, ['ref'])],
  git_branch: ['List local branches. The current branch is marked with *.', scoped()],
  ci_status: ["GitHub Actions runs for a commit (default HEAD), every page of them, with status and conclusion. repo is owner/name and defaults to origin; when it comes from origin, gh calls origin's host, whatever that host is.", scoped({ sha: str, repo: str })],
};

export const verbs = Object.entries(DESCRIPTIONS).map(([name, [description, inputSchema]]) => ({
  name,
  description: description + SCOPE,
  inputSchema,
  call: inRepo(handlers[name]),
}));
