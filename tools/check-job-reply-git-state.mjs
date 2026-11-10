import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'node';
const onNode = target === 'node';
if (!onNode && !existsSync(resolve(target))) {
  console.error('job-reply-git-state-check: failed: no native binary at ' + resolve(target));
  process.exit(1);
}
const WATCHDOG_MS = 900000;
const watchdog = setTimeout(() => {
  console.error('job-reply-git-state-check: failed: no completion within ' + WATCHDOG_MS + ' ms');
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-job-git-state-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-job-git-state-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const common = ['--workspace', workspace, '--mcp-config', mcpConfig];
const file = onNode ? process.execPath : resolve(target);
const argv = onNode ? [join(root, 'tools', 'relay.mjs'), ...common] : ['serve', ...common];

const child = spawn(file, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((done) => pending.set(id, done));
};
const valueOf = (text) => {
  let value = JSON.parse(text);
  if (value && value.output !== undefined) value = value.output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};
const runCode = async (body, timeoutMs) => {
  const started = Date.now();
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body, ...(timeoutMs ? { timeoutMs } : {}) } });
  return { elapsed: Date.now() - started, value: valueOf(reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? null)) };
};

const git = (args) => execFileSync('git', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const summary = [];
try {
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(workspace, '.gitignore'), '.gm/\nruns/\n');
  writeFileSync(join(workspace, 'a.txt'), 'one\n');
  writeFileSync(join(workspace, 'b.txt'), 'one\n');
  git(['add', '.gitignore', 'a.txt', 'b.txt']);
  git(['-c', 'user.name=gm-check', '-c', 'user.email=gm-check@example.invalid', 'commit', '-q', '-m', 'init']);
  writeFileSync(join(workspace, 'a.txt'), 'two\n');
  git(['add', 'a.txt']);
  writeFileSync(join(workspace, 'b.txt'), 'two\n');
  writeFileSync(join(workspace, 'c.txt'), 'new\n');

  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-job-git-state-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });

  const state = await runCode("return { state: await gm.git_state({}) };");
  const text = String(state.value?.state?.output ?? '');
  expect(text.includes('branch main ahead 0 behind 0'), 'git_state branch line was ' + JSON.stringify(text));
  expect(text.includes('changed 3 staged 1 unstaged 1 untracked 1'), 'git_state changed line was ' + JSON.stringify(text) + ' with status ' + JSON.stringify(git(['status', '--porcelain', '--ignored'])));
  expect(text.includes('diff unstaged: 1 file changed, 1 insertion(+), 1 deletion(-)'), 'git_state unstaged stat was ' + JSON.stringify(text));
  expect(text.includes('diff staged: 1 file changed, 1 insertion(+), 1 deletion(-)'), 'git_state staged stat was ' + JSON.stringify(text));
  summary.push('git_state: ' + text.split('\n').join(' | '));

  const started = await runCode("return { job: await gm.job_start({ job: 'w1', command: 'echo hi; sleep 2' }) };");
  const job = started.value?.job ?? {};
  expect(job.ok === true && job.state === 'running', 'job_start reply was ' + JSON.stringify(job));
  expect(Number.isInteger(job.pid) && job.pid > 0, 'job_start pid was ' + JSON.stringify(job.pid));
  expect(typeof job.doneFile === 'string' && job.doneFile.endsWith('w1.exit'), 'job_start doneFile was ' + JSON.stringify(job.doneFile));
  expect(typeof job.logPath === 'string' && job.logPath.endsWith('w1.out'), 'job_start logPath was ' + JSON.stringify(job.logPath));
  summary.push('job_start: pid ' + job.pid + ', doneFile ' + job.doneFile.split('/').pop());

  const waited = await runCode("return { status: await gm.job_status({ job: 'w1', waitMs: 30000 }) };");
  const status = waited.value?.status ?? {};
  expect(status.timeoutMs === 300000, 'job_start without timeoutMs set the job deadline to ' + status.timeoutMs + ' ms, expected 300000');
  expect(status.state === 'exited' && status.exitCode === 0, 'job_status after the wait was ' + JSON.stringify(status).slice(0, 200));
  expect(waited.elapsed < 20000, 'job_status with waitMs 30000 returned after ' + waited.elapsed + ' ms, not when the job settled');
  expect(existsSync(job.doneFile) && readFileSync(job.doneFile, 'utf8').trim() === '0', 'the done file did not hold exit code 0');
  summary.push('job_status: waited ' + waited.elapsed + ' ms, state ' + status.state);

  await runCode("return { job: await gm.job_start({ job: 'w2', command: 'sleep 130' }) };");
  const capped = await runCode("return { status: await gm.job_status({ job: 'w2', waitMs: 200000 }) };", 200000);
  expect(capped.elapsed >= 95000 && capped.elapsed < 115000, 'job_status with waitMs 200000 returned after ' + capped.elapsed + ' ms, expected the 100000 ms cap');
  expect(capped.value?.status?.state === 'running', 'the capped wait returned state ' + JSON.stringify(capped.value?.status?.state));
  summary.push('wait cap: waitMs 200000 returned after ' + capped.elapsed + ' ms, state ' + capped.value?.status?.state);
  await runCode("return { stopped: await gm.job_stop({ job: 'w2' }) };");
} catch (error) {
  failures.push(String(error?.stack ?? error));
} finally {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error('job-reply-git-state-check: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log('job-reply-git-state-check: ok (' + target + ': ' + summary.join('; ') + ')');
process.exit(0);
