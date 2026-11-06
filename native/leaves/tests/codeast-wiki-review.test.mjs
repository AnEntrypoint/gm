import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture, nativeHost, removeFixture } from './codeast-wiki-review-fixture.mjs';
import { scenario } from './codeast-wiki-review-scenario.mjs';

const expected = JSON.parse(readFileSync(new URL('./codeast-wiki-review.expected.json', import.meta.url), 'utf8'));
const leafDir = new URL('../', import.meta.url);

async function leafVerbs() {
  const table = {};
  for (const file of ['code-ast.mjs', 'wiki.mjs', 'review.mjs']) {
    const { verbs } = await import(new URL(file, leafDir));
    for (const verb of verbs) table[verb.name] = verb;
  }
  return table;
}

const today = new Date().toISOString().slice(0, 10);
const dated = (value) => JSON.parse(JSON.stringify(value).split(today).join('<DATE>'));

async function runLeafScenario() {
  const root = buildFixture();
  const runDir = mkdtempSync(join(tmpdir(), 'leaf-cwr-run-'));
  const host = nativeHost(root, runDir);
  globalThis.host = host;
  const table = await leafVerbs();
  try {
    const out = dated(await scenario({ root, call: (verb, args) => table[verb].call(args), appendRaw: (event) => host.appendRaw(event) }));
    const events = readFileSync(join(runDir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    out.events = events.map((event) => ({ kind: event.kind, keys: Object.keys(event).sort() }));
    return { out, host, events };
  } finally {
    removeFixture(root);
    rmSync(runDir, { recursive: true, force: true });
  }
}

const run = runLeafScenario();

test('each leaf exports verbs with name, description, inputSchema and call', async () => {
  const table = await leafVerbs();
  assert.deepEqual(Object.keys(table).sort(), ['callers', 'impact', 'review_join', 'review_packet', 'review_record', 'wiki_lint', 'wiki_search', 'wiki_write']);
  for (const verb of Object.values(table)) {
    assert.equal(typeof verb.description, 'string');
    assert.equal(verb.inputSchema.type, 'object');
    assert.equal(typeof verb.call, 'function');
  }
});

test('callers and impact match the Node code-ast on the fixture', async () => {
  const { out } = await run;
  out.codeAst.forEach((reply, i) => assert.deepEqual(reply, expected.codeAst[i], `case ${i}`));
});

test('wiki_search ranks wiki lines by BM25 as the Node search does', async () => {
  const { out } = await run;
  out.wikiSearch.forEach((reply, i) => assert.deepEqual(reply, expected.wikiSearch[i], `case ${i}`));
  assert.deepEqual(out.searchAfter, expected.searchAfter);
});

test('wiki_write refuses the same inputs with the same errors', async () => {
  const { out } = await run;
  out.wikiWriteRefusals.forEach((reply, i) => assert.deepEqual(reply, expected.wikiWriteRefusals[i], `case ${i}`));
});

test('wiki_write writes the page, index and log as the Node wikiWrite does', async () => {
  const { out } = await run;
  assert.deepEqual(out.write, expected.write);
  assert.deepEqual(out.rewrite, expected.rewrite);
  assert.deepEqual(out.files, expected.files);
});

test('wiki_lint returns the problems and pages that lintWiki returns', async () => {
  const { out } = await run;
  assert.deepEqual(out.lintBefore, expected.lintBefore);
  assert.deepEqual(out.lintAfter, expected.lintAfter);
});

test('review_packet, review_record and review_join match the Node review', async () => {
  const { out } = await run;
  out.review.forEach((reply, i) => assert.deepEqual(reply, expected.review[i], `step ${i} ${reply[0]}`));
});

test('the leaves log the same event kinds and fields as the Node modules', async () => {
  const { out } = await run;
  assert.deepEqual(out.events, expected.events);
});

test('wiki_lint on a workspace with no wiki is skipped', async () => {
  const root = mkdtempSync(join(tmpdir(), 'leaf-cwr-empty-'));
  try {
    globalThis.host = nativeHost(root, root);
    const table = await leafVerbs();
    const reply = table.wiki_lint.call({});
    assert.deepEqual({ problems: reply.problems, pages: reply.pages, skipped: reply.skipped }, { problems: [], pages: 0, skipped: true });
    assert.deepEqual(table.callers.call({ name: 'alpha' }), { ok: false, error: 'callers and impact need a git repository: git ls-files failed' });
    const empty = table.wiki_search.call({ query: 'alpha' });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /git ls-files failed/);
    assert.ok(empty.error.includes(root), `the refusal names the root: ${empty.error}`);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('wiki_search walks wiki/ outside git and names the root when it is empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'leaf-cwr-nogit-'));
  try {
    globalThis.host = nativeHost(root, root);
    const table = await leafVerbs();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, 'wiki'));
    writeFileSync(join(root, 'wiki', 'page.md'), 'alpha page\n');
    const found = table.wiki_search.call({ query: 'alpha' });
    assert.equal(found.ok, true);
    assert.match(found.output, /wiki\/page\.md:1/);
    rmSync(join(root, 'wiki'), { recursive: true, force: true });
    const empty = table.wiki_search.call({ query: 'alpha' });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /directory walk found no files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the leaves read files in pages through host.read_file', async () => {
  const { host } = await run;
  const reads = host.calls.filter((call) => call[0] === 'read_file');
  assert.ok(reads.length > 100, `read_file pages: ${reads.length}`);
  assert.ok(host.calls.some((call) => call[0] === 'run' && call[1].join(' ') === 'git ls-files -co --exclude-standard -z'));
});
