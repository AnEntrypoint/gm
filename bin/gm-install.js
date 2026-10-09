#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const argv = process.argv.slice(2)
const global = argv.includes('-g') || argv.includes('--global')
const mcpOnly = argv.includes('--mcp-only')
const help = argv.includes('-h') || argv.includes('--help')

const GM_TOOLS_DIR = path.join(os.homedir(), '.gm-tools')
const MCP_BUNDLE_PATH = path.join(GM_TOOLS_DIR, 'gm-mcp-server.mjs')
const MCP_BUNDLE_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js'
const LEGACY_NPX_SPEC = 'github:AnEntrypoint/gm-mcp'

if (help) {
  console.log('Usage: gm [-g|--global] [--mcp-only]')
  console.log('Installs or repairs the gm skill, local MCP registration, and runner.')
  console.log('For live dispatch, use the gm MCP tool after restarting the agent host, or the project spool with agentplug-runner spool.')
  process.exit(0)
}

const PROJECT_LAUNCH_SNIPPET =
  "const bundlePath=require('path').join(require('os').homedir(),'.gm-tools','gm-mcp-server.mjs');" +
  "if(!require('fs').existsSync(bundlePath)){console.error('gm-mcp bundle missing at '+bundlePath+' -- run: npx github:AnEntrypoint/gm --mcp-only');process.exit(1)}" +
  "import(require('url').pathToFileURL(bundlePath).href)"

const IS_WINDOWS = process.platform === 'win32'

function runChild(cmd, args, { shell = false } = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell, windowsHide: true })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
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
  const response = await fetch(MCP_BUNDLE_URL)
  if (!response.ok) throw new Error(`fetch ${MCP_BUNDLE_URL} -> HTTP ${response.status}`)
  const body = await response.text()
  if (!body.startsWith('#!/usr/bin/env node')) throw new Error(`unexpected bundle head from ${MCP_BUNDLE_URL}`)
  const freshHash = sha256Short(body)
  const deployedHash = fs.existsSync(MCP_BUNDLE_PATH) ? sha256Short(fs.readFileSync(MCP_BUNDLE_PATH)) : null
  if (deployedHash === freshHash) {
    console.log(`gm-mcp server already current at ${MCP_BUNDLE_PATH} (sha256 ${freshHash})`)
    return
  }
  const tmp = `${MCP_BUNDLE_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, MCP_BUNDLE_PATH)
  const transition = deployedHash ? `stale ${deployedHash} -> ${freshHash}` : `new ${freshHash}`
  console.log(`vendored gm-mcp server -> ${MCP_BUNDLE_PATH} (${body.length} bytes, ${transition}); the bundle then keeps itself current`)
}

function sha256Short(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
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

function needsGmServerUpdate(servers, wanted, create) {
  if (!servers || typeof servers !== 'object') return false
  if (!servers.gm && !create) return false
  return !isCurrentEntry(servers.gm, wanted)
}

function setGmServer(servers, wanted, label) {
  const existing = servers.gm
  servers.gm = wanted
  console.log(`registered gm MCP server in ${label}${isLegacyNpxEntry(existing) ? ' (replaced legacy npx github spec)' : ''}`)
}

function syncGmServers(configPath, config, targets, wanted) {
  const stale = targets.filter(t => needsGmServerUpdate(t.servers, wanted, t.create))
  if (stale.length === 0) return
  for (const t of stale) setGmServer(t.servers, wanted, t.label)
  writeJsonAtomic(configPath, config)
}

function registerClaudeCode() {
  const userConfigPath = path.join(os.homedir(), '.claude.json')
  const userConfig = readJson(userConfigPath)
  if (userConfig && typeof userConfig === 'object') {
    if (global) userConfig.mcpServers ||= {}
    const targets = [{ servers: userConfig.mcpServers, label: `${userConfigPath} mcpServers`, create: global }]
    for (const [projectPath, project] of Object.entries(userConfig.projects || {})) {
      targets.push({ servers: project?.mcpServers, label: `${userConfigPath} projects[${projectPath}].mcpServers`, create: false })
    }
    syncGmServers(userConfigPath, userConfig, targets, globalServerEntry())
  }

  const projectConfigPath = path.join(process.cwd(), '.mcp.json')
  const projectConfig = readJson(projectConfigPath)
  if (!projectConfig) {
    if (global) return
    writeJsonAtomic(projectConfigPath, { mcpServers: { gm: projectServerEntry() } })
    console.log(`registered gm MCP server in ${projectConfigPath} (create)`)
    return
  }
  if (typeof projectConfig !== 'object') return
  if (!global) projectConfig.mcpServers ||= {}
  syncGmServers(projectConfigPath, projectConfig, [{ servers: projectConfig.mcpServers, label: `${projectConfigPath} mcpServers`, create: !global }], projectServerEntry())
}

function registerOtherHosts() {
  const scopeFlag = global ? ['-g'] : []
  const launch = `node ${MCP_BUNDLE_PATH}`
  runChild('npx', ['-y', 'add-mcp', IS_WINDOWS ? `"${launch}"` : launch, '-n', 'gm', ...scopeFlag, '-y'], { shell: IS_WINDOWS })
}

const CURSOR_MCP_PATH = path.join(os.homedir(), '.cursor', 'mcp.json')
const GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json')
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml')

function registerJsonMcpHost(configPath) {
  const config = readJson(configPath)
  if (!config || typeof config !== 'object') return
  config.mcpServers ||= {}
  syncGmServers(configPath, config, [{ servers: config.mcpServers, label: `${configPath} mcpServers`, create: true }], globalServerEntry())
}

function tomlQuotedString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

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

  let gmSectionStart = lines.findIndex(line => gmHeaderRe.test(line))
  let gmSectionEnd = lines.length
  if (gmSectionStart !== -1) {
    for (let i = gmSectionStart + 1; i < lines.length; i++) {
      if (anyHeaderRe.test(lines[i]) && !gmHeaderRe.test(lines[i])) { gmSectionEnd = i; break }
    }
  }

  const newLines = gmSectionStart === -1
    ? lines.concat(lines[lines.length - 1] === '' ? [] : [''], wantedLines)
    : lines.slice(0, gmSectionStart).concat(wantedLines, lines.slice(gmSectionEnd))

  const newText = newLines.join('\n')
  if (newText !== text) {
    const tmp = `${configPath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, newText)
    fs.renameSync(tmp, configPath)
    console.log(`registered gm MCP server in ${configPath}${gmSectionStart !== -1 ? ' (replaced existing table)' : ''}`)
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

  if (IS_WINDOWS) {
    if (fs.existsSync(installPs1)) return runChild('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installPs1, 'spool'])
    return runChild('powershell', ['-Command', 'irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main spool'])
  }
  if (fs.existsSync(installSh)) return runChild('sh', [installSh, 'spool'], { shell: IS_WINDOWS })
  runChild('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool'], { shell: IS_WINDOWS })
}

if (!mcpOnly) {
  runChild('npx', ['-y', 'skills', 'add', 'AnEntrypoint/gm', ...(global ? ['-g'] : []), '-y'], { shell: IS_WINDOWS })
}
await vendorMcpBundle()
registerOtherHosts()
registerKnownHostShapes()
registerClaudeCode()
if (!mcpOnly) installRunner()
console.log(`gm MCP server launches from ${pathToFileURL(MCP_BUNDLE_PATH).href} -- restart the agent host to reconnect`)
