#!/usr/bin/env node
// Scans files for supply-chain-backdoor and AI-injection "tells" -- signatures
// found live in a real incident (an obfuscated C2 stager appended to
// vite.browser.config.js, delivered via a compromised automated release
// commit that also bumped a dependency and dropped .env from .gitignore).
//
// Run standalone: node scripts/scan-supply-chain-tells.mjs [path...]
// Exit code 0 = clean, 1 = findings, 2 = scan error.
//
// Designed to be invoked from any project (not just this one) -- pass the
// target repo root(s) as argv, or it scans cwd.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.cache',
  '.svelte-kit', '.nuxt', '.output', '.turbo', 'out', 'coverage', '.parcel-cache',
  // Vendored/third-party binary trees this scanner isn't meant to police --
  // a browser profile's installed extensions are third-party code the user
  // didn't write and can't fix here; a real backdoor concern in a project's
  // OWN code should never be diluted by noise from a bundled Chrome profile.
  '.plugkit-browser-profile', '.plugkit-agent-worktree', '.wwebjs_auth', '.wwebjs_cache',
])
// Code files only. JSON/YAML/MD routinely carry legitimate non-Latin natural-
// language text (Cyrillic, Greek, CJK, etc.) which is indistinguishable from a
// homoglyph attack by codepoint alone -- the Unicode-confusable check below is
// only meaningful applied to CODE, where an identifier/URL is expected to be
// plain ASCII and non-ASCII inside one is a genuine anomaly, not content.
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.ps1', '.py'])
// Broader set for the exact-string / pattern checks, which key on code shapes
// (require calls, eval, spawn) that can legitimately only appear in code or
// config, not prose -- config/build files are still worth the exact-string and
// structural-pattern passes, just not the Unicode-confusable pass.
const TEXT_EXT = new Set([...CODE_EXT, '.json', '.yml', '.yaml', '.md'])

// ---- Exact-match signatures from the confirmed incident ----------------
const EXACT_STRINGS = [
  { sig: 'A9-2057', why: 'campaign/version tag literal seen in a live C2 stager' },
  { sig: '0xa322E5f3D311D3080e6f0121063e9aDC2490Ef1a', why: 'hardcoded Ethereum address used as a blockchain-based C2 config lookup key' },
  { sig: 'eth.blockscout.com/api', why: 'block-explorer API used as a C2-resolution fallback' },
  { sig: 'x-payload-b64', why: 'custom HTTP header used to smuggle a staged payload' },
]

// ---- Structural / behavioral patterns (regex) ---------------------------
const PATTERNS = [
  {
    name: 'blockchain-derived-c2-lookup',
    re: /eth_getBlockByNumber|eth_getTransactionCount|eth_blockNumber/,
    why: 'blockchain RPC calls used to derive a C2 address/config are a known dead-drop technique — legitimate web3 code should be an isolated, obviously-named module, not appended to an unrelated build config',
  },
  {
    name: 'ip-from-bytes-decode',
    re: /\[0\]\s*\+\s*['"]\.['"]\s*\+\s*\w+\[1\]\s*\+\s*['"]\.['"]\s*\+\s*\w+\[2\]/,
    why: 'byte-array-to-dotted-IP decode shape, commonly used to hide a C2 address inside binary data (a tx field, an image, etc.)',
  },
  {
    name: 'detached-hidden-spawn',
    re: /spawn\s*\(\s*['"]node['"][\s\S]{0,120}detached\s*:\s*true[\s\S]{0,120}stdio\s*:\s*['"]ignore['"]/,
    why: 'detached + stdio:ignore + unref() child process launch — runs code that outlives and is invisible to the parent process',
  },
  {
    name: 'detached-hidden-spawn-loose',
    re: /detached\s*:\s*true[\s\S]{0,60}(stdio\s*:\s*['"]ignore['"]|windowsHide\s*:\s*true)/,
    why: 'detached background process with hidden stdio/window — legitimate daemonization exists but is rare in application/build code and should be named and commented',
  },
  {
    name: 'eval-of-network-response',
    re: /eval\s*\(\s*[\w.]*\+?\s*(await\s+)?\w*(fetch|http|https|response|body|payload|res)\w*/i,
    why: 'eval() fed directly by network response content — remote code execution primitive',
  },
  {
    name: 'xor-decode-helper',
    re: /charCodeAt\(\w+\s*%\s*\w+\.length\)/,
    why: 'per-byte XOR-against-key loop, the standard shape for decoding an obfuscated payload at runtime',
  },
  {
    name: 'global-require-module-stash',
    re: /global\.\w+\s*=\s*require\s*;\s*typeof\s+module\s*===\s*['"]object['"]/,
    why: 'stashing require/module onto global — used so eval()-ed code can access them outside its lexical scope',
  },
  {
    name: 'minified-tail-after-normal-code',
    re: /\n[a-z]\.[a-z]\([a-z],[a-z],[a-z]\)/,
    why: 'single-letter-identifier minified code appearing after normally-formatted source — mixing styles in one file is a strong injection tell',
    weak: true,
  },
  {
    name: 'promise-any-rpc-race',
    re: /Promise\.any\(\s*\[?\s*['"]https?:\/\/[^,\]]+,\s*['"]https?:\/\//,
    why: 'racing multiple public RPC/API endpoints for resilience — common in C2 code designed to survive one endpoint being blocked',
  },
]

// ---- Unicode confusables / invisible-character tells ---------------------
// Each entry: a *visible-as-ASCII-but-isn't* or fully invisible codepoint.
const SUSPICIOUS_UNICODE = [
  { cp: 0x200b, name: 'ZERO WIDTH SPACE' },
  { cp: 0x200c, name: 'ZERO WIDTH NON-JOINER' },
  { cp: 0x200d, name: 'ZERO WIDTH JOINER' },
  { cp: 0x200e, name: 'LEFT-TO-RIGHT MARK' },
  { cp: 0x200f, name: 'RIGHT-TO-LEFT MARK' },
  { cp: 0x202a, name: 'LEFT-TO-RIGHT EMBEDDING' },
  { cp: 0x202b, name: 'RIGHT-TO-LEFT EMBEDDING' },
  { cp: 0x202c, name: 'POP DIRECTIONAL FORMATTING' },
  { cp: 0x202d, name: 'LEFT-TO-RIGHT OVERRIDE' },
  { cp: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE (Trojan Source bidi attack)' },
  { cp: 0x2060, name: 'WORD JOINER' },
  { cp: 0x2066, name: 'LEFT-TO-RIGHT ISOLATE' },
  { cp: 0x2067, name: 'RIGHT-TO-LEFT ISOLATE' },
  { cp: 0x2068, name: 'FIRST STRONG ISOLATE' },
  { cp: 0x2069, name: 'POP DIRECTIONAL ISOLATE' },
  { cp: 0xfeff, name: 'ZERO WIDTH NO-BREAK SPACE / BOM (mid-file)' },
  { cp: 0x00ad, name: 'SOFT HYPHEN' },
  // Common homoglyphs used to disguise identifiers/URLs (Cyrillic look-alikes)
  { cp: 0x0410, name: 'CYRILLIC CAPITAL А (looks like Latin A)' },
  { cp: 0x0430, name: 'CYRILLIC SMALL а (looks like Latin a)' },
  { cp: 0x0415, name: 'CYRILLIC CAPITAL Е (looks like Latin E)' },
  { cp: 0x0435, name: 'CYRILLIC SMALL е (looks like Latin e)' },
  { cp: 0x041e, name: 'CYRILLIC CAPITAL О (looks like Latin O)' },
  { cp: 0x043e, name: 'CYRILLIC SMALL о (looks like Latin o)' },
  { cp: 0x0420, name: 'CYRILLIC CAPITAL Р (looks like Latin P)' },
  { cp: 0x0440, name: 'CYRILLIC SMALL р (looks like Latin p)' },
  { cp: 0x0421, name: 'CYRILLIC CAPITAL С (looks like Latin C)' },
  { cp: 0x0441, name: 'CYRILLIC SMALL с (looks like Latin c)' },
]
const SUSPICIOUS_UNICODE_MAP = new Map(SUSPICIOUS_UNICODE.map(u => [u.cp, u.name]))

// ---- Statistical AI-prose-tell detection ---------------------------------
// A separate signal class from the backdoor/injection checks above: this one
// flags LLM-authored prose by its rhetorical fingerprint (uniform sentence
// rhythm, stock rhetorical constructs, overused vocabulary), not by
// malicious-code shape. Applies only to prose-bearing files (.md), never to
// code, where the same words are routine and not evidence of anything.
const SENTENCE_SPLIT_RE = /[.?!]+/
const DESOURO_RE = /it['’]s not\s+(?:just\s+)?([^,]+),\s*it['’]s/i
const TRIPLET_RE = /\b\w+\b,\s+\b\w+\b,\s+and\s+\b\w+\b/i
const VALIDATION_MARKER_RE = /\b(that matters|honestly|actually)\b/i
const FLUFF_WORDS = [
  'accelerate', 'accentuate', 'adaptive', 'agile', 'ai-powered', 'align', 'always-on', 'amid', 'automate',
  'beacon', 'blueprint', 'boast', 'breakthrough', 'buckets', 'bustling',
  'cloud-native', 'commendable', 'crucible', 'crucial', 'customizable', 'cutting-edge',
  'data-driven', 'delve', 'democratize', 'demystify', 'disruptive', 'dynamic',
  'effortless', 'elevate', 'embark', 'empower', 'emphasize', 'enhance', 'ever-evolving', 'efficient',
  'findings', 'foster', 'frictionless', 'future-proof',
  'game-changer', 'garner', 'groundbreaking',
  'harness', 'highlight', 'holistic', 'hyper-personalized',
  'immersive', 'imperative', 'innovative', 'insightful', 'integrated', 'intelligent', 'intricate', 'intuitive',
  'landscape', 'leading-edge', 'leverage',
  'machine-first', 'meticulous', 'meticulously', 'mission-critical', 'multifaceted', 'myriad',
  'navigating', 'next-gen', 'next-generation', 'nuanced',
  'open-ended', 'optimize',
  'paradigm', 'paradigm-shifting', 'personalized', 'pioneering', 'pivotal', 'plethora', 'plug-and-play', 'potential', 'predictive', 'proactive', 'proprietary',
  'quietly',
  'realm', 'redefine', 'reimagine', 'reliable', 'results-driven', 'revolutionize', 'robust',
  'scalable', 'seamless', 'showcase', 'showcasing', 'smart', 'state-of-the-art', 'streamline', 'surpass', 'synergize', 'synergy',
  'tapestry', 'testament', 'toolkit', 'trailblazing', 'transformative', 'transparent', 'turnkey',
  'underscore', 'unleash', 'unlock', 'unparalleled', 'unprecedented',
  'versatile', 'vibrant', 'visionary',
  // Extended beyond the reference list: stock transition/hedge phrases and
  // additional overused adjectives seen across LLM-authored marketing/doc copy.
  'moreover', 'furthermore', 'in conclusion', 'in summary', 'on the other hand',
  'it is worth noting', 'it is important to note', 'needless to say',
  'ecosystem', 'tailored', 'cohesive', 'robust framework', 'comprehensive',
  'seamlessly integrate', 'unlock the potential', 'take it to the next level',
  'in today’s fast-paced', 'stay ahead of the curve', 'best-in-class',
]
const FLUFF_VOCAB_RE = new RegExp('\\b(' + FLUFF_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi')

function analyzeProseTells(text) {
  const sentences = text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean)
  const sentenceCount = sentences.length
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length)
  const wordCount = lengths.reduce((a, b) => a + b, 0)

  let burstiness = 0
  if (sentenceCount > 1) {
    const mean = wordCount / sentenceCount
    const variance = lengths.reduce((acc, l) => acc + (mean - l) ** 2, 0) / sentenceCount
    burstiness = Math.sqrt(variance)
  }

  const desouroConstructs = (text.match(new RegExp(DESOURO_RE, 'gi')) || []).length
  const tripletStructures = (text.match(new RegExp(TRIPLET_RE, 'gi')) || []).length
  const rhetoricalFluff = (text.match(FLUFF_VOCAB_RE) || []).length
  const explicitValidation = (text.match(new RegExp(VALIDATION_MARKER_RE, 'gi')) || []).length

  let score = 0
  if (burstiness < 6.0 && sentenceCount > 3) score += 0.35
  else if (burstiness > 10.0) score -= 0.20
  score += desouroConstructs * 0.15
  score += tripletStructures * 0.10
  score += rhetoricalFluff * 0.03
  score += explicitValidation * 0.05
  const aiProbabilityScore = Math.min(1, Math.max(0, score))

  return { wordCount, sentenceCount, burstiness, desouroConstructs, tripletStructures, rhetoricalFluff, explicitValidation, aiProbabilityScore }
}

const PROSE_TELL_EXT = new Set(['.md'])
const PROSE_TELL_MIN_SENTENCES = 8
const PROSE_TELL_SCORE_THRESHOLD = 0.5
// Single regex alternation, scanned natively by the engine in one pass --
// the previous per-character for-loop with an inner .find() was O(n) work
// PER CHARACTER (n = codepoint list length) and made a multi-MB minified
// bundle file (a real case: a 3.3MB single-line webpack chunk) take minutes
// instead of milliseconds.
const SUSPICIOUS_UNICODE_RE = new RegExp('[' + SUSPICIOUS_UNICODE.map(u => '\\u' + u.cp.toString(16).padStart(4, '0')).join('') + ']', 'g')

// A file whose non-ASCII payload is almost entirely \uXXXX-style JS escape
// sequences decoding to plain ASCII is itself a tell (deliberate obfuscation
// to defeat plain-string grep, seen in the confirmed incident's http/https/
// url/child_process require() calls).
const ESCAPED_ASCII_RUN = /(\\u00[2-7][0-9a-fA-F]){6,}/

function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    // Hash/timestamp-suffixed variants of the same vendored-profile dirs
    // (e.g. .plugkit-browser-profile-<id>) -- prefix match on the same names.
    if (e.name.startsWith('.plugkit-browser-profile') || e.name.startsWith('.plugkit-browser-chrome-profile') || e.name.startsWith('.plugkit-agent-worktree')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(p, out)
    } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name))) {
      out.push(p)
    }
  }
}

function scanFile(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const findings = []

  for (const { sig, why } of EXACT_STRINGS) {
    if (text.includes(sig)) {
      findings.push({ filePath, kind: 'exact-string', sig, why })
    }
  }

  for (const { name, re, why, weak } of PATTERNS) {
    const m = text.match(re)
    if (m) {
      const line = text.slice(0, m.index).split('\n').length
      findings.push({ filePath, kind: weak ? 'pattern-weak' : 'pattern', name, why, line })
    }
  }

  const lines = text.split('\n')
  const nonBlank = lines.filter(l => l.trim().length > 0)
  if (nonBlank.length >= 5) {
    const lens = nonBlank.map(l => l.length)
    const avgLen = lens.reduce((a, b) => a + b, 0) / lens.length
    const lastLen = lens[lens.length - 1]
    const looksMinified = /[;,]\s*[a-zA-Z_$][\w$]*\s*=/.test(nonBlank[nonBlank.length - 1]) &&
      /\b(function|=>|require\(|const |let |var )\b/.test(nonBlank[nonBlank.length - 1])
    if (lastLen > 2000 && lastLen > avgLen * 20 && looksMinified) {
      findings.push({
        filePath,
        kind: 'pattern',
        name: 'dense-minified-tail-line',
        line: nonBlank.length,
        why: `final non-blank line is ${lastLen} chars (${Math.round(lastLen / avgLen)}x the file's average line length) and looks like minified code — this is the exact shape of a payload appended to the end of an otherwise normal, readable file`,
      })
    }
  }

  if (ESCAPED_ASCII_RUN.test(text)) {
    findings.push({
      filePath,
      kind: 'pattern',
      name: 'escaped-ascii-obfuscation',
      why: '6+ consecutive \\uXXXX escapes decoding to plain ASCII — deliberate string obfuscation to defeat plaintext grep (e.g. \\u0068\\u0074\\u0074\\u0070 = "http")',
    })
  }

  if (CODE_EXT.has(path.extname(filePath))) {
    const matches = text.match(SUSPICIOUS_UNICODE_RE)
    if (matches && matches.length) {
      // Line numbers computed via one pass over newline offsets (not a fresh
      // split() per hit) -- still correct even on a huge single-line file,
      // just no longer quadratic.
      let newlineOffsets = null
      const lineOf = (idx) => {
        if (!newlineOffsets) {
          newlineOffsets = []
          for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) newlineOffsets.push(i)
        }
        let lo = 0, hi = newlineOffsets.length
        while (lo < hi) { const mid = (lo + hi) >> 1; if (newlineOffsets[mid] < idx) lo = mid + 1; else hi = mid }
        return lo + 1
      }
      const seen = new Set()
      SUSPICIOUS_UNICODE_RE.lastIndex = 0
      let m
      while ((m = SUSPICIOUS_UNICODE_RE.exec(text)) !== null) {
        const cp = m[0].codePointAt(0)
        const line = lineOf(m.index)
        const key = cp + ':' + line
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({
          filePath,
          kind: 'unicode',
          name: SUSPICIOUS_UNICODE_MAP.get(cp),
          codepoint: '0x' + cp.toString(16),
          line,
          why: 'invisible or confusable Unicode codepoint inside a code file — used to hide code from visual review or disguise an identifier/URL as something else',
        })
        if (SUSPICIOUS_UNICODE_RE.lastIndex === m.index) SUSPICIOUS_UNICODE_RE.lastIndex++
      }
    }
  }

  if (PROSE_TELL_EXT.has(path.extname(filePath))) {
    const report = analyzeProseTells(text)
    if (report.sentenceCount >= PROSE_TELL_MIN_SENTENCES && report.aiProbabilityScore >= PROSE_TELL_SCORE_THRESHOLD) {
      findings.push({
        filePath,
        kind: 'prose-tell',
        name: 'statistical-ai-prose-signature',
        why: `ai_probability_score=${report.aiProbabilityScore.toFixed(2)} over ${report.sentenceCount} sentences (burstiness=${report.burstiness.toFixed(1)}, desouro=${report.desouroConstructs}, triplets=${report.tripletStructures}, fluff=${report.rhetoricalFluff}, validation=${report.explicitValidation}) — statistical rhetorical fingerprint of LLM-authored prose (uniform sentence rhythm and/or stock rhetorical constructs and overused vocabulary); a heuristic signal, not proof, for docs that should read as human-reviewed and specific`,
      })
    }
  }

  return findings
}

function main() {
  const targets = process.argv.slice(2)
  const roots = targets.length ? targets : [process.cwd()]
  const files = []
  for (const root of roots) {
    const stat = fs.existsSync(root) ? fs.statSync(root) : null
    if (!stat) continue
    if (stat.isDirectory()) walk(root, files)
    else files.push(root)
  }

  // Stream findings as each file is scanned (never buffer until the end) so a
  // kill/timeout mid-run still leaves a partial, readable, useful result on
  // disk instead of losing everything. Progress heartbeat every 200 files so
  // a long run's liveness is visible without waiting for a finding.
  let totalFindings = 0
  const filesWithFindings = new Set()
  for (let idx = 0; idx < files.length; idx++) {
    const f = files[idx]
    const findings = scanFile(f)
    for (const finding of findings) {
      totalFindings++
      filesWithFindings.add(finding.filePath)
      const loc = finding.line ? `:${finding.line}` : ''
      const label = finding.sig || finding.name
      console.log(`[${finding.kind}] ${finding.filePath}${loc} — ${label}`)
      console.log(`    ${finding.why}`)
    }
    if ((idx + 1) % 200 === 0) {
      console.error(`... scanned ${idx + 1}/${files.length} files, ${totalFindings} finding(s) so far`)
    }
  }

  console.log(`\nscan-supply-chain-tells: ${totalFindings} finding(s) across ${filesWithFindings.size} file(s) (${files.length} files scanned total)`)
  process.exit(totalFindings ? 1 : 0)
}

main()
