#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const USAGE = [
    'Usage: gm [version] [-g|--global] [--mcp-only] [-h|--help]',
    'Usage: gm dispatch <verb> [--body <json|@file|->] [--raw <text|@file|->] [--cwd <dir>] [--help]',
    'Usage: gm mcp-status',
    '',
    'Installs or repairs the gm skill, local MCP registration, and runner.',
    '  version         print the version of this gm checkout',
    '  -g, --global    register for every agent host (user scope)',
    '  --mcp-only      repair MCP registrations only, no skill or runner install',
    '  dispatch        run a gm verb from the shell, with no MCP client involved',
    '  mcp-status      report the gm MCP registration and whether the server answers',
    '',
    'A running agent host cannot gain the mcp__gm__* tools: it fixes its tool list at',
    'startup and nothing outside the session adds to it. New sessions have them.',
    'For live dispatch in a session that predates the registration, use `gm dispatch`.',
].join('\n')

const FLAGS = new Set(['-g', '--global', '--mcp-only', '-h', '--help'])
const VERSION_FLAGS = new Set(['version', '--version', '-v'])
const SUBCOMMANDS = new Set(['dispatch', 'mcp-status'])

const argv = process.argv.slice(2)
const global = argv.includes('-g') || argv.includes('--global')
const mcpOnly = argv.includes('--mcp-only')
const help = argv[0] === '-h' || argv[0] === '--help'
const subcommand = argv[0]
const unknownArgs = SUBCOMMANDS.has(subcommand) ? [] : argv.filter(arg => !FLAGS.has(arg) && !VERSION_FLAGS.has(arg))

const GM_TOOLS_DIR = path.join(os.homedir(), '.gm-tools')
const MCP_BUNDLE_PATH = path.join(GM_TOOLS_DIR, 'gm-mcp-server.mjs')
const MCP_BUNDLE_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js'
const LEGACY_NPX_SPEC = 'github:AnEntrypoint/gm-mcp'

function defaultHttpPort() {
    const fromEnv = Number((process.env.GM_MCP_HTTP_PORT || '').trim())
    return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 8787
}

const MCP_URL = `http://127.0.0.1:${defaultHttpPort()}/mcp`

if (help) {
    console.log(USAGE)
    process.exit(0)
}

if (unknownArgs.length > 0) {
    console.error(`gm: unrecognised ${unknownArgs.length === 1 ? 'argument' : 'arguments'}: ${unknownArgs.join(' ')}`)
    console.error(USAGE)
    process.exit(2)
}

if (argv.some(arg => VERSION_FLAGS.has(arg))) {
    const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    console.log(readJson(path.join(pkgRoot, 'package.json'))?.version ?? 'unknown')
    process.exit(0)
}

const PROJECT_LAUNCH_SNIPPET =
    "const p=require('path').join(require('os').homedir(),'.gm-tools','gm-mcp-server.mjs');" +
    "if(!require('fs').existsSync(p)){console.error('gm-mcp bundle missing at '+p+' -- run: npx github:AnEntrypoint/gm --mcp-only');process.exit(1)}" +
    "import(require('url').pathToFileURL(p).href)"

// One unwritable host config used to abort the whole run before Claude Code was
// reached, so a failure on a host nobody here uses left the one host that matters
// unregistered. Every registration step now reports and the run continues.
// cmd.exe gets one concatenated line and does no escaping of its own, so every
// argument has to arrive quoted: node lives under "C:\Program Files\..." and any
// --body JSON carries spaces, either of which otherwise lands as an unknown command.
function cmdQuote(value) {
    const text = String(value)
    if (!/[\s"^&|<>()!]/.test(text)) return text
    return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

function spawnTolerant(cmd, args, timeoutMs) {
    const options = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, timeout: timeoutMs }
    if (process.platform === 'win32') return spawnSync([cmd, ...args].map(cmdQuote).join(' '), { ...options, shell: true })
    return spawnSync(cmd, args, options)
}

function runTolerant(cmd, args, timeoutMs = 120_000) {
    let res
    try {
        res = spawnTolerant(cmd, args, timeoutMs)
    } catch (error) {
        return { ok: false, error: error.message }
    }
    if (res.error) return { ok: false, error: res.error.message }
    return {
        ok: res.status === 0,
        status: res.status,
        stdout: (res.stdout ?? '').trim(),
        stderr: (res.stderr ?? '').trim(),
    }
}

function runBundle(args, timeoutMs = 120_000) {
    return runTolerant(process.execPath, [MCP_BUNDLE_PATH, ...args], timeoutMs)
}

function globalServerEntry() {
    return { command: 'node', args: [MCP_BUNDLE_PATH] }
}

function projectServerEntry() {
    return { command: 'node', args: ['-e', PROJECT_LAUNCH_SNIPPET] }
}

function httpServerEntry() {
    return { type: 'http', url: MCP_URL }
}

// A missing network used to make the whole installer throw here, even though a
// bundle already on disk is enough to register and to dispatch against. So does
// the reverse: the deployed bundle can be ahead of the release channel (a local
// build), and overwriting it with the downloaded one would take `gm dispatch`
// away again, so a bundle that is pinned or newer is left exactly as it is.
async function vendorMcpBundleTolerant() {
    const pin = readJson(path.join(os.homedir(), '.agentplug', 'gm-mcp-server.local-build.json'))
    if (pin && pin.path === MCP_BUNDLE_PATH && fs.existsSync(MCP_BUNDLE_PATH)) {
        console.log(`gm-mcp server pinned as a local build at ${MCP_BUNDLE_PATH} -- left as it is`)
        return true
    }
    try {
        const res = await fetch(MCP_BUNDLE_URL)
        if (!res.ok) throw new Error(`fetch ${MCP_BUNDLE_URL} -> HTTP ${res.status}`)
        const body = await res.text()
        if (!body.startsWith('#!/usr/bin/env node')) throw new Error(`unexpected bundle head from ${MCP_BUNDLE_URL}`)
        const deployed = deployedBundleInfo()
        if (deployed && deployedSupersedes(deployed, bundleVersionOf(body))) {
            console.log(`gm-mcp server at ${MCP_BUNDLE_PATH} is ${deployed.version} with dispatch -- newer than or equal to the release channel, left as it is`)
            return true
        }
        writeMcpBundle(body)
        return true
    } catch (error) {
        if (fs.existsSync(MCP_BUNDLE_PATH)) {
            console.log(`gm: could not refresh the gm-mcp bundle (${error.message}); keeping the one at ${MCP_BUNDLE_PATH}`)
            return true
        }
        console.log(`gm: could not fetch the gm-mcp bundle (${error.message}) and none is deployed at ${MCP_BUNDLE_PATH}`)
        return false
    }
}

function writeMcpBundle(body) {
    fs.mkdirSync(GM_TOOLS_DIR, { recursive: true })
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

function bundleVersionOf(text) {
    return text.match(/^gm-mcp (\d+\.\d+\.\d+)/m)?.[1] ?? null
}

function deployedBundleInfo() {
    if (!fs.existsSync(MCP_BUNDLE_PATH)) return null
    const help = runBundle(['--help'], 120_000)
    if (!help.ok) return null
    const version = bundleVersionOf(help.stdout)
    const dispatch = runBundle(['dispatch', '--help'], 120_000)
    return { version, hasDispatch: dispatch.ok }
}

function versionAtLeast(left, right) {
    if (!left || !right) return false
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0)
        if (diff !== 0) return diff > 0
    }
    return true
}

function deployedSupersedes(deployed, remoteVersion) {
    return deployed.hasDispatch && versionAtLeast(deployed.version, remoteVersion)
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

// A {type:"http", url} entry is the durable transport: the client reaches a
// shared server it can reconnect to, where a stdio child dies with its pipe.
// Rewriting one back to stdio would trade that away on every installer run.
function isHttpEntry(entry) {
    if (!entry || typeof entry !== 'object') return false
    if (String(entry.type ?? entry.transport ?? '').toLowerCase() === 'http') return true
    return typeof entry.url === 'string' && entry.url.length > 0 && !entry.command
}

function isCurrentHttpEntry(entry) {
    return isHttpEntry(entry) && String(entry.url).replace(/\/+$/, '') === MCP_URL.replace(/\/+$/, '')
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
    if (isHttpEntry(existing)) {
        if (!isCurrentHttpEntry(existing)) {
            console.log(`kept the HTTP gm MCP server in ${label} (${existing.url}) -- a durable transport on a different port than ${MCP_URL}`)
        }
        return false
    }
    if (isCurrentEntry(existing, wanted)) return false
    servers.gm = wanted
    console.log(`registered gm MCP server in ${label}${isLegacyNpxEntry(existing) ? ' (replaced legacy npx github spec)' : ''}`)
    return true
}

function claudeOnPath() {
    const res = runTolerant('claude', ['--version'], 60_000)
    return res.ok ? res : null
}

function claudeScope() {
    return 'user'
}

// `claude mcp add` is the supported way in, so prefer it over editing the config
// by hand: it validates the entry and writes the scope the host actually reads.
function registerClaudeCodeWithCli() {
    const scope = claudeScope()
    const addArgs = ['mcp', 'add', '--transport', 'http', 'gm', MCP_URL, '-s', scope]
    const add = runTolerant('claude', addArgs, 180_000)
    if (add.ok) {
        console.log(`registered gm MCP server with claude mcp add (-s ${scope}) -- ${MCP_URL}`)
        return true
    }
    const detail = add.stderr || add.stdout || add.error || 'no output'
    if (/already exists/i.test(detail)) {
        const current = runTolerant('claude', ['mcp', 'get', 'gm'], 120_000)
        if (current.stdout.includes(MCP_URL)) {
            console.log(`gm MCP server already registered in Claude Code (${scope} scope) -- ${MCP_URL}`)
            return true
        }
        runTolerant('claude', ['mcp', 'remove', 'gm', '-s', scope], 120_000)
        const retry = runTolerant('claude', addArgs, 180_000)
        if (retry.ok) {
            console.log(`replaced the stale gm MCP registration with ${MCP_URL} (-s ${scope})`)
            return true
        }
        console.log(`gm: could not replace the existing gm registration -- ${retry.stderr || retry.stdout || retry.error || 'unknown error'}`)
        return false
    }
    console.log(`gm: claude mcp add did not register gm -- ${detail}`)
    return false
}

// A project-scope entry outranks the user-scope one and needs per-project
// approval before it connects, so the session it lands in shows gm as pending
// and exposes no tools at all -- which is exactly the failure this installer
// exists to prevent. One server shared by every project belongs at user scope,
// so a project entry gm recognises as its own gets taken back out.
function isOwnLauncherEntry(entry) {
    if (!entry || typeof entry !== 'object') return false
    if (isLegacyNpxEntry(entry)) return true
    const args = Array.isArray(entry.args) ? entry.args.join(' ') : ''
    const joined = `${String(entry.command ?? '')} ${args} ${String(entry.url ?? '')}`
    return /gm-mcp-server\.mjs|gm-mcp|pathToFileURL/.test(joined)
}

function dropOwnProjectMcpEntry() {
    const file = path.join(process.cwd(), '.mcp.json')
    const config = readJson(file)
    const entry = config?.mcpServers?.gm
    if (!entry) return
    if (!isOwnLauncherEntry(entry)) {
        console.log(`gm: ${file} declares its own gm server -- left as it is (project scope needs per-project approval, so the user-scope entry is the one that connects)`)
        return
    }
    delete config.mcpServers.gm
    if (Object.keys(config.mcpServers).length === 0) {
        fs.rmSync(file, { force: true })
        console.log(`gm: removed ${file} -- its project-scope gm entry shadowed the user-scope one and stayed pending`)
        return
    }
    writeJsonAtomic(file, config)
    console.log(`gm: removed the project-scope gm entry from ${file} -- user scope covers every project without per-project approval`)
}

function registerClaudeCode() {
    if (claudeOnPath() && registerClaudeCodeWithCli()) {
        dropOwnProjectMcpEntry()
        return
    }
    if (writeUserScopeRegistration()) {
        dropOwnProjectMcpEntry()
        return
    }

    const projectConfigPath = path.join(process.cwd(), '.mcp.json')
    const projectConfig = readJson(projectConfigPath) ?? {}
    projectConfig.mcpServers ||= {}
    if (upsertGmServer(projectConfig.mcpServers, projectServerEntry(), `${projectConfigPath} mcpServers`, true)) writeJsonAtomic(projectConfigPath, projectConfig)
    console.log(`gm: no user-scope Claude Code config to write, so gm is registered in ${projectConfigPath} instead -- that scope needs per-project approval`)
}

function writeUserScopeRegistration() {
    const userConfigPath = path.join(os.homedir(), '.claude.json')
    const userConfig = readJson(userConfigPath)
    if (!userConfig || typeof userConfig !== 'object') return false
    userConfig.mcpServers ||= {}
    let changed = upsertGmServer(userConfig.mcpServers, httpServerEntry(), `${userConfigPath} mcpServers`, true)
    for (const [projectPath, project] of Object.entries(userConfig.projects || {})) {
        changed = upsertGmServer(project?.mcpServers, httpServerEntry(), `${userConfigPath} projects[${projectPath}].mcpServers`, false) || changed
    }
    if (changed) writeJsonAtomic(userConfigPath, userConfig)
    return true
}

// add-mcp writes whatever project it is run in, and hands the command over as one
// string, so an unquoted Windows path lands as a broken stdio entry in the very
// .mcp.json that then shadows the good registration. It only ever has to register
// other hosts at user scope; Claude Code is handled above.
function registerOtherHosts() {
    const launch = `node ${MCP_BUNDLE_PATH}`
    const res = runTolerant('npx', ['-y', 'add-mcp', process.platform === 'win32' ? `"${launch}"` : launch, '-n', 'gm', '-g', '-y'], 180_000)
    if (res.ok) console.log('registered gm MCP server with add-mcp (other agent hosts, user scope)')
    else console.log(`gm: add-mcp registration skipped -- ${res.stderr || res.error || 'add-mcp did not run'}`)
}

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

// PowerShell ships a built-in `gm` alias for Get-Member, and an alias outranks
// an external command, so on Windows the npm shim is unreachable from
// PowerShell until the alias is removed in a profile that loads before use.
const POWERSHELL_ALIAS_FIX = [
    '$line = \'Remove-Item Alias:\\gm -Force -ErrorAction SilentlyContinue\'',
    '$marker = \'# gm: PowerShell ships a built-in gm alias (Get-Member) that outranks the gm command\'',
    'foreach ($profilePath in @($PROFILE, $PROFILE.CurrentUserAllHosts)) {',
    '  if (-not $profilePath) { continue }',
    '  $dir = Split-Path -Parent $profilePath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }',
    '  $text = if (Test-Path -LiteralPath $profilePath) { Get-Content -LiteralPath $profilePath -Raw } else { \'\' }',
    '  if ($text -and $text.Contains($line)) { continue }',
    '  $prefix = if ($text -and -not $text.EndsWith("`n")) { "`n" } else { \'\' }',
    '  Add-Content -LiteralPath $profilePath -Value ($prefix + $marker + "`n" + $line + "`n") -NoNewline',
    '  Write-Host "gm: removed the PowerShell gm alias in $profilePath -- open a new PowerShell to use gm there"',
    '}',
].join('\n')

function unblockPowerShellAlias() {
    if (process.platform !== 'win32') return
    const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_ALIAS_FIX], { stdio: 'inherit', windowsHide: true })
    if (res.error) {
        console.log(`gm: could not update the PowerShell profile (${res.error.message}); run 'Remove-Item Alias:\\gm -Force' in PowerShell to use gm there`)
    }
}

function installSkill() {
    const res = runTolerant('npx', ['-y', 'skills', 'add', 'AnEntrypoint/gm', ...(global ? ['-g'] : []), '-y'], 300_000)
    if (res.ok) console.log('installed or updated the gm skill')
    else console.log(`gm: skill install skipped -- ${res.stderr || res.error || 'skills add did not run'}`)
}

// The runner is a spool daemon, not something the MCP registration depends on,
// so a failure here must never stop the run before the registration is written.
function installRunner() {
    const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    const installSh = path.join(pkgRoot, 'install.sh')
    const installPs1 = path.join(pkgRoot, 'install.ps1')
    const res = process.platform === 'win32'
        ? (fs.existsSync(installPs1)
            ? runTolerant('powershell', ['-ExecutionPolicy', 'Bypass', '-File', installPs1, 'spool'], 300_000)
            : runTolerant('powershell', ['-Command', 'irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main spool'], 300_000))
        : (fs.existsSync(installSh)
            ? runTolerant('sh', [installSh, 'spool'], 300_000)
            : runTolerant('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool'], 300_000))
    if (res.ok) console.log('installed the gm spool runner')
    else console.log(`gm: runner install skipped -- ${res.stderr || res.error || 'the installer did not run'}`)
}

function startHttpServer() {
    if (!fs.existsSync(MCP_BUNDLE_PATH)) return null
    const res = runBundle(['ensure-http'], 180_000)
    if (!res.ok) {
        console.log(`gm: the shared HTTP server did not start -- ${res.stderr || res.error || 'ensure-http gave no output'}`)
        return null
    }
    for (const line of res.stdout.split('\n')) {
        if (line.trim()) console.log(line.trim())
    }
    return res.stdout
}

function readHttpStatus() {
    if (!fs.existsSync(MCP_BUNDLE_PATH)) return null
    const res = runBundle(['http-status'], 120_000)
    if (!res.ok) return null
    try {
        return JSON.parse(res.stdout)
    } catch {
        return null
    }
}

function claudeRegistrationLine() {
    const claude = claudeOnPath()
    if (!claude) return { text: 'claude CLI not on PATH', known: null }
    const list = runTolerant('claude', ['mcp', 'list'], 180_000)
    const line = (list.stdout || '').split('\n').find(candidate => /(^|[\s:])gm\b/.test(candidate) && candidate.includes('gm'))
    if (!line) return { text: `not listed by claude mcp list${list.stderr ? ` (${list.stderr.split('\n')[0]})` : ''}`, known: false }
    return { text: line.trim(), known: /Connected/i.test(line) }
}

const REMEDY_LINES = [
    '',
    'A running agent host cannot gain these tools. Claude Code fixes its tool list at',
    'startup and nothing outside the session adds to it: reload_plugins and mcp_reconnect',
    'both refuse a server that was not in the config at startup, and no file watcher',
    're-reads mcpServers. So pick the line that matches this session:',
    '',
    '  gm already listed under /mcp   ->   /mcp reconnect gm',
    '  gm missing from /mcp           ->   restart the agent host (new sessions have it)',
    '  register or repair it yourself ->   ! claude mcp add --transport http gm ' + MCP_URL + ' -s user',
    '',
    'No MCP needed -- dispatch the same verbs from the shell:',
    '  gm dispatch grep --body {"pattern":"foo","output_mode":"content"} --cwd C:/dev/proj',
    '  gm dispatch codesearch --body {"query":"chunk merger"} --cwd C:/dev/proj',
    '  gm dispatch --help',
]

function reportMcpReachability() {
    const status = readHttpStatus()
    const registration = claudeRegistrationLine()
    console.log(`gm MCP server: ${MCP_URL}`)
    console.log(`  server:      ${status ? (status.running ? 'answering' : 'not answering') : 'status unavailable'}`)
    console.log(`  claude mcp:  ${registration.text}`)
    console.log(REMEDY_LINES.join('\n'))
}

function mcpStatusCommand() {
    reportMcpReachability()
    return 0
}

async function dispatchCommand() {
    if (!fs.existsSync(MCP_BUNDLE_PATH) && !(await vendorMcpBundleTolerant())) {
        console.error(`gm: no gm-mcp bundle at ${MCP_BUNDLE_PATH}, so dispatch cannot run`)
        return 1
    }
    const res = spawnSync(process.execPath, [MCP_BUNDLE_PATH, 'dispatch', ...process.argv.slice(3)], {
        stdio: 'inherit',
        windowsHide: true,
    })
    if (res.error) {
        console.error(`gm: dispatch could not start -- ${res.error.message}`)
        return 1
    }
    return res.status ?? 1
}

if (subcommand === 'dispatch') {
    process.exit(await dispatchCommand())
}

if (subcommand === 'mcp-status') {
    process.exit(mcpStatusCommand())
}

unblockPowerShellAlias()
if (!mcpOnly) installSkill()
const haveBundle = await vendorMcpBundleTolerant()
if (haveBundle) startHttpServer()
registerOtherHosts()
registerKnownHostShapes()
registerClaudeCode()
if (!mcpOnly && haveBundle) installRunner()
if (haveBundle) reportMcpReachability()
else console.log(`gm: MCP registration was left as it is -- the gm-mcp bundle is missing from ${MCP_BUNDLE_PATH}`)
