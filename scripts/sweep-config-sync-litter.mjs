#!/usr/bin/env node
// Sweeps config-sync state litter: {cache}.<16-hex>.sync.json and its siblings. Nothing in
// rs-plugkit ever deletes these, so they accumulate one per (repo,ref) per project root forever,
// and the majority belong to scratch roots whose checkout has already been deleted.
//
// Deleting one is a CACHE MISS, not data loss: the "already at tip" test reads `git rev-parse
// HEAD` in the checkout, never the stored sha, and the file is re-derived on the next sync. So
// the sweep is safe -- but it still refuses to touch anything else sharing the cache root: the
// checkout dir itself, the .lock directory (the single-flight mutex), .staging* and .retired.
//
//   node scripts/sweep-config-sync-litter.mjs [--root <dir>]... [--temp] [--max-age-days N] [--apply]
//
// By default only ORPHANED state is swept (its checkout is gone). --max-age-days N additionally
// sweeps state older than N days even when the checkout survives, which costs the next sync its
// debounce and backoff -- a cache miss, but a real one, so it is opt-in.
//
// Without --apply it only reports. exit 0 always: a sweep is never a gate.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const includeTemp = argv.includes('--temp')
const maxAgeFlag = argv.find((arg) => arg.startsWith('--max-age-days='))
const maxAgeDays = maxAgeFlag ? Number(maxAgeFlag.split('=')[1]) : null
const roots = []
for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--root') continue
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) roots.push(path.resolve(next))
}

const HOME_GM = path.join(homedir(), '.gm')
if (roots.length === 0) roots.push(HOME_GM)
if (includeTemp) roots.push(tmpdir())

const STALE_MS = Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays * 86_400_000 : null
const SYNC_SUFFIXES = ['.sync.json', '.native.sync.json', '.sync.json.stale']
const KEEP_PREFIXES = ['.lock', '.staging', '.retired']
const SCAN_SUBDIRS = new Set(['config-source-cache', 'config-source-remote-probe'])
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'vendor'])
const MAX_DEPTH = 8

function isSyncLitter(name) {
    if (name.endsWith('.tmp')) return false
    if (/\.tmp-\d+$/.test(name)) return true
    for (const suffix of SYNC_SUFFIXES) {
        if (!name.endsWith(suffix)) continue
        const stem = name.slice(0, -suffix.length)
        if (/^[0-9a-f]{16}$/.test(stem.split('.').pop() ?? '')) return true
    }
    return false
}

function scanFilesIn(dir, report) {
    let names = []
    try {
        names = readdirSync(dir)
    } catch {
        return
    }
    for (const name of names) {
        const full = path.join(dir, name)
        let stat
        try {
            stat = statSync(full)
        } catch {
            continue
        }
        if (stat.isDirectory()) continue
        if (KEEP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
        if (!isSyncLitter(name)) continue
        // The checkout this state describes is the sibling named by the part before the key.
        const stem = name.replace(/(\.native)?\.sync\.json(\.stale)?$/, '').replace(/\.tmp-\d+$/, '')
        const checkout = path.join(dir, stem.split('.')[0])
        const orphaned = !existsSync(checkout)
        const ageMs = Date.now() - stat.mtimeMs
        const stale = STALE_MS !== null && ageMs > STALE_MS
        if (!orphaned && !stale) continue
        report.push({ file: full, reason: orphaned ? 'checkout-absent' : `older-than-${maxAgeDays}d`, ageDays: Math.round(ageMs / 86_400_000), bytes: stat.size })
    }
}

function scanGmDir(gmDir, report) {
    scanFilesIn(gmDir, report)
    for (const sub of SCAN_SUBDIRS) scanFilesIn(path.join(gmDir, sub), report)
}

function sweepRoot(root, report) {
    const base = path.basename(root)
    if (base === '.gm') {
        scanGmDir(root, report)
        return
    }
    if (SCAN_SUBDIRS.has(base)) {
        scanFilesIn(root, report)
        return
    }
    const walk = (dir, depth) => {
        if (depth > MAX_DEPTH) return
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
            if (!stat.isDirectory()) continue
            if (name === '.gm') {
                scanGmDir(full, report)
                continue
            }
            walk(full, depth + 1)
        }
    }
    walk(root, 0)
}

const report = []
for (const root of roots) sweepRoot(root, report)

let deleted = 0
let failed = 0
for (const entry of report) {
    if (!apply) continue
    try {
        rmSync(entry.file, { force: true })
        deleted += 1
    } catch {
        failed += 1
    }
}

const byReason = {}
for (const entry of report) byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1
console.log(JSON.stringify({
    apply,
    roots,
    stale_days: maxAgeDays,
    matched: report.length,
    by_reason: byReason,
    deleted,
    failed,
    sample: report.slice(0, 5).map((entry) => entry.file),
}, null, 2))
process.exit(0)
