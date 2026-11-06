import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asciiText } from './sources.mjs';

const PAGE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOURCE = /^[0-9a-f]{12}$/;
const KINDS = ['ingest', 'answer', 'lint'];

const isAscii = (text) => /^[\x00-\x7f]*$/.test(text);
const oneLine = (text) => typeof text === 'string' && text.trim() !== '' && !/[\r\n]/.test(text) && isAscii(text);
const today = () => new Date().toISOString().slice(0, 10);

export function sourceText(root, id) {
  const file = join(root, 'sources', `${id}.txt`);
  return SOURCE.test(id) && existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function wikiWrite({ root, log, page, title, body, summary, sources, claims = [], kind = 'ingest', contradicts = [], resolves = [] }) {
  const refuse = (error) => ({ ok: false, error: `refused: ${error}` });
  if (typeof page !== 'string' || !PAGE.test(page)) return refuse('page must be lowercase letters, digits and hyphens, at most 64 characters');
  const pageTitle = title ?? page;
  if (!oneLine(pageTitle)) return refuse('title must be one line of ASCII');
  if (typeof body !== 'string' || !isAscii(body)) return refuse('body must be ASCII text; write non-ASCII as \\uXXXX');
  if (!oneLine(summary)) return refuse('summary must be one line of ASCII');
  if (!KINDS.includes(kind)) return refuse(`kind must be one of ${KINDS.join(', ')}`);
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every((id) => typeof id === 'string' && SOURCE.test(id))) {
    return refuse('sources must be a non-empty list of source ids');
  }
  for (const id of sources) if (sourceText(root, id) === null) return refuse(`source ${id} is not in sources/`);
  if (!Array.isArray(claims)) return refuse('claims must be a list of {quote, source}');
  for (const [i, claim] of claims.entries()) {
    if (!claim || typeof claim.quote !== 'string' || claim.quote === '' || !sources.includes(claim.source)) {
      return refuse(`claim ${i + 1} needs a quote and a source that is listed in sources`);
    }
    if (!sourceText(root, claim.source).includes(asciiText(claim.quote))) return refuse(`claim ${i + 1}: the quote is not in source ${claim.source}`);
  }
  for (const list of [contradicts, resolves]) {
    if (!Array.isArray(list) || !list.every((name) => typeof name === 'string' && PAGE.test(name))) return refuse('contradicts and resolves must be lists of page names');
  }

  const dir = join(root, 'wiki');
  mkdirSync(dir, { recursive: true });
  const front = [
    '---',
    `title: ${JSON.stringify(pageTitle)}`,
    `updated: ${JSON.stringify(new Date().toISOString())}`,
    `sources: ${JSON.stringify(sources)}`,
    `claims: ${JSON.stringify(claims.map(({ quote, source }) => ({ quote: asciiText(quote), source })))}`,
    `contradicts: ${JSON.stringify(contradicts)}`,
    `resolves: ${JSON.stringify(resolves)}`,
    '---',
  ].join('\n');
  writeFileSync(join(dir, `${page}.md`), `${front}\n${body.endsWith('\n') ? body : `${body}\n`}`);

  const indexPath = join(dir, 'index.md');
  const rows = (existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '# Index\n\n').split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  const entry = `- [[${page}]] - ${summary}`;
  const at = rows.findIndex((row) => row.startsWith(`- [[${page}]] - `));
  if (at >= 0) rows[at] = entry;
  else rows.push(entry);
  writeFileSync(indexPath, `${rows.join('\n')}\n`);

  const logPath = join(dir, 'log.md');
  if (!existsSync(logPath)) writeFileSync(logPath, '# Log\n\n');
  appendFileSync(logPath, `## [${today()}] ${kind} | ${pageTitle}\n`);
  log?.append('wiki', { page, writeKind: kind, sources: sources.length, claims: claims.length });
  return { ok: true, output: `wrote wiki/${page}.md, its index entry and its log line`, page: `wiki/${page}.md`, claims: claims.length };
}

const ENTRY = /^- \[\[([a-z0-9][a-z0-9-]{0,63})\]\] - (.+)$/;

export function lintWiki(root) {
  const dir = join(root, 'wiki');
  if (!existsSync(dir)) return { problems: [], pages: 0, skipped: true };
  const problems = [];
  const indexPath = join(dir, 'index.md');
  const logPath = join(dir, 'log.md');
  if (!existsSync(indexPath)) problems.push('wiki/index.md is missing');
  if (!existsSync(logPath)) problems.push('wiki/log.md is missing');
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

  const indexed = new Set();
  for (const row of indexText.split('\n')) {
    const match = ENTRY.exec(row);
    if (match) indexed.add(match[1]);
  }
  const pages = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'index.md' && name !== 'log.md').sort()) {
    const parsed = parsePage(readFileSync(join(dir, file), 'utf8'));
    if (parsed) pages.set(file.slice(0, -3), parsed);
    else problems.push(`wiki/${file} has no frontmatter`);
  }

  for (const name of pages.keys()) if (!indexed.has(name)) problems.push(`page ${name} has no entry in wiki/index.md`);
  for (const name of indexed) if (!pages.has(name)) problems.push(`wiki/index.md lists ${name}, which has no page`);
  for (const target of linksIn(indexText)) if (!pages.has(target)) problems.push(`wiki/index.md links to ${target}, which has no page`);

  const linkedFrom = new Set();
  for (const [name, page] of pages) {
    for (const target of linksIn(page.body)) {
      if (!pages.has(target)) problems.push(`page ${name} links to ${target}, which has no page`);
      else if (target !== name) linkedFrom.add(target);
    }
  }
  for (const name of pages.keys()) if (!linkedFrom.has(name)) problems.push(`page ${name} is an orphan: no other page links to it`);

  const logTitles = new Set(logText.split('\n').map((row) => /^## \[\d{4}-\d{2}-\d{2}\] (?:ingest|answer|lint) \| (.+)$/.exec(row)?.[1]).filter(Boolean));
  for (const [name, page] of pages) {
    if (!logTitles.has(page.title)) problems.push(`page ${name} has no line in wiki/log.md`);
    for (const id of page.sources) if (sourceText(root, id) === null) problems.push(`page ${name} cites source ${id}, which is not in sources/`);
    for (const claim of page.claims) {
      if (!page.sources.includes(claim.source)) problems.push(`page ${name} has a claim from ${claim.source}, which it does not list`);
      const text = sourceText(root, claim.source);
      if (text !== null && !text.includes(claim.quote)) problems.push(`page ${name}: a quote is no longer in source ${claim.source}`);
    }
  }

  const registry = registryOf(root, problems);
  for (const [name, page] of pages) {
    for (const id of page.sources) {
      const url = registry.find((entry) => entry.id === id)?.url;
      const latest = url === undefined ? undefined : registry.filter((entry) => entry.url === url).at(-1);
      if (latest && latest.id !== id && Date.parse(latest.at) > Date.parse(page.updated)) {
        problems.push(`page ${name} cites source ${id}, but ${url} was archived again as ${latest.id} at ${latest.at}`);
      }
    }
  }

  for (const [name, page] of pages) {
    for (const other of page.contradicts) {
      if (!pages.has(other)) {
        problems.push(`page ${name} contradicts ${other}, which has no page`);
        continue;
      }
      const resolved = [...pages].some(
        ([later, body]) => later !== name && (body.resolves.includes(name) || body.resolves.includes(other)) && Date.parse(body.updated) > Date.parse(page.updated),
      );
      if (!resolved) problems.push(`open contradiction: ${name} contradicts ${other}`);
    }
    for (const other of page.resolves) if (!pages.has(other)) problems.push(`page ${name} resolves ${other}, which has no page`);
  }

  const claims = [...pages.values()].reduce((sum, page) => sum + page.claims.length, 0);
  return { problems, pages: pages.size, claims, skipped: false };
}

export function wikiCheck(root) {
  const lint = lintWiki(root);
  if (lint.skipped) return { ok: true, detail: 'no wiki' };
  return lint.problems.length
    ? { ok: false, detail: `${lint.problems.length} problems: ${lint.problems.slice(0, 3).join(' | ')}` }
    : { ok: true, detail: `${lint.pages} pages, ${lint.claims} claims, lint clean` };
}

function linksIn(text) {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
}

function parsePage(text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0) fields[line.slice(0, at)] = JSON.parse(line.slice(at + 2));
  }
  return {
    title: fields.title ?? '',
    updated: fields.updated ?? '',
    sources: fields.sources ?? [],
    claims: fields.claims ?? [],
    contradicts: fields.contradicts ?? [],
    resolves: fields.resolves ?? [],
    body: match[2],
  };
}

function registryOf(root, problems) {
  const file = join(root, 'sources', 'index.jsonl');
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    problems.push('sources/index.jsonl is not JSON lines');
    return [];
  }
}
