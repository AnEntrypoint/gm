#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct, bodyValue, assert, initialize, session, programs, withWorkspace, value } from './check-output-recovery.mjs';


direct('check-task-set', (s) => {
  const replace = s.rpc('tools/call', { name: 'run_code', arguments: { body: "return await gm.task_set({ task: 'replacement task', owner: true });" } });
  const clear = s.rpc('tools/call', { name: 'run_code', arguments: { body: "return await gm.task_set({ task: null, owner: true });" } });
  const finishId = s.rpc('tools/call', { name: 'finish', arguments: { witness: 'task-set check: owner task cleared' } });
  const refused = s.rpc('tools/call', { name: 'run_code', arguments: { body: 'return 1;' } });
  const successor = s.rpc('tools/call', { name: 'next_context', arguments: {} });
  return { replace, clear, finishId, refused, successor };
}).verify = (failures, replies, ids, program) => {
  const replace = bodyValue(replies, ids.replace);
  const clear = bodyValue(replies, ids.clear);
  const successor = value(replies, ids.successor);
  assert(failures, replace?.task === 'replacement task', program + ': gm.task_set did not replace the task');
  assert(failures, clear?.cleared === true, program + ': gm.task_set did not clear the task');
  assert(failures, successor?.task === null || successor?.task === '', program + ': successor inherited a stale task');
  const refusal = value(replies, ids.refused);
  assert(failures, String(refusal?.error ?? '').includes('has ended'), program + ': ended-run refusal text changed');
};

