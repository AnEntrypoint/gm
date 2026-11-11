#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct, bodyValue, assert, initialize, session, programs, withWorkspace, value } from './check-output-recovery.mjs';


direct('check-context-feed', (s) => {
  const message = 'M'.repeat(3000);
  const output = 'O'.repeat(673);
  const long = s.rpc('tools/call', { name: 'run_code', arguments: { body: "await gm.git_commit({ message: '" + message + "', paths: [] }); return await gm.run_shell({ command: 'printf \"" + output + "\"' });", format: 'esm' } });
  const feed = s.rpc('tools/call', { name: 'next_context', arguments: { full: true } });
  const page = s.rpc('tools/call', { name: 'run_code', arguments: { body: "const parse = (r) => { const v = typeof r.output === 'string' ? JSON.parse(r.output) : r.output; return Array.isArray(v) ? v : []; }; const commits = parse(await gm.query_log({ js: 'events.filter(e => e.kind === \"code-call\" && e.tool === \"git_commit\")' })); const shells = parse(await gm.query_log({ js: 'events.filter(e => e.kind === \"code-call\" && e.tool === \"run_shell\")' })); const a = await gm.query_log({ seq: commits[commits.length - 1].seq, field: 'args.message', offset: 0, limit: 20000 }); const b = await gm.query_log({ seq: shells[shells.length - 1].seq, field: 'output', offset: 0, limit: 20000 }); return { a: a.output, b: b.output, cutRefs: a.cutRefs ?? b.cutRefs ?? [] };", format: 'esm' } });
  return { long, feed, page, message, output };
}).verify = (failures, replies, ids, program) => {
  const feed = value(replies, ids.feed);
  const page = bodyValue(replies, ids.page);
  assert(failures, Array.isArray(feed?.events) && JSON.stringify(feed.events).includes('cutRefs'), program + ': compact feed carries no cutRefs');
  assert(failures, page?.a === ids.message && page?.b === ids.output, program + ': query_log field paging did not round-trip both fields');
};

