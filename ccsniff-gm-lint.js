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
    // High-signal triggers only — phrases that strongly imply a resolved unknown
    // worth persisting. Generic words like "error" or "found" are too noisy.
    const trigger = /\broot cause\b|\bturned out\b|\bturns out\b|\bfix(?:ed)? was\b|\bculprit\b|\bfound it\b|\bgotcha\b|\bthe issue is\b|\bthe bug is\b|\bnon-obvious\b/i;
    if (!trigger.test(text)) return false;
    // Recognize memorize regardless of surface form — Agent call, exec:memorize verb,
    // plugkit memorize subcommand, or 'Memorized fact' / AGENTS.md acknowledgement.
    if (/Agent.*memorize|CONTEXT TO MEMORIZE|exec:memorize|plugkit memorize|memorized fact|appended.*AGENTS\.md|appended.*caveat/i.test(text)) return false;
    // Allow short ack messages — only flag substantive responses where memorize would apply.
    if (text.length < 400) return false;
    return true;
  },

  'bash-direct-violation': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    // Real misuse looks like an actual tool invocation: Bash(node script.js),
    // Bash(npm install foo), Bash(bun -e ...). Prose references look like
    // Bash(node/npm/npx), Bash(node ...), Bash(bun ...) — slash-lists or
    // ellipsis. Require a real-looking arg after the verb to count as misuse.
    const re = /Bash\(\s*(node|npm|npx|bun)\s+([^./)\s][^)\n]{2,})/;
    const m = text.match(re);
    if (!m) return false;
    // Exclude prose patterns: ellipsis arg, slash-separated verb list, quoted form.
    const arg = m[2];
    if (/^\.\.\./.test(arg)) return false;
    if (/^\/(?:node|npm|npx|bun)\b/.test(arg)) return false;
    return true;
  },

  'narrative-before-execution': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    if (!/^(i|let|now|we|the) [a-z]+ (check|find|look|read)/i.test(text.split('\n')[0])) return false;
    const head = text.substring(0, 200);
    if (/exec:|Read\(|git /.test(head)) return false;
    return true;
  },

  'asking-user-mid-chain': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    if (text.length < 80) return false;
    // Question-mark line that maps to permission-seeking patterns. Per paper IV §3.2:
    // any question whose answer is reachable from the agent's tools belongs to the agent.
    const askRe = /(should i (continue|proceed|do|also|now)|want me to (also|then|next|continue|do)|two options[:,]|which (one|approach|would)|let me know if|if you('?d| would) (like|prefer))/i;
    if (!askRe.test(text)) return false;
    // Allow questions that are part of describing a witnessed result (not soliciting authorization).
    const trailing = text.slice(-300).toLowerCase();
    if (/exec:browser|exec:codesearch|read\(|edit\(|write\(/.test(trailing)) return false;
    return true;
  },

  'distributed-refusal': (msg) => {
    if (msg.role !== 'assistant') return false;
    const text = msg.text || '';
    if (text.length < 200) return false;
    // Per paper IV §2.4: shipping a single bounded subset while abandoning other
    // witnessable subsets as "follow-up" is refusal in disguise. Heuristic: closing
    // statement uses follow-up framing AND no "covering family" / "complement" /
    // "residual" framing AND no enumeration of multiple witnessable subsets.
    const tail = text.slice(-600).toLowerCase();
    const followUp = /\b(follow[- ]up|next session|out of scope|exempt for now|address (this )?(later|next)|defer(red)? to|leave (this|that) for|skip(ping)? for now)\b/.test(tail);
    if (!followUp) return false;
    const acknowledgesCover = /(covering family|complement|residual|witnessable closure|other witnessable subsets|cover is maximal|maximal cover)/i.test(text);
    if (acknowledgesCover) return false;
    return true;
  }
};

const rl = readline.createInterface({ input: process.stdin });
const findings = {
  total: 0,
  assistant: 0,
  compliant_asst: 0,
  violations: {},
  per_rule_hits: {}
};

Object.keys(rules).forEach(k => {
  findings.violations[k] = [];
  findings.per_rule_hits[k] = 0;
});

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    findings.total++;
    if (msg.role !== 'assistant') return;
    findings.assistant++;

    let violated = false;
    Object.entries(rules).forEach(([name, check]) => {
      if (check(msg)) {
        findings.violations[name].push(msg.sid || 'unknown');
        findings.per_rule_hits[name]++;
        violated = true;
      }
    });
    if (!violated) findings.compliant_asst++;
  } catch (e) {
    // skip parse errors
  }
});

rl.on('close', () => {
  // Compliance is per-assistant-message: percent of assistant messages with no violations.
  // Per-rule compliance is the inverse rate of that rule firing across assistant messages.
  const compliance = findings.assistant > 0 ? (100 * findings.compliant_asst / findings.assistant) : 0;
  const per_rule = {};
  for (const [name, hits] of Object.entries(findings.per_rule_hits)) {
    const sessions = [...new Set(findings.violations[name])].length;
    per_rule[name] = {
      hits,
      sessions,
      compliance_percent: findings.assistant > 0
        ? Number(((findings.assistant - hits) / findings.assistant * 100).toFixed(2))
        : 0
    };
  }
  console.log(JSON.stringify({
    summary: {
      total_messages: findings.total,
      assistant_messages: findings.assistant,
      compliant_assistant: findings.compliant_asst,
      compliance_percent: Number(compliance.toFixed(2))
    },
    per_rule,
    violations: findings.violations,
    interpretation: compliance >= 99
      ? 'EXCELLENT compliance with gm skillset'
      : compliance >= 95
      ? 'GOOD compliance; minor gaps flagged above'
      : compliance >= 80
      ? 'OK; review per-rule misses'
      : 'NEEDS IMPROVEMENT; review violations'
  }, null, 2));
});
