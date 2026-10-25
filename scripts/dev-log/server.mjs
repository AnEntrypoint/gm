// vendored from AnEntrypoint/gm d8f9b9ded4ee5f3a947fd3d9d3f4fce500dc713e
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const INGEST_PATH = '/__gm-log'
const SNIPPET_PATH = '/__gm-log.js'
const SNIPPET_FILE = fileURLToPath(new URL('./client.js', import.meta.url))
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const RATE_LIMIT_PER_SECOND = 100
const MAX_RECORD_BYTES = 4096
const MAX_BODY_BYTES = 256 * 1024
const ROTATE_BYTES = 2 * 1024 * 1024
const TEXT_CHARS = 1200
const URL_CHARS = 512
const LEVELS = new Set(['error', 'warning', 'info', 'debug'])
const KINDS = new Set(['console', 'exception', 'network', 'resource'])
const SNIPPET_TAG = `<script src="${SNIPPET_PATH}"></script>`

function isLoopback(req) {
  return LOOPBACK_ADDRESSES.has(req?.socket?.remoteAddress)
}

export function injectSnippet(html, req) {
  if (typeof html !== 'string' || !isLoopback(req)) return html
  return html.replace(/<\/head>/i, `${SNIPPET_TAG}</head>`)
}

function clip(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function scrubUrl(value) {
  const bare = String(value ?? '')
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
    .split(/[?#]/)[0]
  return clip(bare, URL_CHARS)
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    level: LEVELS.has(raw.level) ? raw.level : 'info',
    text: clip(raw.text, TEXT_CHARS),
    url: scrubUrl(raw.url),
    line: Number.isInteger(raw.line) ? raw.line : null,
    time: Number.isFinite(raw.time) ? raw.time : Date.now(),
    kind: KINDS.has(raw.kind) ? raw.kind : 'console',
  }
}

function fitRecord(record) {
  let fitted = record
  while (Buffer.byteLength(JSON.stringify(fitted)) + 1 > MAX_RECORD_BYTES) {
    if (fitted.text.length < 8) return null
    fitted = { ...fitted, text: `${fitted.text.slice(0, Math.floor(fitted.text.length / 2))}...` }
  }
  return fitted
}

function createRateLimiter(perSecond) {
  let windowStart = 0
  let used = 0
  return () => {
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      used = 0
    }
    if (used >= perSecond) return false
    used += 1
    return true
  }
}

function createSerialRunner() {
  let tail = Promise.resolve()
  return (task) => {
    const run = tail.then(task)
    tail = run.catch(() => {})
    return run
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function reply(res, status, headers = {}) {
  res.writeHead(status, headers)
  res.end()
}

async function appendLines(dir, logFile, rotatedFile, text) {
  await fs.promises.mkdir(dir, { recursive: true })
  const data = Buffer.from(text, 'utf8')
  const size = await fs.promises.stat(logFile).then((stat) => stat.size, () => 0)
  if (size > 0 && size + data.length > ROTATE_BYTES) {
    await fs.promises.rename(logFile, rotatedFile)
  }
  await fs.promises.appendFile(logFile, data)
}

function createIngest({ dir, logFile, rotatedFile, disabledFile, runSerial }) {
  const allow = createRateLimiter(RATE_LIMIT_PER_SECOND)
  return async function ingest(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { allow: 'POST' })
    if (fs.existsSync(disabledFile)) return reply(res, 204)
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      return reply(res, error.message === 'body too large' ? 413 : 400)
    }
    const incoming = Array.isArray(parsed) ? parsed : parsed?.records
    if (!Array.isArray(incoming)) return reply(res, 400)

    const lines = []
    let rateLimited = 0
    let rejected = 0
    for (const raw of incoming) {
      if (!allow()) {
        rateLimited += 1
        continue
      }
      const normalized = normalize(raw)
      const fitted = normalized && fitRecord(normalized)
      if (!fitted) {
        rejected += 1
        continue
      }
      lines.push(`${JSON.stringify(fitted)}\n`)
    }
    if (rateLimited || rejected) {
      lines.push(`${JSON.stringify({
        level: 'warning',
        text: `gm dev-log dropped ${rateLimited} over the ${RATE_LIMIT_PER_SECOND}/s limit and ${rejected} malformed or over ${MAX_RECORD_BYTES} bytes`,
        url: '',
        line: null,
        time: Date.now(),
        kind: 'console',
      })}\n`)
    }
    if (lines.length === 0) return reply(res, 204)
    try {
      await runSerial(() => appendLines(dir, logFile, rotatedFile, lines.join('')))
    } catch {
      return reply(res, 500)
    }
    return reply(res, 204)
  }
}

async function serveSnippet(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { allow: 'GET, HEAD' })
  try {
    const body = await fs.promises.readFile(SNIPPET_FILE)
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    reply(res, 500)
  }
}

export function devLogMiddleware(options = {}) {
  const root = options.root ?? process.cwd()
  const dir = path.join(root, '.gm', 'dev-log')
  const logFile = path.join(dir, 'log.jsonl')
  const rotatedFile = path.join(dir, 'log.1.jsonl')
  const disabledFile = path.join(dir, 'disabled')
  const runSerial = createSerialRunner()
  const ingest = createIngest({ dir, logFile, rotatedFile, disabledFile, runSerial })
  return function devLog(req, res, next) {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname !== INGEST_PATH && pathname !== SNIPPET_PATH) return next?.()
    if (!isLoopback(req)) return reply(res, 403)
    if (pathname === SNIPPET_PATH) return serveSnippet(req, res)
    return ingest(req, res)
  }
}
