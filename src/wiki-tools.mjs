// The wiki's write tool. wiki_search is in search.mjs, beside search. wikiWrite refuses a claim whose quote is not in its named
// source, and it writes nothing when it refuses.
import { wikiWrite } from './wiki.mjs';

const str = { type: 'string' };
const list = { type: 'array', items: str };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const WIKI_TOOLS = [
  {
    name: 'wiki_write',
    description: 'Write a wiki page, wiki/<page>.md, with its source ids and its claims. A claim quote must appear in its named source (sources/<id>.txt), or the whole page is refused and nothing is written. Updates wiki/index.md and wiki/log.md. kind is ingest (default), answer or lint. page is lowercase letters, digits and hyphens. contradicts and resolves name pages.',
    inputSchema: obj({ page: str, title: str, body: str, summary: str, sources: list, claims: { type: 'array', items: { type: 'object' } }, kind: str, contradicts: list, resolves: list }, ['page', 'title', 'body', 'summary', 'sources']),
  },
];

export function createWikiVerbs({ root, log }) {
  return {
    wiki_write(args) {
      const result = wikiWrite({
        root,
        log,
        page: args.page,
        title: args.title,
        body: args.body,
        summary: args.summary,
        sources: args.sources ?? [],
        claims: args.claims ?? [],
        kind: args.kind ?? 'ingest',
        contradicts: args.contradicts ?? [],
        resolves: args.resolves ?? [],
      });
      return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
    },
  };
}
