#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct, bodyValue, assert, initialize, session, programs, withWorkspace, value } from './check-output-recovery.mjs';
import { outputDigest } from '../src/compact.mjs';

const success = outputDigest('[main 94ef9e7] fix Error handling in parser\n 1 file changed', false);
const failed = outputDigest('ERROR: disk quota exceeded', true);
if (success.errors) { console.error('check-commit-digest: failed: ok:true commit line classified as an error'); process.exit(1); }
if (!failed.errors) { console.error('check-commit-digest: failed: exit-1 ERROR line not classified as an error'); process.exit(1); }
direct('check-commit-digest', (s) => {
  const id = s.rpc('tools/call', { name: 'run_code', arguments: { body: "return await gm.run_shell({ command: 'printf \"[main 94ef9e7] fix Error handling in parser\\n 1 file changed\\n\"' });" } });
  return { id };
}).verify = (failures, replies, ids, program) => {
  const r = bodyValue(replies, ids.id);
  assert(failures, r?.ok === true, program + ': successful commit status shell failed');
};

