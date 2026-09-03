#!/usr/bin/env node
// Runs scan-supply-chain-tells.mjs once PER top-level project directory under
// a root, appending each project's result to a progress log immediately.
// Resumable: projects already present in the progress log are skipped on a
// re-run, so a kill/timeout never loses completed work and a re-invocation
// picks up where it left off.
//
// Usage: node scripts/scan-dev-tree-chunked.mjs <root> <progressLogPath>

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const root = process.argv[2]
const logPath = process.argv[3]
const scannerPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'scan-supply-chain-tells.mjs')

if (!root || !logPath) {
  console.error('usage: node scan-dev-tree-chunked.mjs <root> <progressLogPath>')
  process.exit(2)
}

const already = new Set()
if (fs.existsSync(logPath)) {
  const prior = fs.readFileSync(logPath, 'utf8')
  for (const m of prior.matchAll(/^=== (.+?) ===$/gm)) already.add(m[1])
}

const entries = fs.readdirSync(root, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

console.error(`${entries.length} project dirs under ${root}, ${already.size} already scanned per ${logPath}`)

for (const name of entries) {
  if (already.has(name)) continue
  const target = path.join(root, name)
  const start = Date.now()
  let out, code
  try {
    out = execFileSync('node', [scannerPath, target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 })
    code = 0
  } catch (err) {
    out = err.stdout || ''
    code = err.status ?? (err.signal ? 'killed:' + err.signal : 1)
  }
  const ms = Date.now() - start
  const block = `=== ${name} ===\n(exit ${code}, ${ms}ms)\n${out.trim()}\n\n`
  fs.appendFileSync(logPath, block)
  const lastSummaryLine = out.trim().split('\n').pop() || ''
  const isClean = /: 0 finding/.test(lastSummaryLine)
  console.error(`[${isClean ? 'clean' : 'FINDINGS'}] ${name} (${ms}ms)`)
}

console.error('done')
