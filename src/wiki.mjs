import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asciiText } from './sources.mjs';

// The wiki: pages written from quoted sources, an index and a log. These are plain functions. No tool is registered for
// them. wikiWrite refuses a claim whose quote is not in its named source. The gate and finish run lintWiki (lint.mjs).
const PAGE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOURCE = /^[0-9a-f]{12}$/;
const KINDS = ['ingest', 'answer', 'lint'];

const isAscii = (text) => /^[\x00-\x7f]*$/.test(text);
const oneLine = (text) => typeof text === 'string' && text.trim() !== '' && !/[\r\n]/.test(text) && isAscii(text);
const today = () => new Date().toISOString().slice(0, 10);

// The archived text of a source, or null when it is not in sources/.
export function sourceText(root, id) {
  const file = join(root, 'sources', `${id}.txt`);
  return SOURCE.test(id) && existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// Writes one wiki page, updates its line in the index, and appends its line to the log. A page may be written again.
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
    `updated: ${new Date().toISOString()}`,
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
