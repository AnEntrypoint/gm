import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OTHER_SOURCE_ID, SOURCE_ID, git } from './codeast-wiki-review-fixture.mjs';

const withoutUpdated = (text) => text.split('\n').filter((line) => !line.startsWith('updated: ')).join('\n');
const withoutDate = (text) => text.replace(/^## \[\d{4}-\d{2}-\d{2}\]/gm, '## [DATE]');

export const CASES = {
  codeAst: [
    ['callers', { name: 'alpha' }],
    ['callers', { name: 'beta', limit: 1 }],
    ['callers', { name: 'run' }],
    ['callers', { name: 'class' }],
    ['callers', { name: '1x' }],
    ['callers', { name: 'alpha', limit: 0 }],
    ['impact', { name: 'alpha' }],
    ['impact', { name: 'beta', depth: 0 }],
    ['impact', { name: 'beta', depth: 5 }],
    ['impact', { name: 'alpha', depth: 9 }],
    ['impact', { name: 'nothingHere' }],
  ],
  wikiSearch: [
    ['wiki_search', { query: 'sky blue' }],
    ['wiki_search', { query: 'water', k: 1 }],
    ['wiki_search', { query: 'blueSky' }],
    ['wiki_search', { query: 'zzzz' }],
    ['wiki_search', { query: '' }],
    ['wiki_search', { query: '!!!' }],
    ['wiki_search', { query: 'sky', k: 0 }],
    ['wiki_search', { query: 'sky', bogus: 1 }],
    ['wiki_search', { query: 'sky', root: 'no-such-dir' }],
    ['wiki_search', { query: 'sky', root: 'src/a.mjs' }],
    ['wiki_search', { query: 'sky', root: 'src' }],
    ['wiki_search', { query: 'sky', root: 'src', cwd: 'docs' }],
  ],
  wikiWriteRefusals: [
    ['wiki_write', { page: 'Bad Page', title: 't', body: 'b', summary: 's', sources: [SOURCE_ID] }],
    ['wiki_write', { page: 'p', title: 'two\nlines', body: 'b', summary: 's', sources: [SOURCE_ID] }],
    ['wiki_write', { page: 'p', title: 't', body: 'caf\u00e9', summary: 's', sources: [SOURCE_ID] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: '', sources: [SOURCE_ID] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: [SOURCE_ID], kind: 'other' }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: [] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: ['000000000000'] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: [SOURCE_ID], claims: [{ quote: 'x', source: OTHER_SOURCE_ID }] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: [SOURCE_ID], claims: [{ quote: 'The sky is green.', source: SOURCE_ID }] }],
    ['wiki_write', { page: 'p', title: 't', body: 'b', summary: 's', sources: [SOURCE_ID], contradicts: ['Bad'] }],
  ],
};

export async function scenario({ call, appendRaw, root }) {
  const out = {};
  for (const [group, cases] of Object.entries(CASES)) {
    out[group] = [];
    for (const [verb, args] of cases) out[group].push(await call(verb, args));
  }
  out.lintBefore = await call('wiki_lint', {});
  out.write = await call('wiki_write', {
    page: 'grass',
    title: 'Grass',
    body: 'Grass is green, and so is the [[sky]] sometimes.',
    summary: 'Grass colour',
    sources: [OTHER_SOURCE_ID, SOURCE_ID],
    claims: [{ quote: 'Grass is green.', source: OTHER_SOURCE_ID }, { quote: 'Caf\u00e9 is open.', source: SOURCE_ID }],
    resolves: ['sky'],
  });
  out.rewrite = await call('wiki_write', { page: 'grass', title: 'Grass again', body: 'Short.\n', summary: 'Grass, again', sources: [OTHER_SOURCE_ID], kind: 'answer' });
  out.files = {
    page: withoutUpdated(readFileSync(join(root, 'wiki/grass.md'), 'utf8')),
    index: readFileSync(join(root, 'wiki/index.md'), 'utf8'),
    log: withoutDate(readFileSync(join(root, 'wiki/log.md'), 'utf8')),
  };
  out.lintAfter = await call('wiki_lint', {});
  out.searchAfter = await call('wiki_search', { query: 'grass' });

  out.review = [];
  const step = async (verb, args) => {
    const reply = await call(verb, args);
    out.review.push([verb, reply]);
    return reply;
  };
  await step('review_packet', { spec: 'docs/missing.md' });
  await step('review_packet', { spec: 'docs/spec.md', refs: ['src/a.mjs', 'nope.js'] });
  await step('review_packet', { spec: 'docs/spec.md', refs: 'src/a.mjs' });
  const made = await step('review_packet', { spec: 'docs/spec.md', refs: ['src/b.mjs', 'src/a.mjs'] });
  const packet = JSON.parse(made.output).packet;
  await step('review_join', {});
  await step('review_record', { packet: 'feedface', verdict: 'pass', reviewer: 'r1' });
  await step('review_record', { packet, verdict: 'maybe', reviewer: 'r1' });
  await step('review_record', { packet, verdict: 'pass', reviewer: '  ' });
  await step('review_record', { packet, verdict: 'pass', reviewer: 'r1', notes: 'looks right' });
  await step('review_record', { packet, verdict: 'fail', reviewer: 'r2' });
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  appendRaw({ kind: 'commit', sha: head, gate: [{ ok: true }, { ok: true }] });
  appendRaw({ kind: 'result', tool: 'git_commit', ok: true });
  appendRaw({ kind: 'commit', sha: 'deadbeef', gate: [{ ok: false }] });
  appendRaw({ kind: 'result', tool: 'git_commit', ok: false });
  writeFileSync(join(root, 'docs/spec.md'), '# Spec\n\nEdited after review.\n');
  git(root, ['commit', '-q', '-m', 'edit spec', '--', 'docs/spec.md']);
  appendRaw({ kind: 'commit', sha: git(root, ['rev-parse', 'HEAD']).trim(), gate: [{ ok: true }] });
  appendRaw({ kind: 'result', tool: 'git_commit', ok: true });
  appendRaw({ kind: 'end', status: 'finished', witness: 'w' });
  await step('review_join', {});
  return out;
}
