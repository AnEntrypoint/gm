#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct, bodyValue, assert, initialize, session, programs, withWorkspace, value } from './check-output-recovery.mjs';


direct('check-child-task', (s) => {
  const plain = s.rpc('tools/call', { name: 'next_context', arguments: { task: 'Read-only R7 child overwrite' } });
  const child = s.rpc('tools/call', { name: 'next_context', arguments: { child: true, run: 'shared', task: 'child overwrite' } });
  const owner = s.rpc('tools/call', { name: 'next_context', arguments: { task: 'owner replacement', owner: true } });
  return { plain, child, owner };
}).verify = (failures, replies, ids, program) => {
  const plain = value(replies, ids.plain);
  const child = value(replies, ids.child);
  const owner = value(replies, ids.owner);
  assert(failures, plain?.ok === false && String(plain?.error ?? '').includes('owner'), program + ': plain late task replacement was not refused');
  assert(failures, child?.ok === false, program + ': child task replacement was not refused');
  assert(failures, owner?.ok === true && owner.task === 'owner replacement', program + ': owner task replacement was refused');
};

