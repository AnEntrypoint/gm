import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const [repo, sha] = process.argv.slice(2)
if (!repo || !sha) {
  console.error('usage: gm-mcp-bin-fresh.mjs <repo> <sha>')
  process.exit(2)
}

const execFileP = promisify(execFile)
const gh = async (route) => JSON.parse((await execFileP('gh', ['api', route], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout)
const blobText = async (blobSha) => Buffer.from((await gh(`repos/AnEntrypoint/${repo}/git/blobs/${blobSha}`)).content, 'base64').toString('utf8')

// One blob per request, so the fetch count is the wall-clock cost: measured at 30.2 s
// wall against 3.9 s CPU for 44 src files. Running them with a bounded fan-out keeps
// the request burst clear of secondary rate limits and moves the cost to one wave.
const CONCURRENCY = Number(process.env.BIN_FRESH_CONCURRENCY || 8)
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const bin = await blobText((await gh(`repos/AnEntrypoint/${repo}/contents/bin/gm-mcp-server.js?ref=${sha}`)).sha)
const recorded = bin.slice(0, 4000).match(/BUNDLE_SRC_SHA256 = "([0-9a-f]{64})"/)
if (!recorded) {
  console.log(`stale: no BUNDLE_SRC_SHA256 in bin/gm-mcp-server.js at ${sha.slice(0, 9)}`)
  process.exit(1)
}

const srcEntries = (await gh(`repos/AnEntrypoint/${repo}/git/trees/${sha}?recursive=1`)).tree
  .filter((e) => e.type === 'blob' && /^src\/[^/]+\.js$/.test(e.path))
  .map((e) => ({ name: e.path.slice(4), blob: e.sha }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

const texts = await mapLimit(srcEntries, CONCURRENCY, async ({ blob }) => (await blobText(blob)).replace(/\r\n?/g, '\n'))

const hash = createHash('sha256')
srcEntries.forEach(({ name }, i) => {
  hash.update(name).update('\0').update(texts[i]).update('\0')
})
const computed = hash.digest('hex')
if (computed === recorded[1]) {
  console.log(`fresh: bin matches src at ${sha.slice(0, 9)}`)
  process.exit(0)
}
console.log(`stale: bin records ${recorded[1].slice(0, 12)} but src hashes to ${computed.slice(0, 12)} at ${sha.slice(0, 9)}`)
process.exit(1)
