#!/usr/bin/env node
// ccsniff-gm-lint.js — Optional linting for gm skillset compliance
// Usage: ccsniff --since 24h --json 2>&1 | node ccsniff-gm-lint.js

const readline = require('readline');

const rules = {
  'missing-skill-invocation': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    // Detects: deliberates about phase transition without invoking Skill() and not narrative start
    if (!/(?:should|need|must|entering|in) (planning|EXECUTE|EMIT|VERIFY|COMPLETE)/.test(text)) return false;
    if (/Skill\(/.test(text)) return false;
    if (/^(i'll|let me|now|here)/.test(text.split('\n')[0])) return false;
    return true;
  },

  'missing-memorize-on-unknown': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    // Detects: found/fixed/error but no memorize invocation
    if (!/found|fixed|discovered|error|os error|bug/.test(text)) return false;
    if (/Agent.*memorize|CONTEXT TO MEMORIZE/.test(text)) return false;
    if (text.length < 500) return false;
    return true;
  },

  'bash-direct-violation': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    // Detects: Bash(node/npm/npx) calls
    return /Bash\(.*(?:node|npm|npx)/.test(text);
  },

  'narrative-before-execution': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    // Detects: narrative first line without immediate execution
    if (!/^(i|let|now|we|the) [a-z]+ (check|find|look|read)/i.test(text.split('\n')[0])) return false;
    const head = text.substring(0, 200);
    if (/exec:|Read\(|git /.test(head)) return false;
    return true;
  }
};

const rl = readline.createInterface({ input: process.stdin });
const findings = {
  total: 0,
  compliant: 0,
  violations: {}
};

Object.keys(rules).forEach(k => { findings.violations[k] = []; });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    findings.total++;

    let found = false;
    Object.entries(rules).forEach(([name, check]) => {
      if (check(msg)) {
        findings.violations[name].push(msg.sid || 'unknown');
        found = true;
      }
    });

    if (!found && msg.role === 'assistant') {
      findings.compliant++;
    }
  } catch (e) {
    // skip parse errors
  }
});

rl.on('close', () => {
  const compliance = findings.total > 0 ? Math.round(100 * findings.compliant / findings.total) : 0;
  console.log(JSON.stringify({
    summary: {
      total_messages: findings.total,
      compliant_messages: findings.compliant,
      compliance_percent: compliance
    },
    violations: findings.violations,
    interpretation: compliance >= 95
      ? 'EXCELLENT compliance with gm skillset'
      : compliance >= 80
      ? 'GOOD compliance; minor gaps flagged above'
      : 'NEEDS IMPROVEMENT; review violations'
  }, null, 2));
});
