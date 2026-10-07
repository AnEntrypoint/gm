#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-install-check-')))
const home = path.join(temp, 'home'), cwd = path.join(temp, 'project')
fs.mkdirSync(home); fs.mkdirSync(cwd)
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), npm_config_cache: path.join(home, '.npm'), npm_config_offline: 'true' }
delete env.NODE_OPTIONS; delete env.npm_config_prefix
const cli = path.join(root, 'bin/gm-install.js')
function invoke(args = [], expected = 0, command = process.execPath, prefix = [cli]) {
  const result = spawnSync(command, [...prefix, ...args], { cwd, env, encoding: 'utf8', timeout: 15_000, windowsHide: true })
  assert.ifError(result.error)
  assert.equal(result.status, expected, result.stdout + result.stderr)
  console.log('exit=' + result.status + ' ' + path.basename(command) + ' ' + args.join(' '))
  return result.stdout + result.stderr
}
function snapshot(dir) {
  const result = {}
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), stat = fs.lstatSync(file)
    result[name] = stat.isDirectory() ? snapshot(file) : stat.isSymbolicLink() ? { link: fs.readlinkSync(file) } : fs.readFileSync(file).toString('base64')
  }
  return result
}
function matches(target) {
  function walk(source, dest) {
    for (const name of fs.readdirSync(source)) {
      const from = path.join(source, name), to = path.join(dest, name)
      if (fs.statSync(from).isDirectory()) walk(from, to)
      else assert.deepEqual(fs.readFileSync(to), fs.readFileSync(from), to)
    }
  }
  for (const skill of ['gm', 'gm-continue']) walk(path.join(root, 'skills', skill), path.join(target, skill))
}
try {
  fs.writeFileSync(path.join(home, '.claude.json'), '{"unrelated":true}')
  fs.writeFileSync(path.join(cwd, '.mcp.json'), '{"mcpServers":{"other":{"command":"keep"}}}')
  const original = snapshot(temp)
  for (const args of [['--help'], ['--dry-run'], ['--with-runtime','--dry-run'], ['--mcp-only','--dry-run'], ['--global','--dry-run']]) {
    invoke(args)
    assert.deepEqual(snapshot(temp), original, 'help/dry-run must not write')
  }
  for (const args of [['--unknown'], ['--target'], ['--global','--target','x'], ['--with-runtime','--mcp-only']]) {
    invoke(args, 1)
    assert.deepEqual(snapshot(temp), original, 'invalid options must not write')
  }
  const target = path.join(cwd, '.agents', 'skills')
  invoke(); matches(target)
  const installed = snapshot(temp)
  invoke(); assert.deepEqual(snapshot(temp), installed, 'repeat is idempotent')
  assert.deepEqual(snapshot(home), original.home, 'project install must not write HOME')
  assert.equal(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8'), '{"mcpServers":{"other":{"command":"keep"}}}')
  fs.writeFileSync(path.join(target, 'gm', 'user-note.txt'), 'keep me')
  const skill = path.join(target, 'gm', 'SKILL.md')
  fs.writeFileSync(skill, 'user customization')
  invoke(); matches(target)
  assert.equal(fs.readFileSync(path.join(target, 'gm', 'user-note.txt'), 'utf8'), 'keep me')
  const backups = fs.readdirSync(path.dirname(skill)).filter(name => name.startsWith('SKILL.md.gm-backup-'))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(path.dirname(skill), backups[0]), 'utf8'), 'user customization')
  const custom = path.join(temp, 'target with spaces')
  invoke(['--target', custom]); matches(custom)
  invoke(['--global']); matches(path.join(home, '.agents', 'skills'))
  assert.equal(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'), '{"unrelated":true}')
  if (process.platform !== 'win32') {
    const link = path.join(temp, 'linked-target')
    fs.symlinkSync(custom, link, 'dir')
    const before = snapshot(temp)
    assert.match(invoke(['--target', link], 1), /Refusing symlink/)
    assert.deepEqual(snapshot(temp), before)
    const dangling = path.join(temp, 'dangling-target')
    fs.symlinkSync(path.join(temp, 'absent'), dangling, 'dir')
    assert.match(invoke(['--target', dangling], 1), /Refusing symlink/)
    const shTarget = path.join(temp, 'shell target')
    invoke(['--target', shTarget], 0, 'sh', [path.join(root, 'install.sh')]); matches(shTarget)
    const beforeHelp = snapshot(temp)
    invoke(['--help'], 0, 'sh', [path.join(root, 'install.sh')])
    invoke(['--with-runtime', '--dry-run'], 0, 'sh', [path.join(root, 'install.sh')])
    assert.deepEqual(snapshot(temp), beforeHelp)
  }
  const ps = spawnSync(process.platform === 'win32' ? 'powershell' : 'pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 10_000 })
  if (!ps.error && ps.status === 0) {
    const psTarget = path.join(temp, 'PowerShell target')
    invoke(['--target', psTarget], 0, process.platform === 'win32' ? 'powershell' : 'pwsh', ['-NoProfile','-File',path.join(root, 'install.ps1')])
    matches(psTarget)
  } else console.log('SKIP PowerShell execution: no available PowerShell executable')
  assert.deepEqual(fs.readdirSync(target).sort(), ['gm', 'gm-continue'])
  assert.equal(fs.existsSync(path.join(home, '.gm-tools')), false)
  console.log('PASS real isolated installation, repeat, backup, preservation, paths, global scope, option validation, dry-run and wrapper checks; no runtime installed')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
