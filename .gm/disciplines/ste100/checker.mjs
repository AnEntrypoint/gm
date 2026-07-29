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
        rule: 'banned-synonym',
        detail: `"${hit.banned}" is not approved, use "${hit.approved}"`,
      });
    }

    if (checkPassiveVoice(line)) {
      violations.push({
        file: filePath,
        line: lineNo,
        rule: 'passive-voice',
        detail: 'sentence appears to use passive voice, prefer active voice',
      });
    }

    if (checkNounCluster(line, maxNouns)) {
      violations.push({
        file: filePath,
        line: lineNo,
        rule: 'noun-cluster',
        detail: `noun cluster longer than ${maxNouns} words`,
      });
    }

    for (const sentence of splitSentences(stripCodeSpans(line))) {
      if (checkSentenceLength(sentence, maxDescriptiveWords)) {
        violations.push({
          file: filePath,
          line: lineNo,
          rule: 'sentence-length',
          detail: `sentence exceeds ${maxDescriptiveWords} words: "${sentence.trim().slice(0, 60)}..."`,
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
