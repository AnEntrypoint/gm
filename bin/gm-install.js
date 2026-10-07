#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const options = { global: false, dryRun: false, runtime: false, mcpOnly: false }
const timeout = 120_000

function parse(args) {
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-g': case '--global': options.global = true; break
      case '--dry-run': options.dryRun = true; break
      case '--with-runtime': options.runtime = true; break
      case '--mcp-only': options.mcpOnly = true; break
      case '-h': case '--help': options.help = true; break
      case '--target':
        options.target = args[++i]
        if (!options.target || options.target.startsWith('-')) throw Error('--target requires a skills directory')
        break
      default: throw Error('Unknown option: ' + args[i])
    }
  }
  if (options.global && options.target) throw Error('--global and --target cannot be combined')
  if (options.runtime && options.mcpOnly) throw Error('--with-runtime and --mcp-only cannot be combined')
  if (options.mcpOnly && options.target) throw Error('--target is not used with --mcp-only')
}

// Refuse dangling links too, in every source/destination path component.
function safe(file) {
  const absolute = path.resolve(file)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('Refusing symlink: ' + current)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
let backupCounter = 0
function backup(file) {
  safe(file)
  if (!fs.existsSync(file)) return
  if (!fs.lstatSync(file).isFile()) throw Error('Expected regular file: ' + file)
  const dest = file + '.gm-backup-' + Date.now() + '-' + process.pid + '-' + backupCounter++
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL)
  console.log('backup -> ' + dest)
}
function put(file, content) {
  safe(file)
  if (fs.existsSync(file) && fs.lstatSync(file).isFile() && Buffer.from(content).equals(fs.readFileSync(file))) {
    console.log('unchanged -> ' + file)
    return
  }
  if (options.dryRun) { console.log('would install (backup if changed) -> ' + file); return }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  backup(file)
  const tmp = file + '.gm-tmp-' + process.pid
  // Exclusive creation prevents following a pre-existing staging symlink.
  fs.writeFileSync(tmp, content, { flag: 'wx' })
  try { fs.renameSync(tmp, file) } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
  console.log('installed -> ' + file)
}
function safeTree(dir) {
  safe(dir)
  if (!fs.existsSync(dir)) return
  if (fs.lstatSync(dir).isDirectory()) for (const name of fs.readdirSync(dir)) safeTree(path.join(dir, name))
}
function installSkills() {
  const target = path.resolve(options.target || path.join(options.global ? os.homedir() : process.cwd(), '.agents', 'skills'))
  const files = []
  function collect(source, dest) {
    safe(source); safe(dest)
    const stat = fs.lstatSync(source)
    if (stat.isDirectory()) {
      if (fs.existsSync(dest) && !fs.lstatSync(dest).isDirectory()) throw Error('Expected directory: ' + dest)
      for (const name of fs.readdirSync(source)) collect(path.join(source, name), path.join(dest, name))
    } else if (stat.isFile()) {
      if (fs.existsSync(dest) && !fs.lstatSync(dest).isFile()) throw Error('Expected regular file: ' + dest)
      files.push([dest, fs.readFileSync(source)])
    } else throw Error('Unsupported source file: ' + source)
  }
  // Preflight both trees before any writes. Never prune unrelated destination files.
  for (const name of ['gm', 'gm-continue']) collect(path.join(root, 'skills', name), path.join(target, name))
  for (const [file, content] of files) put(file, content)
}
function run(command, args, shell = false) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, shell, timeout, killSignal: 'SIGKILL' })
  if (result.error || result.status !== 0) throw Error(command + ' failed: ' + (result.error?.message || result.signal || result.status))
}
function readJson(file) {
  safe(file)
  if (!fs.existsSync(file)) return null
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected JSON object: ' + file)
  return value
}
function registerJson(file, entry, create) {
  const config = readJson(file)
  if (!config && !create) return
  const value = config || {}
  value.mcpServers ||= {}
  value.mcpServers.gm = entry
  put(file, JSON.stringify(value, null, 2) + '\n')
}
async function installRuntime() {
  if (options.dryRun) {
    console.log('would download upstream gm-mcp and register host configurations' + (options.runtime ? '; download upstream agentplug-runner and start spool' : ''))
    return
  }
  console.log('Legacy runtime opt-in: AnEntrypoint/gm-mcp and AnEntrypoint/agentplug-bin downloads; host configuration writes' + (options.runtime ? ' and runner startup.' : '.'))
  const tools = path.join(os.homedir(), '.gm-tools')
  const bundle = path.join(tools, 'gm-mcp-server.mjs')
  safeTree(tools)
  const response = await fetch('https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js', { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw Error('gm-mcp download: HTTP ' + response.status)
  const body = await response.text()
  if (!body.startsWith('#!/usr/bin/env node')) throw Error('Unexpected gm-mcp bundle header')
  put(bundle, body)
  console.log('gm-mcp sha256: ' + createHash('sha256').update(body).digest('hex'))
  const entry = { command: 'node', args: [bundle] }
  // Preserve legacy cross-host registration, with preflight/backups of known configs.
  const known = ['.claude.json', '.cursor/mcp.json', '.gemini/settings.json', '.codex/config.toml'].map(p => path.join(os.homedir(), p))
  known.push(path.join(process.cwd(), '.mcp.json'))
  for (const file of known) {
    safe(file)
    if (file.endsWith('.json')) readJson(file)
    backup(file)
  }
  const launch = 'node "' + bundle + '"'
  run('npx', ['-y', 'add-mcp', process.platform === 'win32' ? '"' + launch + '"' : launch, '-n', 'gm', ...(options.global ? ['-g'] : []), '-y'], process.platform === 'win32')
  registerJson(path.join(os.homedir(), '.cursor', 'mcp.json'), entry, false)
  registerJson(path.join(os.homedir(), '.gemini', 'settings.json'), entry, false)
  const claude = path.join(os.homedir(), '.claude.json')
  const config = readJson(claude)
  if (config) {
    if (options.global) { config.mcpServers ||= {}; config.mcpServers.gm = entry }
    else if (config.mcpServers?.gm) config.mcpServers.gm = entry
    for (const project of Object.values(config.projects || {})) if (project?.mcpServers?.gm) project.mcpServers.gm = entry
    put(claude, JSON.stringify(config, null, 2) + '\n')
  }
  if (!options.global) {
    const snippet = "import(require('url').pathToFileURL(require('path').join(require('os').homedir(),'.gm-tools','gm-mcp-server.mjs')).href)"
    registerJson(path.join(process.cwd(), '.mcp.json'), { command: 'node', args: ['-e', snippet] }, true)
  }
  const codex = path.join(os.homedir(), '.codex', 'config.toml')
  if (fs.existsSync(codex)) {
    safe(codex)
    const text = fs.readFileSync(codex, 'utf8')
    const lines = text.split(/\r?\n/)
    const header = /^\s*\[mcp_servers\.gm(?:\.[^\]]*)?\]\s*$/
    const start = lines.findIndex(line => header.test(line))
    let end = start + 1
    while (end < lines.length && (!/^\s*\[/.test(lines[end]) || header.test(lines[end]))) end++
    const wanted = ['[mcp_servers.gm]', 'command = "node"', 'args = [ ' + JSON.stringify(bundle) + ' ]']
    put(codex, (start < 0 ? [...lines, ...wanted] : [...lines.slice(0, start), ...wanted, ...lines.slice(end)]).join('\n'))
  }
  if (options.runtime) {
    // Private wrapper path cannot recurse through this installer.
    safeTree(tools)
    for (const name of ['agentplug-runner', 'agentplug-runner.exe', 'agentplug-runner.version']) backup(path.join(tools, name))
    if (process.platform === 'win32') run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1'), '--with-runtime', '--runner-only', 'spool'])
    else run('sh', [path.join(root, 'install.sh'), '--with-runtime', '--runner-only', 'spool'])
  }
  console.log('gm MCP installed; restart the agent host to reconnect.')
}

try {
  parse(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: gm [-g|--global | --target PATH] [--dry-run] [--with-runtime | --mcp-only]\nDefault: copy bundled gm and gm-continue to project .agents/skills; no network, MCP, or daemon.\n--global: use ~/.agents/skills. --target PATH: exact skills directory.\nChanged files are backed up beside originals; unrelated files remain. Symlinks are refused.\n--dry-run: no writes, downloads, or child commands.\n--with-runtime: explicitly enable legacy upstream MCP, host registration and runner startup.\n--mcp-only: explicitly enable legacy MCP download and registration only.\nRuntime commands: 120 second timeout. Requests: 30 second timeout. No retries.')
  } else {
    if (!options.mcpOnly) installSkills()
    if (options.runtime || options.mcpOnly) await installRuntime()
  }
} catch (error) {
  console.error('gm install failed: ' + error.message)
  process.exitCode = 1
}
