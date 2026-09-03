#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const global = process.argv.includes('-g') || process.argv.includes('--global')

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    process.exit(res.status ?? 1)
  }
}

const scopeFlag = global ? ['-g'] : []

run('npx', ['-y', 'skills', 'add', 'AnEntrypoint/gm', ...scopeFlag, '-y'])
run('npx', ['-y', 'add-mcp', 'github:AnEntrypoint/gm-mcp', '-n', 'gm', ...scopeFlag, '-y'])

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const installSh = path.join(pkgRoot, 'install.sh')
const installPs1 = path.join(pkgRoot, 'install.ps1')

if (process.platform === 'win32') {
  if (fs.existsSync(installPs1)) {
    run('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', `& '${installPs1}' spool`])
  } else {
    run('powershell', ['-Command', 'irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main spool'])
  }
} else {
  if (fs.existsSync(installSh)) {
    run('sh', [installSh, 'spool'])
  } else {
    run('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool'])
  }
}
