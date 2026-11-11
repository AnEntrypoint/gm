import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = 'check-cli-flags';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const binary = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const started = Date.now();
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

const home = mkdtempSync(join(tmpdir(), 'gm-cli-flags-'));
const workspace = join(home, 'workspace');
const scratch = join(home, 'scratch');
const env = { ...process.env, HOME: home, USERPROFILE: home };
const run = (args) => spawnSync(binary, args, { cwd: home, env, encoding: 'utf8', timeout: 20000 });
const claude = join(home, '.claude.json');

try {
  const bad = [
    ['install', '--bogus', 'x'],
    ['install', '--wait'],
    ['serve', '--workspace', workspace, '--nope', '1'],
    ['worker', '--workspace', workspace, '--nope'],
    ['doctor', '--bogus'],
    ['update', '--now'],
    ['events', '--run', 'abc', '--bogus', 'x'],
    ['query', '--run', 'abc', '--wait'],
    ['stop-run', '--dir', scratch, '--bogus', '1'],
    ['--version', 'extra'],
  ];
  for (const args of bad) {
    const result = run(args);
    expect(result.status === 2, `${args.join(' ')} should exit 2, exited ${result.status}: ${result.stderr.slice(0, 200)}`);
    expect(/unknown flag|unexpected argument/.test(result.stderr), `${args.join(' ')} should name the flag: ${result.stderr.slice(0, 200)}`);
  }
  expect(!existsSync(claude), 'refused flags must not register the gm server in HOME/.claude.json');
  expect(!existsSync(join(workspace, 'runs')), 'a refused serve must not create a run directory');

  mkdirSync(scratch, { recursive: true });
  const explicit = run(['install', '--config', join(scratch, 'claude.json')]);
  expect(explicit.status === 0, `install --config should succeed: ${explicit.stderr}`);
  expect(existsSync(join(scratch, 'claude.json')), 'install --config should write the named file');
  expect(!existsSync(claude), 'install --config must leave the default HOME/.claude.json alone');
  const written = JSON.parse(readFileSync(join(scratch, 'claude.json'), 'utf8'));
  expect(written.mcpServers?.gm?.args?.join(' ') === 'serve', `the named file should hold the gm entry: ${JSON.stringify(written)}`);

  const withServerConfig = run(['install', '--config', join(scratch, 'claude.json'), '--mcp-config', join(scratch, 'q.json')]);
  expect(withServerConfig.status === 0, `install with --mcp-config should succeed: ${withServerConfig.stderr}`);
  const appended = JSON.parse(readFileSync(join(scratch, 'claude.json'), 'utf8'));
  expect(appended.mcpServers?.gm?.args?.join(' ') === `serve --mcp-config ${join(scratch, 'q.json')}`, `--mcp-config should be appended to the server args: ${JSON.stringify(appended)}`);

  const quiet = run(['events', '--run', 'abc', '--wait', '--timeout-ms', '1000']);
  expect(!/unknown flag|unexpected argument|needs a value/.test(quiet.stderr), `known events flags should be accepted: ${quiet.stderr.slice(0, 200)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (ten refused command lines changed nothing, --config wrote only its named file, --mcp-config reached the server args; wall ${wall} s)`);
}
