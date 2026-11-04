import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'build-dir': { type: 'string' },
    out: { type: 'string' },
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = values.target.endsWith('-windows');
const exeName = windows ? 'gmnew.exe' : 'gmnew';
const exe = join(resolve(values['build-dir']), 'native', 'components', 'host', exeName);
if (!existsSync(exe)) throw new Error(`missing executable: ${exe}`);

function stripCopy(file, flags) {
  const result = spawnSync('strip', [...flags, file], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') throw new Error('strip not found on PATH; install binutils (linux) or the Xcode command line tools (macos)');
  if (result.error) throw new Error(`strip failed for ${file}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`strip exited ${result.status} for ${file}`);
}

const out = resolve(values.out);
const name = `gmnew-${values.target}`;
const stage = join(out, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(exe, join(stage, exeName));
if (!windows) stripCopy(join(stage, exeName), values.target.endsWith('-macos') ? ['-x'] : []);

const runtime = {
  leaves: join(root, 'native', 'leaves'),
  skills: join(root, 'skills'),
  defaults: join(root, 'defaults'),
};
for (const [dir, source] of Object.entries(runtime)) {
  cpSync(source, join(stage, dir), { recursive: true });
}

const archive = join(out, windows ? `${name}.zip` : `${name}.tar.gz`);
rmSync(archive, { force: true });
const result = windows
  ? spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stage}', '${archive}', 'Optimal', $true)`,
      ],
      { stdio: 'inherit' },
    )
  : spawnSync('tar', ['-czf', archive, '-C', out, name], {
      stdio: 'inherit',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
if (result.status !== 0) process.exit(result.status ?? 1);

rmSync(stage, { recursive: true, force: true });
console.log(archive);
