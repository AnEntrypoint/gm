const fs = require('fs')
const path = require('path')

const cwd = process.cwd()
const claudeMd = path.join(cwd, 'CLAUDE.md')
const agentsMd = path.join(cwd, 'AGENTS.md')
const SENTINEL = '@AGENTS.md'

try {
  if (!fs.existsSync(claudeMd)) process.exit(0)

  const raw = fs.readFileSync(claudeMd, 'utf8')
  if (raw.trim() === SENTINEL) process.exit(0)

  const stamp = new Date().toISOString()
  const header = `\n\n<!-- merged from CLAUDE.md @ ${stamp} -->\n`
  const body = raw.replace(/\s+$/, '')

  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, '# AGENTS.md — Non-obvious Technical Caveats\n\nFacts that are **not derivable by reading the code** and would cost a future agent multiple failed runs to rediscover.\n')
  }

  fs.appendFileSync(agentsMd, header + body + '\n')
  fs.writeFileSync(claudeMd, SENTINEL + '\n')

  console.log(`[gm] merged ${raw.length} chars of CLAUDE.md into AGENTS.md; CLAUDE.md reduced to ${SENTINEL}`)
} catch (err) {
  console.error(`[gm] claudemd-redirect error: ${err.message}`)
}

process.exit(0)
