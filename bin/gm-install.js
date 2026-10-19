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
const skillsOnly = argv.includes('--skills-only')
const checkSkills = argv.includes('--check-skills')
const forceLink = argv.includes('--force-link')
const help = argv.includes('-h') || argv.includes('--help')

const GM_TOOLS_DIR = path.join(os.homedir(), '.gm-tools')
const MCP_BUNDLE_PATH = path.join(GM_TOOLS_DIR, 'gm-mcp-server.mjs')
const MCP_BUNDLE_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js'
const LEGACY_NPX_SPEC = 'github:AnEntrypoint/gm-mcp'

if (help) {
  console.log('Usage: gm [-g|--global] [--mcp-only] [--skills-only] [--check-skills] [--force-link]')
  console.log('Installs or repairs the gm skill, local MCP registration, and runner.')
  console.log('  --skills-only   materialise the skills and stop (no MCP registration, no runner)')
  console.log('  --check-skills  report installed-skill drift against the source and stop')
  console.log('  --force-link    replace an installed skill directory that could not be moved aside')
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
  fs.renameSync(tmp, MCP_BUNDLE_PATH)
  const transition = deployedHash ? `stale ${deployedHash} -> ${freshHash}` : `new ${freshHash}`
  console.log(`vendored gm-mcp server -> ${MCP_BUNDLE_PATH} (${body.length} bytes, ${transition}); the bundle then keeps itself current`)
}

function sha256Short(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

const SKILL_MODE_LEDGER = '.gm-skill-install-modes'
const SKILL_PRELINK_DIR = '.gm-skill-prelink'

function skillInstallRoots() {
  const home = os.homedir()
  return [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')]
}

function sourceSkillNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

function isNpmCacheSource(dir) {
  return path.resolve(dir).split(/[\\/]+/).includes('_npx')
}

function resolveLocalSkillSource() {
  const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const override = (process.env.GM_SKILL_SOURCE_DIR || '').trim()
  const dir = path.resolve(override || path.join(pkgRoot, 'skills'))
  const names = sourceSkillNames(dir)
  if (names.length === 0) return null
  return { dir, names, fromEnv: Boolean(override), disposable: isNpmCacheSource(dir) }
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p)
  } catch {
    return null
  }
}

function samePath(a, b) {
  const norm = p => path.resolve(p).replace(/[\\/]+$/, '')
  return IS_WINDOWS ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

function linkDir(src, dest) {
  if (IS_WINDOWS) {
    try {
      fs.symlinkSync(path.resolve(src), dest, 'junction')
      return 'junction'
    } catch (err) {
      console.log(`junction ${dest} => ${src} failed (${err.code || err.message}); copying instead`)
    }
    return null
  }
  try {
    fs.symlinkSync(src, dest, 'dir')
    return 'symlink'
  } catch {
    return null
  }
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true })
}

function clearDest(dest) {
  const st = lstatOrNull(dest)
  if (!st) return 'absent'
  if (st.isSymbolicLink()) {
    fs.unlinkSync(dest)
    return 'replaced-link'
  }
  if (st.isDirectory()) {
    const park = path.join(path.dirname(dest), SKILL_PRELINK_DIR)
    fs.mkdirSync(park, { recursive: true })
    const aside = path.join(park, `${path.basename(dest)}-${Date.now()}`)
    try {
      fs.renameSync(dest, aside)
      return `moved-aside:${aside}`
    } catch (e) {
      if (!forceLink) return `refused:${e.code || 'EBUSY'}`
      fs.rmSync(dest, { recursive: true, force: true })
      return 'deleted'
    }
  }
  fs.unlinkSync(dest)
  return 'replaced-file'
}

function readLedger(root) {
  const file = path.join(root, SKILL_MODE_LEDGER)
  const kept = []
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      kept.push(t)
    }
  } catch {}
  return { file, kept }
}

function recordMode(root, name, mode, source) {
  const { file, kept } = readLedger(root)
  const ts = new Date().toISOString()
  const lines = kept.filter(l => l.split(/\s+/)[0] !== name)
  lines.push(`${name} ${mode} ${ts} ${source}`)
  const tmp = `${file}.tmp.${process.pid}`
  fs.writeFileSync(tmp, `# gm skill install modes: <name> <linked|copied|refused> <iso-ts> <source>\n${lines.join('\n')}\n`)
  fs.renameSync(tmp, file)
}

function materialiseSkill({ dir, name, root, copyOnly = false }) {
  const src = path.join(dir, name)
  const dest = path.join(root, name)
  fs.mkdirSync(root, { recursive: true })

  if (!copyOnly) {
    const existing = lstatOrNull(dest)
    if (existing && existing.isSymbolicLink()) {
      let current = null
      try {
        current = fs.realpathSync(dest)
      } catch {}
      if (current && samePath(current, src)) {
        recordMode(root, name, 'linked', src)
        console.log(`linked ${name} -> ${dest} => ${src} (already the source directory)`)
        return { mode: 'linked', kind: 'already', status: 'already' }
      }
    }
  }

  const cleared = clearDest(dest)
  if (cleared.startsWith('refused:')) {
    recordMode(root, name, 'refused', src)
    console.log(`REFUSED ${name} -> ${dest}: could not move the existing install aside (${cleared.slice(8)}); it stays a COPY and will drift from ${src} -- rerun with --force-link to replace it`)
    return { mode: 'refused', status: cleared }
  }

  const kind = copyOnly ? null : linkDir(src, dest)
  if (kind) {
    recordMode(root, name, 'linked', src)
    console.log(`linked ${name} (${kind}) -> ${dest} => ${src} (edits to the source are served immediately)`)
    return { mode: 'linked', kind, status: cleared }
  }

  copyDir(src, dest)
  recordMode(root, name, 'copied', src)
  const why = copyOnly
    ? 'the source is npm npx cache, which npm can delete or replace'
    : 'no junction/symlink available here'
  console.log(`WARNING: ${name} -> ${dest} is a COPY (${why}); it is NOT the file at ${src} and will drift silently -- recorded in ${path.join(root, SKILL_MODE_LEDGER)}`)
  return { mode: 'copied', status: cleared }
}

function sameFile(a, b) {
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    return Boolean(sa.ino) && sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false
  }
}

// Every file the source skill ships is compared, not only SKILL.md: a copy install whose
// data files (dream-rsi/gm-graph.json, the prose tree) drifted is drift too.
function listSkillFiles(root, rel = '') {
  const out = []
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel ? path.join(rel, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...listSkillFiles(root, next))
    else out.push(next)
  }
  return out
}

function checkSkill({ dir, name, root }) {
  const srcRoot = path.join(dir, name)
  const destRoot = path.join(root, name)
  if (!fs.existsSync(path.join(destRoot, 'SKILL.md'))) return { name, state: 'absent' }
  const srcFiles = listSkillFiles(srcRoot)
  for (const rel of srcFiles) {
    const dest = path.join(destRoot, rel)
    if (!fs.existsSync(dest)) return { name, state: 'DRIFT', detail: `${rel} is missing` }
    if (sha256Short(fs.readFileSync(path.join(srcRoot, rel))) !== sha256Short(fs.readFileSync(dest))) {
      return { name, state: 'DRIFT', detail: rel }
    }
  }
  const stale = listSkillFiles(destRoot).find(rel => !srcFiles.includes(rel))
  if (stale) return { name, state: 'DRIFT', detail: `${stale} is not in the source` }
  const srcSkill = path.join(srcRoot, 'SKILL.md')
  const destSkill = path.join(destRoot, 'SKILL.md')
  return { name, state: sameFile(srcSkill, destSkill) ? 'same-file' : 'equal-copy' }
}

function skillDriftReport(source, roots) {
  const rows = []
  for (const root of roots) {
    for (const name of source.names) rows.push({ root, ...checkSkill({ dir: source.dir, name, root }) })
  }
  const bad = rows.filter(r => r.state === 'DRIFT' || r.state === 'absent' || (r.state === 'equal-copy' && !source.disposable))
  for (const r of bad) {
    const where = path.join(r.root, r.name, 'SKILL.md')
    if (r.state === 'absent') {
      console.log(`MISSING ${r.name} at ${where}: no installed link or copy; the next dispatch will not serve this skill`)
      continue
    }
    const why = r.state === 'DRIFT'
      ? `contents differ${r.detail ? ` (${r.detail})` : ''}`
      : 'contents match but it is a SEPARATE file, so the next source edit will not reach it'
    console.log(`DRIFT ${r.name} at ${where} (${r.state}): ${why}`)
  }
  if (bad.length === 0) {
    console.log(source.disposable
      ? `skill check: every installed skill is a current copy of ${source.dir}`
      : 'skill check: every installed skill is the source file')
  }
  return bad
}

function installOrCheckSkills() {
  const source = resolveLocalSkillSource()
  if (!source) {
    if (checkSkills) {
      console.log('skill check: no local gm skill source (no ./skills beside this installer, GM_SKILL_SOURCE_DIR unset) -- nothing to compare')
      return
    }
    runChild('npx', ['-y', 'skills', 'add', 'AnEntrypoint/gm', ...(global ? ['-g'] : []), '-y'], { shell: IS_WINDOWS })
    return
  }
  const roots = skillInstallRoots()
  console.log(`gm-skill source: ${source.dir}${source.fromEnv ? ' (GM_SKILL_SOURCE_DIR)' : ''} -- ${source.names.length} skill(s)`)
  if (checkSkills) {
    return skillDriftReport(source, roots)
  }
  for (const root of roots) {
    for (const name of source.names) materialiseSkill({ dir: source.dir, name, root, copyOnly: source.disposable })
  }
  skillDriftReport(source, roots)
}

if (checkSkills) {
  const drift = installOrCheckSkills()
  process.exit(drift && drift.length > 0 ? 1 : 0)
}

if (!mcpOnly) {
  installOrCheckSkills()
  if (skillsOnly) process.exit(0)
}

function isLegacyNpxEntry(entry) {
  return entry && entry.command === 'npx' && Array.isArray(entry.args) && entry.args.includes(LEGACY_NPX_SPEC)
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
  const launch = IS_WINDOWS ? [`"node ${MCP_BUNDLE_PATH}"`] : [process.execPath, '--args', MCP_BUNDLE_PATH]
  runChild('npx', ['-y', 'add-mcp', ...launch, '-n', 'gm', ...scopeFlag, '-y'], { shell: IS_WINDOWS })
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
    fs.renameSync(tmp, configPath)
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
registerOtherHosts()
registerKnownHostShapes()
registerClaudeCode()
if (!mcpOnly) installRunner()
console.log(`gm MCP server launches from ${pathToFileURL(MCP_BUNDLE_PATH).href} -- restart the agent host to reconnect`)
