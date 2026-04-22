const fs = require('fs')
const path = require('path')

const cwd = process.cwd()
const claudeMd = path.join(cwd, 'CLAUDE.md')
const agentsMd = path.join(cwd, 'AGENTS.md')

if (!fs.existsSync(claudeMd)) process.exit(0)

const content = fs.readFileSync(claudeMd, 'utf8')
const hasRef = /(^|\s)@AGENTS\.md(\s|$)/m.test(content)

if (hasRef) process.exit(0)

if (!fs.existsSync(agentsMd)) {
  fs.writeFileSync(agentsMd, '# AGENTS.md — Non-obvious Technical Caveats\n\nFacts that are **not derivable by reading the code** and would cost a future agent multiple failed runs to rediscover. Obvious patterns belong in CLAUDE.md or the code.\n')
}

const patched = '# Technical Caveats\n\n@AGENTS.md\n\n' + content.replace(/^# [^\n]*\n+/, '')
fs.writeFileSync(claudeMd, patched)

console.log('[gm] patched CLAUDE.md to reference @AGENTS.md')
process.exit(0)
