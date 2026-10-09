#!/usr/bin/env node

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
  let stdout, exitCode
  try {
    stdout = execFileSync('node', [scannerPath, target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000, windowsHide: true })
    exitCode = 0
  } catch (err) {
    stdout = err.stdout || ''
    exitCode = err.status ?? (err.signal ? 'killed:' + err.signal : 1)
  }
  const elapsedMs = Date.now() - start
  const block = `=== ${name} ===\n(exit ${exitCode}, ${elapsedMs}ms)\n${stdout.trim()}\n\n`
  fs.appendFileSync(logPath, block)
  const lastSummaryLine = stdout.trim().split('\n').pop() || ''
  console.error(`${name} (${elapsedMs}ms): ${lastSummaryLine || 'no summary line, exit ' + exitCode}`)
}

console.error('done')
