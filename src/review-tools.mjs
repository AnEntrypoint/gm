// The review tools: a packet of a spec and its references, a reviewer's record on it, and the join of records with the commits and
// ends after them. The reviewer is spawned by the host, which passes its reply in. gm-new records the isolation as host-attested and
// does not verify it. The functions are in review.mjs.
import { resultZone1, resultZone2 } from './compact.mjs';

const OUTPUT_PAGE = 20000;
const str = { type: 'string' };
const list = { type: 'array', items: str };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const REVIEW_TOOLS = [
  {
    name: 'review_packet',
    description: 'Open a review of a spec file and the files it refers to. The references must exist. Returns the packet hash that review_record takes. A missing reference, or a spec that is not a file, is refused and logged.',
    inputSchema: obj({ spec: str, refs: list }, ['spec']),
  },
  {
    name: 'review_record',
    description: 'Record one reviewer verdict (pass, fail or needs-changes) on a packet, with the reviewer and its notes. Refused when the spec changed since the packet, when the packet already has a record, or when the verdict is unknown. Each record says isolation host-attested.',
    inputSchema: obj({ packet: str, verdict: str, reviewer: str, notes: str }, ['packet', 'verdict', 'reviewer']),
  },
  {
    name: 'review_join',
    description: 'Join the review records of this run with the commits and the ends after them: each commit with its gate outcome, and each end with its status and witness. A commit made after its spec changed is unattributed.',
    inputSchema: obj({}),
  },
];

// The review tools keep their witness in both horizons: review_packet keeps the packet hash that a record names. review_join lists the
// records, so the second horizon cuts it.
const packetOf = (event) => {
  try {
    return JSON.parse(event.output).packet;
  } catch {
    return undefined;
  }
};
export const COMPACT = {
  tools: {
    review_packet: {
      zone1: resultZone1,
      zone2: (event, action) => ({ ...resultZone2(event, action), packet: packetOf(event) }),
    },
    review_record: { zone1: resultZone1, zone2: resultZone2 },
    review_join: { zone1: resultZone1, zone2: () => null },
  },
};

export function createReviewVerbs({ root, log }) {
  return {
    // review.mjs loads on the first review call.
    async review_packet(args) {
      const { reviewPacket } = await import('./review.mjs');
      const result = reviewPacket({ root, log, spec: args.spec, refs: args.refs ?? [] });
      return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
    },
    async review_record(args) {
      const { reviewRecord } = await import('./review.mjs');
      const result = reviewRecord({ root, log, packet: args.packet, verdict: args.verdict, reviewer: args.reviewer, notes: args.notes ?? '' });
      return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
    },
    async review_join() {
      const { reviewJoin } = await import('./review.mjs');
      const text = JSON.stringify(reviewJoin(log.events(), root), null, 1);
      return { ok: true, output: text.length > OUTPUT_PAGE ? `${text.slice(0, OUTPUT_PAGE)}\n(truncated at ${OUTPUT_PAGE} characters)` : text };
    },
  };
}
