import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const [repo, sha] = process.argv.slice(2)
if (!repo || !sha) {
  console.error('usage: gm-mcp-bin-fresh.mjs <repo> <sha>')
  process.exit(2)
}

const execFileP = promisify(execFile)
const gh = async (route) => JSON.parse((await execFileP('gh', ['api', route], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout)
const blobText = async (blobSha) => Buffer.from((await gh(`repos/AnEntrypoint/${repo}/git/blobs/${blobSha}`)).content, 'base64').toString('utf8')

const BUNDLE_ENTRIES = ['src/cli.js', 'src/fast-entry.js']
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g
const CONCURRENCY = Number(process.env.BIN_FRESH_CONCURRENCY || 8)

const bin = await blobText((await gh(`repos/AnEntrypoint/${repo}/contents/bin/gm-mcp-server.js?ref=${sha}`)).sha)
const recorded = bin.slice(0, 4000).match(/BUNDLE_SRC_SHA256 = "([0-9a-f]{64})"/)
if (!recorded) {
  console.log(`stale: no BUNDLE_SRC_SHA256 in bin/gm-mcp-server.js at ${sha.slice(0, 9)}`)
  process.exit(1)
}

const tree = (await gh(`repos/AnEntrypoint/${repo}/git/trees/${sha}?recursive=1`)).tree
const blobOf = new Map(tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))

function resolveRelativeImport(fromRel, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const candidate of [base, base + '.js', base + '/index.js']) {
    if (blobOf.has(candidate)) return candidate
  }
  return null
}

const seen = new Set()
const pending = BUNDLE_ENTRIES.filter((rel) => blobOf.has(rel))
const texts = new Map()
while (pending.length) {
  const batch = pending.splice(0, CONCURRENCY).filter((rel) => !seen.has(rel))
  if (!batch.length) continue
  batch.forEach((rel) => seen.add(rel))
  const fetched = await Promise.all(batch.map(async (rel) => [rel, (await blobText(blobOf.get(rel))).replace(/\r\n?/g, '\n')]))
  for (const [rel, text] of fetched) {
    texts.set(rel, text)
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const next = resolveRelativeImport(rel, match[1])
      if (next && !seen.has(next)) pending.push(next)
    }
  }
}

const hash = createHash('sha256')
for (const rel of [...seen].sort()) {
  hash.update(rel).update('\0').update(texts.get(rel)).update('\0')
}
const computed = hash.digest('hex')
if (computed === recorded[1]) {
  console.log(`fresh: bin matches src at ${sha.slice(0, 9)}`)
  process.exit(0)
}
console.log(`stale: bin records ${recorded[1].slice(0, 12)} but src hashes to ${computed.slice(0, 12)} at ${sha.slice(0, 9)}`)
process.exit(1)
