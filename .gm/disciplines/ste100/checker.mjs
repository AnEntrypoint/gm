import { readFileSync } from 'node:fs';

function loadDictionary(dictPath) {
  return JSON.parse(readFileSync(dictPath, 'utf-8'));
}

function checkPassiveVoice(line) {
  return /\b(is|are|was|were|be|been|being)\s+\w+ed\b/i.test(line);
}

function checkSentenceLength(sentence, maxWords) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords;
}

const CONDITIONAL_STARTERS = /^(if|when|before|after)\b/i;
const IMPERATIVE_VERBS = new Set([
  'add', 'apply', 'check', 'choose', 'click', 'close', 'commit', 'connect', 'create',
  'delete', 'disconnect', 'do', 'edit', 'enter', 'fill', 'find', 'fix', 'install', 'load',
  'move', 'open', 'press', 'push', 'put', 'read', 'remove', 'run', 'save', 'select', 'set',
  'stage', 'start', 'stop', 'turn', 'use', 'verify', 'wait', 'write',
]);

function classifySentence(sentence) {
  const trimmed = sentence.trim();
  if (CONDITIONAL_STARTERS.test(trimmed)) return 'procedural';
  const firstWord = (trimmed.match(/^[A-Za-z']+/) || [''])[0].toLowerCase();
  if (IMPERATIVE_VERBS.has(firstWord)) return 'procedural';
  return 'descriptive';
}

const CLUSTER_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are', 'was',
  'were', 'be', 'this', 'that', 'each', 'per', 'its', 'own', 'not', 'no', 'do', 'use',
]);

function checkNounCluster(line, maxNouns) {
  const tokens = line.match(/[A-Za-z][A-Za-z-]*/g) || [];
  let run = 0;
  for (const tok of tokens) {
    if (CLUSTER_STOPWORDS.has(tok.toLowerCase())) {
      run = 0;
      continue;
    }
    run += 1;
    if (run > maxNouns) return true;
  }
  return false;
}

function stripCodeSpans(line) {
  return line.replace(/`[^`]*`/g, ' ');
}

function findBannedSynonyms(line, bannedSynonyms) {
  const hits = [];
  const prose = stripCodeSpans(line);
  for (const [banned, approved] of Object.entries(bannedSynonyms)) {
    const escaped = banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'g');
    const matches = prose.match(pattern) || [];
    for (const m of matches) {
      if (m === m.toUpperCase() && m.length > 1) continue;
      hits.push({ banned, approved });
    }
  }
  return hits;
}

function splitSentences(line) {
  return line.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

export function checkFile(filePath, dictPath, opts = {}) {
  const dict = loadDictionary(dictPath);
  const maxProceduralWords = opts.maxProceduralWords ?? 20;
  const maxDescriptiveWords = opts.maxDescriptiveWords ?? 25;
  const maxNouns = opts.maxNouns ?? 3;
  const text = readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (!line.trim()) return;

    for (const hit of findBannedSynonyms(line, dict.banned_synonyms)) {
      violations.push({
        file: filePath,
        line: lineNo,
        column: line.indexOf(hit.banned) + 1,
        rule: 'banned-synonym',
        severity: 'error',
        detail: `"${hit.banned}" is not approved, use "${hit.approved}"`,
      });
    }

    if (checkPassiveVoice(line)) {
      violations.push({
        file: filePath,
        line: lineNo,
        column: 1,
        rule: 'passive-voice',
        severity: 'warning',
        detail: 'sentence appears to use passive voice, prefer active voice',
      });
    }

    if (checkNounCluster(line, maxNouns)) {
      violations.push({
        file: filePath,
        line: lineNo,
        column: 1,
        rule: 'noun-cluster',
        severity: 'warning',
        detail: `noun cluster longer than ${maxNouns} words`,
      });
    }

    let searchFrom = 0;
    for (const sentence of splitSentences(stripCodeSpans(line))) {
      const column = line.indexOf(sentence.trim(), searchFrom) + 1;
      searchFrom = column;
      const kind = classifySentence(sentence);
      const maxWords = kind === 'procedural' ? maxProceduralWords : maxDescriptiveWords;
      if (checkSentenceLength(sentence, maxWords)) {
        violations.push({
          file: filePath,
          line: lineNo,
          column: column > 0 ? column : 1,
          rule: 'sentence-length',
          severity: kind === 'procedural' ? 'warning' : 'error',
          detail: `${kind} sentence exceeds ${maxWords} words: "${sentence.trim().slice(0, 60)}..."`,
        });
      }
    }
  });

  return violations;
}

export function checkFiles(filePaths, dictPath, opts = {}) {
  const results = [];
  for (const filePath of filePaths) {
    results.push(...checkFile(filePath, dictPath, opts));
  }
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('checker.mjs')) {
  const [, , dictPath, ...files] = process.argv;
  const violations = checkFiles(files, dictPath);
  console.log(JSON.stringify({ violation_count: violations.length, violations }, null, 2));
  process.exitCode = violations.length > 0 ? 1 : 0;
}
