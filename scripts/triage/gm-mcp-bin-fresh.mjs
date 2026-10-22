import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const [repo, sha] = process.argv.slice(2)
if (!repo || !sha) {
  console.error('usage: gm-mcp-bin-fresh.mjs <repo> <sha>')
  process.exit(2)
}

const gh = (route) => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const blobText = (blobSha) => Buffer.from(gh(`repos/AnEntrypoint/${repo}/git/blobs/${blobSha}`).content, 'base64').toString('utf8')

const bin = blobText(gh(`repos/AnEntrypoint/${repo}/contents/bin/gm-mcp-server.js?ref=${sha}`).sha)
const recorded = bin.slice(0, 4000).match(/BUNDLE_SRC_SHA256 = "([0-9a-f]{64})"/)
if (!recorded) {
  console.log(`stale: no BUNDLE_SRC_SHA256 in bin/gm-mcp-server.js at ${sha.slice(0, 9)}`)
  process.exit(1)
}

const srcEntries = gh(`repos/AnEntrypoint/${repo}/git/trees/${sha}?recursive=1`).tree
  .filter((e) => e.type === 'blob' && /^src\/[^/]+\.js$/.test(e.path))
  .map((e) => ({ name: e.path.slice(4), blob: e.sha }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

const hash = createHash('sha256')
for (const { name, blob } of srcEntries) {
  hash.update(name).update('\0').update(blobText(blob).replace(/\r\n?/g, '\n')).update('\0')
}
const computed = hash.digest('hex')
if (computed === recorded[1]) {
  console.log(`fresh: bin matches src at ${sha.slice(0, 9)}`)
  process.exit(0)
}
console.log(`stale: bin records ${recorded[1].slice(0, 12)} but src hashes to ${computed.slice(0, 12)} at ${sha.slice(0, 9)}`)
process.exit(1)
