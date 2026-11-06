import { resultZone1 } from './compact.mjs';

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

export const COMPACT = {
  tools: {
    wiki_write: {
      zone1: resultZone1,
      zone2: (event, action) => ({
        seq: event.seq,
        tool: 'wiki_write',
        ok: event.ok,
        page: action?.args?.page,
        claims: Array.isArray(action?.args?.claims) ? action.args.claims.length : 0,
        full: { seq: event.seq, bytes: Buffer.byteLength(typeof event.output === 'string' ? event.output : '') },
      }),
    },
  },
};

export function createWikiVerbs({ root, log }) {
  return {
    async wiki_write(args) {
      const { wikiWrite } = await import('./wiki.mjs');
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
