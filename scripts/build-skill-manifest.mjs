#!/usr/bin/env node
// Writes skills/manifest.sha256: one "<sha256>  <path>" line per file under skills/,
// paths relative to skills/, sorted. The installed-skill refresh in agentplug-runner
// fetches this one file each cycle and re-fetches only the files whose digest changed,
// so every copy install tracks every skill file (SKILL.md, prose, docs, references,
// data) and picks up new skills, not just a SKILL.md edit after a gm plugin bump.
//
// Usage:
//   node scripts/build-skill-manifest.mjs          write skills/manifest.sha256
//   node scripts/build-skill-manifest.mjs --check  exit 1 when the committed manifest is stale

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(root, 'skills')
const manifestPath = join(skillsDir, 'manifest.sha256')
const checkOnly = process.argv.includes('--check')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (lstatSync(full).isSymbolicLink() && !existsSync(full)) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function buildManifest() {
  const lines = walk(skillsDir)
    .map((file) => relative(skillsDir, file).split(sep).join('/'))
    .filter((rel) => rel !== 'manifest.sha256')
    .sort()
    .map((rel) => {
      const digest = createHash('sha256').update(readFileSync(join(skillsDir, rel))).digest('hex')
      return `${digest}  ${rel}`
    })
  return `${lines.join('\n')}\n`
}

const next = buildManifest()
if (checkOnly) {
  const committed = readFileSync(manifestPath, 'utf8')
  if (committed !== next) {
    console.log('skills/manifest.sha256 is stale: run node scripts/build-skill-manifest.mjs and commit it with the skill change')
    process.exit(1)
  }
  console.log('skills/manifest.sha256 is current')
  process.exit(0)
}
writeFileSync(manifestPath, next)
console.log(`wrote ${manifestPath} (${next.split('\n').length - 1} files)`)
