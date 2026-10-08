import fs from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SESSION_ID = 'f73df536-0f66-49a1-8888-2a064d23416a'
const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_CHARS = 6000
const POLL_INTERVAL_MS = 250
const FINAL_RECHECK_WINDOW_MS = 2500
const FINAL_RECHECK_INTERVAL_MS = 150
const MARKER_GRACE_MS = 60
const READ_ATTEMPTS = 3

const DEADLINE_AWARE_VERBS = new Set(['codesearch', 'codeinsight', 'instruction', 'recall'])

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function randomSuffix() {
    return Math.random().toString(36).slice(2, 10).padEnd(8, 'x')
}

function option(name, fallback) {
    const i = process.argv.indexOf(`--${name}`)
    if (i === -1) return fallback
    const value = process.argv[i + 1]
    return value === undefined || value.startsWith('--') ? fallback : value
}

function numberOption(name, fallback) {
    const value = Number(option(name, undefined))
    return Number.isFinite(value) && value > 0 ? value : fallback
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function writeInputAtomically(target, body) {
    const temporary = `${target}.tmp`
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
        fs.writeFileSync(temporary, body, 'utf8')
        fs.renameSync(temporary, target)
        return true
    } catch {
        try {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
        } catch {}
        fs.writeFileSync(target, body, 'utf8')
        return false
    }
}

function sizeOf(file) {
    try {
        return fs.statSync(file).size
    } catch {
        return null
    }
}

function findOutput(outDir, verb, task, suffix) {
    let names
    try {
        names = fs.readdirSync(outDir)
    } catch {
        return null
    }
    const exact = `${verb}-${task}.json`
    if (names.includes(exact)) return path.join(outDir, exact)
    const match = names.find((n) => n.startsWith(`${verb}-`) && n.includes(suffix) && n.endsWith('.json'))
    return match ? path.join(outDir, match) : null
}

function waitForSpoolChange(outDir, outPath, waitMs) {
    return new Promise((resolve) => {
        let watcher
        let wakeTimer
        let fallbackTimer
        let settled = false
        const outName = path.basename(outPath)
        const finish = (source) => {
            if (settled) return
            settled = true
            clearTimeout(wakeTimer)
            clearTimeout(fallbackTimer)
            watcher?.close()
            resolve(source)
        }
        try {
            watcher = fs.watch(outDir, { persistent: false }, (_event, filename) => {
                if (filename == null) return
                const name = filename.toString()
                if (name === outName || name === `${outName}.ready`) finish('filesystem_event')
            })
            watcher.on('error', () => {
                watcher?.close()
                watcher = undefined
            })
        } catch {
            watcher = undefined
        }
        wakeTimer = setTimeout(() => finish('deadline'), Math.max(1, waitMs))
        fallbackTimer = setTimeout(() => finish('fallback_poll'), Math.min(Math.max(25, POLL_INTERVAL_MS), Math.max(1, waitMs)))
    })
}

async function bodyComplete(outPath) {
    if (fs.existsSync(`${outPath}.ready`)) return true
    const first = sizeOf(outPath)
    if (first === null) return false
    await sleep(MARKER_GRACE_MS)
    if (fs.existsSync(`${outPath}.ready`)) return true
    return sizeOf(outPath) === first
}

async function readLanded(outPath) {
    if (!fs.existsSync(outPath)) return undefined
    if (!(await bodyComplete(outPath))) return undefined
    for (let attempt = 1; ; attempt++) {
        try {
            return { ok: true, text: fs.readFileSync(outPath, 'utf8') }
        } catch (e) {
            if (attempt >= READ_ATTEMPTS) return { ok: false, error: `response file could not be read: ${e.message}` }
            await sleep(MARKER_GRACE_MS)
            if (!(await bodyComplete(outPath))) return undefined
        }
    }
}

async function main() {
    const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'))
    const verb = positional[0]
    if (!verb) {
        console.error('gm-dispatch: usage: node scripts/lib/gm-dispatch.mjs <verb> [body-json] [--timeout-ms N] [--chars N] [--root <dir>] [--session-id <id>]')
        process.exit(2)
    }
    const timeoutMs = numberOption('timeout-ms', DEFAULT_TIMEOUT_MS)
    const maxChars = numberOption('chars', DEFAULT_CHARS)
    const root = path.resolve(option('root', undefined) || SCRIPT_ROOT)
    const sessionId = option('session-id', undefined) || process.env.GM_SESSION_ID || DEFAULT_SESSION_ID

    const raw = positional[1]
    let parsed
    try {
        parsed = raw && raw.trim() ? JSON.parse(raw.trim()) : {}
    } catch (e) {
        console.error(`gm-dispatch: body is not valid JSON: ${e.message}`)
        process.exit(2)
    }
    if (parsed.session_id === undefined) parsed.session_id = sessionId
    let body = JSON.stringify(parsed)
    if (DEADLINE_AWARE_VERBS.has(verb)) body = `timeoutMs=${Math.max(1000, Math.round(timeoutMs - 1500))}\n${body}`

    const spool = path.join(root, '.gm', 'exec-spool')
    const outDir = path.join(spool, 'out')
    fs.mkdirSync(outDir, { recursive: true })

    const suffix = randomSuffix()
    const task = `${sessionId}-${suffix}`
    const inPath = path.join(spool, 'in', verb, `${task}.txt`)
    const renamed = writeInputAtomically(inPath, body)

    const deadline = Date.now() + timeoutMs
    let wakeSource = 'initial_check'
    while (true) {
        let outPath = findOutput(outDir, verb, task, suffix)
        if (outPath) {
            const landed = await readLanded(outPath)
            if (landed !== undefined) {
                let text = landed.ok ? landed.text : landed.error
                let truncated = false
                if (text.length > maxChars) {
                    text = text.slice(0, maxChars)
                    truncated = true
                }
                console.log(`gm-dispatch: ${verb} ${suffix} atomic-rename=${renamed} wake=${wakeSource} out=${outPath}`)
                if (truncated) console.log(`gm-dispatch: truncated to ${maxChars} char(s); full response at ${outPath}`)
                console.log(text)
                process.exit(landed.ok ? 0 : 1)
            }
        }
        if (Date.now() >= deadline) {
            const recheckDeadline = Date.now() + FINAL_RECHECK_WINDOW_MS
            while (true) {
                const outPath = findOutput(outDir, verb, task, suffix)
                if (outPath) {
                    const landed = await readLanded(outPath)
                    if (landed !== undefined) {
                        let text = landed.ok ? landed.text : landed.error
                        let truncated = false
                        if (text.length > maxChars) {
                            text = text.slice(0, maxChars)
                            truncated = true
                        }
                        console.log(`gm-dispatch: ${verb} ${suffix} atomic-rename=${renamed} wake=${wakeSource} late=true out=${outPath}`)
                        if (truncated) console.log(`gm-dispatch: truncated to ${maxChars} char(s); full response at ${outPath}`)
                        console.log(text)
                        process.exit(landed.ok ? 0 : 1)
                    }
                }
                if (Date.now() >= recheckDeadline) break
                await sleep(FINAL_RECHECK_INTERVAL_MS)
            }
            console.error(`gm-dispatch: ${verb} dispatch ${suffix} produced no response within ${timeoutMs} ms; input left at ${inPath}; resume with --resume-task ${task}`)
            process.exit(1)
        }
        outPath = outPath || path.join(outDir, `${verb}-${task}.json`)
        wakeSource = await waitForSpoolChange(outDir, outPath, deadline - Date.now())
    }
}

main().catch((e) => {
    console.error(`gm-dispatch: harness error: ${e?.message || e}`)
    process.exit(2)
})
