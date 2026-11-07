#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct, bodyValue, assert, initialize, session, programs, withWorkspace, value } from './check-output-recovery.mjs';
import { execFileSync } from 'node:child_process';

direct('check-grep-paging', (s, workspace) => {
  execFileSync('git', ['init', '-q', workspace], { cwd: workspace });
  for (let i = 0; i < 40; i += 1) writeFileSync(join(workspace, 'f' + i + '.txt'), i === 39 ? 'NEEDLE_TAIL' : 'needle ' + i);
  const id = s.rpc('tools/call', { name: 'run_code', arguments: { body: "let r = await gm.grep({ pattern: 'needle|NEEDLE_TAIL', limit: 3, scope: 'all' }); const seen = []; let tail = String(r.output).includes('NEEDLE_TAIL'); while (r.nextOffset !== null) { seen.push(r.nextOffset); r = await gm.grep({ pattern: 'needle|NEEDLE_TAIL', limit: 3, scope: 'all', offset: r.nextOffset }); tail ||= String(r.output).includes('NEEDLE_TAIL'); } return { truncated: r.scanTruncated, nextOffset: r.nextOffset, cursor: !!r.scanCursor, totalMatches: r.totalMatches, digest: !!r.digest, pages: seen.length, tail };", format: 'esm' } });
  return { id };
}).verify = (failures, replies, ids, program) => {
  const r = bodyValue(replies, ids.id);
  assert(failures, r?.truncated === false && r.cursor === true && r.digest === true && r.tail === true, program + ': structured grep paging did not finish with the tail match');
};

