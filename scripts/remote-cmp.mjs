#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import nodePath from 'node:path'

const HELP = `remote-cmp.mjs -- worktree blob vs the remote committed blob

  node remote-cmp.mjs [--repo=owner/name] [--ref=main] <path> [...]

  <path>   any path under this repo: relative, absolute, backslashed or "./"-prefixed.
  --repo   owner/name to compare against; default: parsed from \`git remote get-url origin\`.
           GM_REMOTE_SLUG in the environment does the same.
  --ref    the remote ref to read; default main. A 404 on the named ref is re-read
           against the repository's default branch before it is reported ABSENT.

  Verdicts: IDENTICAL, DIFFERS, ABSENT, DIRECTORY, ERROR (with the reason).
  Exit 1 if any path answered ERROR.`

const argv = process.argv.slice(2)
const targets = []
const opts = { repo: (process.env.GM_REMOTE_SLUG || '').trim(), ref: 'main' }
for (const arg of argv) {
  if (arg === '--help' || arg === '-h') {
    console.log(HELP)
    process.exit(0)
  }
  if (arg.startsWith('--repo=')) { opts.repo = arg.slice('--repo='.length).trim(); continue }
  if (arg.startsWith('--ref=')) { opts.ref = arg.slice('--ref='.length).trim(); continue }
  targets.push(arg)
}
if (targets.length === 0) {
  console.error(HELP)
  process.exit(2)
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT }).trim()

let ROOT
try {
  ROOT = nodePath.resolve(
    execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
  )
} catch {
  console.error('ERROR: not inside a git worktree -- run this from the project you are comparing')
  process.exit(2)
}

const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s)

function toRel(raw) {
  let s = String(raw).replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/')
  while (s.startsWith('./')) s = s.slice(2)
  if (!s) return null
  const abs = nodePath.resolve(ROOT, s).replace(/\\/g, '/')
  const rootL = fold(ROOT.replace(/\\/g, '/'))
  const absL = fold(abs)
  if (absL === rootL) return null
  if (!absL.startsWith(rootL + '/')) return null
  const rel = abs.slice(rootL.length + 1)
  return rel.length === 0 ? null : rel
}

function slugFromOrigin() {
  try {
    const url = git(['remote', 'get-url', 'origin'])
    const m = url.match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
    if (m) return `${m[1]}/${m[2]}`
  } catch {}
  return ''
}

const slug = opts.repo || slugFromOrigin()
if (!slug) {
  console.error('ERROR: no remote repository to compare against -- pass --repo=owner/name or set GM_REMOTE_SLUG')
  process.exit(2)
}

function authToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
}

let token
try {
  token = authToken()
} catch (e) {
  console.error(`ERROR: could not read a GitHub token (\`gh auth token\` failed: ${String(e.message || e).split('\n')[0]}) -- set GITHUB_TOKEN or GH_TOKEN`)
  process.exit(2)
}
const HEADERS = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'gm-remote-cmp',
}

async function remoteBlob(rel, ref) {
  const url =
    `https://api.github.com/repos/${slug}/contents/` +
    `${rel.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
  let r
  try {
    r = await fetch(url, { headers: HEADERS })
  } catch (e) {
    return { error: `network: ${String(e.message || e).split('\n')[0]}` }
  }
  if (r.status === 404) return { missing: true }
  if (!r.ok) {
    const hint =
      r.status === 401 || r.status === 403
        ? ' -- a 401/403 is auth or the rate limit, never an absent file; check `gh auth status`'
        : ''
    return { error: `remote ${r.status} ${r.statusText || ''}`.trim() + hint }
  }
  const j = await r.json()
  if (Array.isArray(j) || j.type === 'dir') return { directory: true }
  return { sha: j.sha, size: j.size }
}

async function defaultBranch() {
  try {
    const r = await fetch(`https://api.github.com/repos/${slug}`, { headers: HEADERS })
    if (!r.ok) return null
    return (await r.json()).default_branch || null
  } catch {
    return null
  }
}

let fallbackRef = null
let failures = 0

for (const raw of targets) {
  const rel = toRel(raw)
  if (!rel) {
    console.log(`${raw}: ERROR path does not resolve under the repo root ${ROOT}`)
    failures += 1
    continue
  }
  let st
  try {
    st = statSync(nodePath.resolve(ROOT, rel))
  } catch {
    console.log(`${rel}: ABSENT (no worktree copy at this path)`)
    continue
  }
  if (st.isDirectory()) {
    console.log(`${rel}: DIRECTORY (a directory has no blob; name a file)`)
    continue
  }
  let local
  try {
    local = git(['hash-object', '--path', rel, '--', rel])
  } catch (e) {
    console.log(`${rel}: ERROR git hash-object failed: ${String(e.message || e).split('\n')[0]}`)
    failures += 1
    continue
  }
  let remote = await remoteBlob(rel, opts.ref)
  let ref = opts.ref
  if (remote.missing) {
    if (fallbackRef === null) fallbackRef = (await defaultBranch()) || ''
    if (fallbackRef && fallbackRef !== opts.ref) {
      remote = await remoteBlob(rel, fallbackRef)
      if (!remote.missing && !remote.error) ref = fallbackRef
    }
  }
  if (remote.error) {
    console.log(`${rel}: ERROR ${remote.error}`)
    failures += 1
    continue
  }
  if (remote.directory) {
    console.log(`${rel}: DIRECTORY (the remote ref has a directory here)`)
    continue
  }
  if (remote.missing) {
    console.log(`${rel}\n  local  =${local}\n  ABSENT (${slug} has no blob at this path on ${ref})`)
    continue
  }
  const same = remote.sha === local
  console.log(
    `${rel}\n  local  =${local}\n  remote =${remote.sha}  size=${remote.size}  ref=${ref}\n` +
      `  ${same ? 'IDENTICAL (already published; safe to write)' : 'DIFFERS (genuinely uncommitted -> contested)'}`,
  )
}

process.exit(failures > 0 ? 1 : 0)
