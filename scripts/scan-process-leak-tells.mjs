#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASELINE_PATH = '.process-leak-baseline.json'
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'vendor', 'site', '.gm', 'bin', 'obrowser', 'plugin-cache', 'precompiled'])
const TEXT_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.ps1', '.sh', '.py', '.rs'])

const STARTS_LONG_LIVED = [
    { name: 'listens', re: /\.(listen|listenAndServe)\s*\(/ },
    { name: 'creates-server', re: /(createServer|new\s+Server|http\.server|net\.createServer)\s*\(/ },
    { name: 'detached-child', re: /spawn\s*\([\s\S]{0,400}?detached\s*:\s*true/ },
    { name: 'nohup', re: /\bnohup\b/ },
]

const EXIT_GUARANTEE = [
    /\.(close|stop|shutdown|terminate)\s*\(/,
    /\bprocess\.exit\s*\(/,
    /armVerdictExitGuard\s*\(/,
    /exitAfterQuiesce\s*\(/,
    /process\.once\(\s*['"]exit['"]/,
    /\bunref\s*\(\)/,
]

function walk(dir, files) {
    let names = []
    try {
        names = readdirSync(dir)
    } catch {
        return
    }
    for (const name of names) {
        if (SKIP_DIRS.has(name)) continue
        const full = path.join(dir, name)
        let stat
        try {
            stat = statSync(full)
        } catch {
            continue
        }
        if (stat.isDirectory()) {
            walk(full, files)
            continue
        }
        if (!TEXT_EXT.has(path.extname(name))) continue
        files.push(full)
    }
}

function scanFile(file) {
    let text
    try {
        text = readFileSync(file, 'utf8')
    } catch {
        return []
    }
    const started = STARTS_LONG_LIVED.filter((rule) => rule.re.test(text)).map((rule) => rule.name)
    if (started.length === 0) return []
    if (EXIT_GUARANTEE.some((re) => re.test(text))) return []
    return [{ file, started }]
}

function changedFiles(base) {
    try {
        const text = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], { encoding: 'utf8' })
        return text.split('\n').map((line) => line.trim()).filter(Boolean)
    } catch {
        return null
    }
}

const argv = process.argv.slice(2)
const baselineWrite = argv.includes('--baseline-write')
const diffFlag = argv.find((arg) => arg.startsWith('--diff='))
const positional = argv.filter((arg) => !arg.startsWith('--'))

let targets
if (positional.length > 0) {
    const files = []
    for (const target of positional) {
        if (existsSync(target) && statSync(target).isDirectory()) walk(target, files)
        else files.push(target)
    }
    targets = files
} else if (diffFlag) {
    targets = changedFiles(diffFlag.slice('--diff='.length) || 'origin/main')
    if (targets === null) {
        console.error('scan-process-leak-tells: git diff unavailable, falling back to the whole tree')
        const files = []
        walk(process.cwd(), files)
        targets = files
    }
} else if (baselineWrite) {
    const files = []
    walk(process.cwd(), files)
    targets = files
} else {
    console.error('usage: node scripts/scan-process-leak-tells.mjs [file ...] | --diff=<base> | --baseline-write')
    process.exit(2)
}

targets = targets.filter((file) => TEXT_EXT.has(path.extname(file)) && existsSync(file))
const findings = []
for (const file of targets) findings.push(...scanFile(file))

const normalized = (file) => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')

if (baselineWrite) {
    const baseline = { note: 'pre-existing boot-without-stop files: the leak gate does not fire on these, only on new ones', files: {} }
    for (const finding of findings) baseline.files[normalized(finding.file)] = finding.started.length
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    console.log(`RESULT: PASS (baseline written: ${Object.keys(baseline.files).length} pre-existing file(s) carried)`)
    process.exit(0)
}

let baseline = { files: {} }
try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch {
    console.error(`scan-process-leak-tells: cannot read ${BASELINE_PATH} -- run with --baseline-write first`)
    process.exit(2)
}

const failures = []
for (const finding of findings) {
    const key = normalized(finding.file)
    const allowed = Number(baseline.files?.[key] ?? -1)
    if (allowed < finding.started.length) {
        failures.push(`${key}: starts ${finding.started.join(', ')} with no exit guarantee (baseline allows ${allowed === -1 ? 'nothing -- new file' : allowed})`)
    }
}

console.log(`process-leak gate: ${findings.length} file(s) matched the leak class over ${targets.length} scanned, ${failures.length} over baseline`)
for (const failure of failures) console.log(`  FAIL ${failure}`)
console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'} (${failures.length} failure(s))`)
process.exit(failures.length === 0 ? 0 : 1)
