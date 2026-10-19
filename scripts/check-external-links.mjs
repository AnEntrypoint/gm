#!/usr/bin/env node
// Checks every external http(s) link in README.md, docs/, site/ and skills/.
// Usage: node scripts/check-external-links.mjs [--concurrency=8] [--timeout-ms=15000]
// Prints one line per failing link as `file:line  status  url` and exits 1 when any fails.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['docs', 'site', 'skills'];
const SCAN_FILES = ['README.md'];
const EXTENSIONS = /\.(md|html)$/;
const URL_RE = /https?:\/\/[^\s<>"'`\]\)]+/g;
const SKIP_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org|net))$/;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const DEAD_HOST_AFTER = 3;

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const CONCURRENCY = arg('concurrency', 8);
const TIMEOUT_MS = arg('timeout-ms', 15000);

function walk(dir, out) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) { if (name.name !== 'node_modules') walk(path, out); }
    else if (EXTENSIONS.test(name.name)) out.push(path);
  }
  return out;
}

function collectLinks() {
  const files = [
    ...SCAN_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
    ...SCAN_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => walk(join(ROOT, d), [])),
  ];
  const sites = new Map();
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      for (const raw of text.match(URL_RE) ?? []) {
        const url = raw.replace(/[.,;:!?]+$/, '');
        let host;
        try { host = new URL(url).hostname; } catch { continue; }
        if (SKIP_HOST.test(host)) continue;
        const where = `${relative(ROOT, file)}:${i + 1}`;
        if (!sites.has(url)) sites.set(url, []);
        sites.get(url).push(where);
      }
    });
  }
  return sites;
}

async function probe(url, method) {
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: { 'user-agent': 'gm-link-check/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel();
  return res.status;
}

const transportFails = new Map();

async function check(url) {
  const host = new URL(url).hostname;
  let last = 'error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if ((transportFails.get(host) ?? 0) >= DEAD_HOST_AFTER) return { ok: false, status: 'host-unreachable' };
    try {
      let status = await probe(url, 'HEAD');
      if (status >= 400) status = await probe(url, 'GET');
      transportFails.set(host, 0);
      if (status < 400) return { ok: true, status };
      last = status;
      if (!RETRY_STATUS.has(status)) return { ok: false, status };
    } catch (err) {
      last = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.message);
      transportFails.set(host, (transportFails.get(host) ?? 0) + 1);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return { ok: false, status: last };
}

const sites = collectLinks();
const urls = [...sites.keys()];
const failures = [];
let next = 0;

async function worker() {
  while (next < urls.length) {
    const url = urls[next++];
    const result = await check(url);
    if (!result.ok) failures.push({ url, status: result.status, where: sites.get(url) });
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

for (const f of failures.sort((a, b) => a.url.localeCompare(b.url))) {
  for (const where of f.where) console.log(`${where}  ${f.status}  ${f.url}`);
}
console.log(`checked ${urls.length} external links, ${failures.length} failing`);
process.exit(failures.length === 0 ? 0 : 1);
