import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The raw source archive. A fetched body is saved in full, as ASCII text: every non-ASCII UTF-16
// code unit is written as a \uXXXX escape, so the repo's ASCII rule holds and the text can be recovered. A file is named by
// the first 12 hex digits of the sha256 of its bytes, and it is written once: an existing file is never overwritten.
// sources/index.jsonl is the append-only registry of fetches: one line per fetch, with its url, source id and time.
const SOURCE_NAME = /^[0-9a-f]{12}\.txt$/;
const REGISTRY = 'index.jsonl';

export function asciiText(text) {
  return text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function sourceIdOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export function archiveSource(root, body, url) {
  const stored = Buffer.from(asciiText(body.toString('utf8')), 'utf8');
  const id = sourceIdOf(stored);
  const dir = join(root, 'sources');
  mkdirSync(dir, { recursive: true });
  let created = true;
  try {
    writeFileSync(join(dir, `${id}.txt`), stored, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    created = false;
  }
  appendFileSync(join(dir, REGISTRY), `${JSON.stringify({ url, id, at: new Date().toISOString() })}\n`);
  return { id, created };
}

// The gate's check. Every file in sources/ is either the registry, which must hold one JSON object per line, or a source
// whose sha256 prefix is its name. An edited source no longer matches its name, so the commit is refused.
export function sourcesCheck(root) {
  const dir = join(root, 'sources');
  if (!existsSync(dir)) return { ok: true, detail: 'no sources archived' };
  const bad = [];
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (name === REGISTRY) {
      for (const line of readFileSync(join(dir, REGISTRY), 'utf8').split('\n').filter(Boolean)) {
        try {
          JSON.parse(line);
        } catch {
          bad.push(`${REGISTRY} has a line that is not JSON`);
          break;
        }
      }
      continue;
    }
    if (!SOURCE_NAME.test(name)) {
      bad.push(`${name} is not a source name`);
      continue;
    }
    count += 1;
    const id = sourceIdOf(readFileSync(join(dir, name)));
    if (`${id}.txt` !== name) bad.push(`${name} has the hash of ${id}`);
  }
  return bad.length ? { ok: false, detail: bad.join(' | ') } : { ok: true, detail: `${count} sources match their names` };
}
