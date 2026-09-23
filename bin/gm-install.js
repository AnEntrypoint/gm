#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const argv = process.argv.slice(2)
const global = argv.includes('-g') || argv.includes('--global')
const mcpOnly = argv.includes('--mcp-only')

const GM_TOOLS_DIR = path.join(os.homedir(), '.gm-tools')
const MCP_BUNDLE_PATH = path.join(GM_TOOLS_DIR, 'gm-mcp-server.mjs')
const MCP_BUNDLE_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js'
const LEGACY_NPX_SPEC = 'github:AnEntrypoint/gm-mcp'

const PROJECT_LAUNCH_SNIPPET =
  "const p=require('path').join(require('os').homedir(),'.gm-tools','gm-mcp-server.mjs');" +
  "if(!require('fs').existsSync(p)){console.error('gm-mcp bundle missing at '+p+' -- run: npx github:AnEntrypoint/gm --mcp-only');process.exit(1)}" +
  "import(require('url').pathToFileURL(p).href)"

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

// Node's shell:true on Windows joins the args array with plain spaces and
// does NOT escape/quote them (see the DEP0190 deprecation notice) -- fine
// for simple tokens like npx's own args, but any arg containing spaces or
// shell metacharacters (a quoted path, an `&`) gets corrupted by cmd.exe's
// own parsing before it ever reaches the target program. runDirect() skips
// the shell entirely and lets spawnSync pass the args array straight to
// CreateProcess, which is the only reliable way to hand powershell.exe a
// real filesystem path as one of its arguments.
function runDirect(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' })
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

function globalServerEntry() {
  return { command: 'node', args: [MCP_BUNDLE_PATH] }
}

function projectServerEntry() {
  return { command: 'node', args: ['-e', PROJECT_LAUNCH_SNIPPET] }
}

async function vendorMcpBundle() {
  fs.mkdirSync(GM_TOOLS_DIR, { recursive: true })
  const res = await fetch(MCP_BUNDLE_URL)
  if (!res.ok) throw new Error(`fetch ${MCP_BUNDLE_URL} -> HTTP ${res.status}`)
  const body = await res.text()
  if (!body.startsWith('#!/usr/bin/env node')) throw new Error(`unexpected bundle head from ${MCP_BUNDLE_URL}`)
  const tmp = `${MCP_BUNDLE_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, MCP_BUNDLE_PATH)
  console.log(`vendored gm-mcp server -> ${MCP_BUNDLE_PATH} (${body.length} bytes)`)
}

function isLegacyNpxEntry(entry) {
  return entry && entry.command === 'npx' && Array.isArray(entry.args) && entry.args.includes(LEGACY_NPX_SPEC)
}

function isCurrentEntry(entry, wanted) {
  return entry && entry.command === wanted.command && JSON.stringify(entry.args) === JSON.stringify(wanted.args)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function upsertGmServer(servers, wanted, label, create) {
  if (!servers || typeof servers !== 'object') return false
  const existing = servers.gm
  if (!existing && !create) return false
  if (isCurrentEntry(existing, wanted)) return false
  servers.gm = wanted
  console.log(`registered gm MCP server in ${label}${isLegacyNpxEntry(existing) ? ' (replaced legacy npx github spec)' : ''}`)
  return true
}

function registerClaudeCode() {
  const userConfigPath = path.join(os.homedir(), '.claude.json')
  const userConfig = readJson(userConfigPath)
  if (userConfig && typeof userConfig === 'object') {
    if (global) userConfig.mcpServers ||= {}
    let changed = upsertGmServer(userConfig.mcpServers, globalServerEntry(), `${userConfigPath} mcpServers`, global)
    for (const [projectPath, project] of Object.entries(userConfig.projects || {})) {
      changed = upsertGmServer(project?.mcpServers, globalServerEntry(), `${userConfigPath} projects[${projectPath}].mcpServers`, false) || changed
    }
    if (changed) writeJsonAtomic(userConfigPath, userConfig)
  }

  const projectConfigPath = path.join(process.cwd(), '.mcp.json')
  const projectConfig = readJson(projectConfigPath)
  if (!global && !projectConfig) {
    writeJsonAtomic(projectConfigPath, { mcpServers: { gm: projectServerEntry() } })
    console.log(`registered gm MCP server in ${projectConfigPath} (create)`)
  } else if (projectConfig && typeof projectConfig === 'object') {
    if (!global) projectConfig.mcpServers ||= {}
    if (upsertGmServer(projectConfig.mcpServers, projectServerEntry(), `${projectConfigPath} mcpServers`, !global)) writeJsonAtomic(projectConfigPath, projectConfig)
  }
}

function registerOtherHosts() {
  const scopeFlag = global ? ['-g'] : []
  const launch = `node ${MCP_BUNDLE_PATH}`
  run('npx', ['-y', 'add-mcp', process.platform === 'win32' ? `"${launch}"` : launch, '-n', 'gm', ...scopeFlag, '-y'])
}

// add-mcp (registerOtherHosts) does not know these three hosts' exact config
// shapes and is not guaranteed to replace an existing legacy npx entry rather
// than leaving it alone, so each is also rewritten directly here.
const CURSOR_MCP_PATH = path.join(os.homedir(), '.cursor', 'mcp.json')
const GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json')
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml')

function registerJsonMcpHost(configPath) {
  const config = readJson(configPath)
  if (!config || typeof config !== 'object') return
  config.mcpServers ||= {}
  if (upsertGmServer(config.mcpServers, globalServerEntry(), `${configPath} mcpServers`, true)) writeJsonAtomic(configPath, config)
}

function tomlQuotedString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// TOML table headers ([mcp_servers.gm], [mcp_servers.gm.env], ...) always
// start at column 0 in a config codex itself writes, so the gm table (plus
// any of its own subtables) is the span from its header to the next header
// that is not itself a "[mcp_servers.gm" continuation.
function registerCodex(configPath) {
  if (!fs.existsSync(configPath)) return
  const text = fs.readFileSync(configPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const gmHeaderRe = /^\s*\[mcp_servers\.gm(?:\.[^\]]*)?\]\s*$/
  const anyHeaderRe = /^\s*\[/
  const wantedLines = [
    '[mcp_servers.gm]',
    'command = "node"',
    `args = [ ${tomlQuotedString(MCP_BUNDLE_PATH)} ]`,
  ]

  let start = lines.findIndex(line => gmHeaderRe.test(line))
  let end = lines.length
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i++) {
      if (anyHeaderRe.test(lines[i]) && !gmHeaderRe.test(lines[i])) { end = i; break }
    }
  }

  const newLines = start === -1
    ? lines.concat(lines[lines.length - 1] === '' ? [] : [''], wantedLines)
    : lines.slice(0, start).concat(wantedLines, lines.slice(end))

  const newText = newLines.join('\n')
  if (newText !== text) {
    const tmp = `${configPath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, newText)
    fs.renameSync(tmp, configPath)
    console.log(`registered gm MCP server in ${configPath}${start !== -1 ? ' (replaced existing table)' : ''}`)
  }
}

function registerKnownHostShapes() {
  registerJsonMcpHost(CURSOR_MCP_PATH)
  registerJsonMcpHost(GEMINI_SETTINGS_PATH)
  registerCodex(CODEX_CONFIG_PATH)
}

function installRunner() {
  const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const installSh = path.join(pkgRoot, 'install.sh')
  const installPs1 = path.join(pkgRoot, 'install.ps1')

  if (process.platform === 'win32') {
    if (fs.existsSync(installPs1)) {
      // -File (not -Command "& '<path>' spool") sidesteps quoting entirely --
      // no embedded single-quoted path string for cmd.exe to mangle.
      runDirect('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installPs1, 'spool'])
    } else {
      runDirect('powershell', ['-Command', 'irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main spool'])
    }
  } else {
    if (fs.existsSync(installSh)) {
      run('sh', [installSh, 'spool'])
    } else {
      run('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool'])
    }
  }
}

if (!mcpOnly) {
  run('npx', ['-y', 'skills', 'add', 'AnEntrypoint/gm', ...(global ? ['-g'] : []), '-y'])
}
await vendorMcpBundle()
registerOtherHosts()
registerKnownHostShapes()
registerClaudeCode()
if (!mcpOnly) installRunner()
console.log(`gm MCP server launches from ${pathToFileURL(MCP_BUNDLE_PATH).href} -- restart the agent host to reconnect`)
