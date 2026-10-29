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
const RETIRED_SKILL_FLAGS = ['--skills-only', '--check-skills', '--force-link']
const retiredSkillFlag = argv.find(arg => RETIRED_SKILL_FLAGS.includes(arg))


const GM_TOOLS_DIR = path.join(os.homedir(), '.gm-tools')
const MCP_BUNDLE_PATH = path.join(GM_TOOLS_DIR, 'gm-mcp-server.mjs')
const MCP_BUNDLE_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js'

const SKILLS_OVER_MCP = 'skills are served over MCP only (prompts /mcp__gm__<name>, resources skill://); this installer no longer installs or checks skill files'

if (retiredSkillFlag) {
  console.log(`${retiredSkillFlag}: ${SKILLS_OVER_MCP}`)
  if (retiredSkillFlag !== '--force-link') process.exit(0)
}

if (help) {
  console.log('Usage: gm [-g|--global] [--mcp-only]')
  console.log('Registers the gm MCP server with the detected agent hosts and installs the runner.')
  console.log('  --mcp-only  register the MCP server only (no runner)')
  console.log(SKILLS_OVER_MCP + '.')
  console.log('For live dispatch, use the gm MCP tool after restarting the agent host, or the project spool with agentplug-runner spool.')
  process.exit(0)
}

const PROJECT_LAUNCH_SNIPPET =
  "const bundlePath=require('path').join(require('os').homedir(),'.gm-tools','gm-mcp-server.mjs');" +
  "if(!require('fs').existsSync(bundlePath)){console.error('gm-mcp bundle missing at '+bundlePath+' -- run: node bin/gm-install.js --mcp-only from a github.com/AnEntrypoint/gm checkout');process.exit(1)}" +
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
  const deployedHash = fs.existsSync(MCP_BUNDLE_PATH) ? sha256Short(fs.readFileSync(MCP_BUNDLE_PATH)) : null
  let body
  try {
    const response = await fetch(MCP_BUNDLE_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    body = await response.text()
    if (!body.startsWith('#!/usr/bin/env node')) throw new Error(`unexpected bundle head from ${MCP_BUNDLE_URL}`)
  } catch (err) {
    if (deployedHash === null) throw new Error(`fetch ${MCP_BUNDLE_URL} failed (${err.message}) and no bundle is deployed at ${MCP_BUNDLE_PATH}`)
    console.log(`WARNING: ${MCP_BUNDLE_URL} unreachable (${err.message}); keeping the deployed bundle at ${MCP_BUNDLE_PATH} (sha256 ${deployedHash}) -- rerun to refresh it`)
    return
  }
  const freshHash = sha256Short(body)
  if (deployedHash === freshHash) {
    console.log(`gm-mcp server already current at ${MCP_BUNDLE_PATH} (sha256 ${freshHash})`)
    return
  }
  const tmp = `${MCP_BUNDLE_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, body)
  renameReplacing(tmp, MCP_BUNDLE_PATH)
  const transition = deployedHash ? `stale ${deployedHash} -> ${freshHash}` : `new ${freshHash}`
  console.log(`vendored gm-mcp server -> ${MCP_BUNDLE_PATH} (${body.length} bytes, ${transition}); the bundle then keeps itself current`)
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600]

// Windows refuses to replace a target a reader or antivirus holds open (EPERM/EBUSY); retry with
// bounded backoff, then drop the temp file and fail naming the path and the error code.
function renameReplacing(tmp, dest) {
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, dest)
      return
    } catch (err) {
      if (!RENAME_RETRY_CODES.has(err.code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        try { fs.rmSync(tmp, { force: true }) } catch {}
        throw new Error(`rename ${tmp} -> ${dest} failed (${err.code || err.message}) after ${attempt + 1} attempt(s); temp file removed`)
      }
      Atomics.wait(sleepBuf, 0, 0, RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}

function sha256Short(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

function isCurrentEntry(entry, wanted) {
  return entry && entry.command === wanted.command && JSON.stringify(entry.args) === JSON.stringify(wanted.args)
}

// Returns null when the file is absent, INVALID when it exists but is not JSON. Callers
// leave an INVALID file untouched: overwriting it would discard the user's other entries.
const INVALID = Symbol('invalid-json')

function readJson(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    console.log(`WARNING: cannot read ${file} (${err.code || err.message}); leaving it untouched`)
    return INVALID
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    console.log(`WARNING: ${file} is not valid JSON (${err.message}); leaving it untouched`)
    return INVALID
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameReplacing(tmp, file)
}

function needsGmServerUpdate(servers, wanted, create) {
  if (!servers || typeof servers !== 'object') return false
  if (!servers.gm && !create) return false
  return !isCurrentEntry(servers.gm, wanted)
}

function setGmServer(servers, wanted, label) {
  servers.gm = wanted
  console.log(`registered gm MCP server in ${label}`)
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

  // Every gm-owned table (the header and its body up to the next other header) is removed,
  // and the single wanted block goes where the first one was. A second [mcp_servers.gm]
  // table elsewhere in the file would otherwise survive.
  const out = []
  let inGm = false
  let placed = false
  let replaced = 0
  for (const line of lines) {
    if (anyHeaderRe.test(line)) {
      if (gmHeaderRe.test(line)) {
        inGm = true
        replaced++
        if (!placed) { out.push(...wantedLines); placed = true }
        continue
      }
      inGm = false
    }
    if (!inGm) out.push(line)
  }
  if (!placed) {
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push(...wantedLines)
  }

  const newText = out.join('\n')
  if (newText !== text) {
    const tmp = `${configPath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, newText)
    renameReplacing(tmp, configPath)
    console.log(`registered gm MCP server in ${configPath}${replaced > 0 ? ` (replaced ${replaced} existing gm table${replaced === 1 ? '' : 's'})` : ''}`)
  }
}

function registerKnownHostShapes() {
  registerJsonMcpHost(CURSOR_MCP_PATH)
  registerJsonMcpHost(GEMINI_SETTINGS_PATH)
  registerCodex(CODEX_CONFIG_PATH)
}

function refuseUnverifiedInstall(script) {
  console.error('gm: ' + script + ' is absent from this package and a remote copy is not pinned to a digest, so it is not run. Install from a checkout that contains ' + script + '.')
  process.exitCode = 1
}

function installRunner() {
  const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const installSh = path.join(pkgRoot, 'install.sh')
  const installPs1 = path.join(pkgRoot, 'install.ps1')

  if (IS_WINDOWS) {
    if (fs.existsSync(installPs1)) return runChild('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installPs1, 'spool'])
    return refuseUnverifiedInstall('install.ps1')
  }
  if (fs.existsSync(installSh)) return runChild('sh', [installSh, 'spool'])
  refuseUnverifiedInstall('install.sh')
}

await vendorMcpBundle()
registerKnownHostShapes()
registerClaudeCode()
if (!mcpOnly) installRunner()
console.log(`gm MCP server launches from ${pathToFileURL(MCP_BUNDLE_PATH).href} -- restart the agent host to reconnect`)
