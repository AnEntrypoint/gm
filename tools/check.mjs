#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from '../src/gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const gate = await runGate(root);
if (!gate.ok) failures.push(`gate: ${gate.failed.join(', ')}`);

const snapshot = join(root, 'research', 'g3-snapshot-2026-11-06.json');
try {
    const pinned = JSON.parse(readFileSync(snapshot, 'utf8'));
    if (!Number.isInteger(pinned.gmSessions) || !pinned.gmHost || !pinned.gmLive || !pinned.nonGm) failures.push('g3 snapshot: fields missing');
} catch (error) {
    failures.push(`g3 snapshot: ${error.message}`);
}

const unitTests = spawnSync(process.execPath, [join(root, 'tools', 'scan-unit-tests.mjs'), root], { cwd: root, stdio: 'inherit', timeout: 60000 });
if (unitTests.status !== 0) failures.push('unit-test scan');

const binary = join(root, 'build', 'release', 'native', 'components', 'host', process.platform === 'win32' ? 'gm.exe' : 'gm');
if (!existsSync(binary)) {
    failures.push(`redaction witness: no binary at ${binary}; run cmake --preset release and cmake --build build/release`);
} else {
    const witness = spawnSync(process.execPath, [join(root, 'tools', 'witness-redaction.mjs'), binary], { cwd: root, stdio: 'inherit', timeout: 300000 });
    if (witness.status !== 0) failures.push('redaction witness');
}

const readCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-read-truncation.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 120000 });
if (readCheck.status !== 0) failures.push('read truncation check');

const callerCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-caller.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 120000 });
if (callerCheck.status !== 0) failures.push('caller check');

const searchRootCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-search-root.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 240000 });
if (searchRootCheck.status !== 0) failures.push('search root check');

const inflightCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-inflight.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 240000 });
if (inflightCheck.status !== 0) failures.push('inflight check');

const relayExitCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-relay-exit.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 180000 });
if (relayExitCheck.status !== 0) failures.push('relay exit check');

const consoleCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-console.mjs'), ...(existsSync(binary) ? [binary] : [])], { cwd: root, stdio: 'inherit', timeout: 240000 });
if (consoleCheck.status !== 0) failures.push('console check');

const lostWordingCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-lost-wording.mjs')], { cwd: root, stdio: 'inherit', timeout: 60000 });
if (lostWordingCheck.status !== 0) failures.push('lost wording check');

const prdLegacyListCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-prd-legacy-list.mjs')], { cwd: root, stdio: 'inherit', timeout: 60000 });
if (prdLegacyListCheck.status !== 0) failures.push('prd legacy list check');

const toolingChecks = [
    ['commit digest check', 'check-commit-digest.mjs', 120000],
    ['task set check', 'check-task-set.mjs', 120000],
    ['child task check', 'check-child-task.mjs', 120000],
    ['output recovery check', 'check-output-recovery.mjs', 240000],
    ['context feed check', 'check-context-feed.mjs', 180000],
    ['grep paging check', 'check-grep-paging.mjs', 180000],
    ['prd receipt check', 'check-prd-receipt.mjs', 120000],
    ['prd refuted reopen check', 'check-prd-refuted-reopen.mjs', 120000],
    ['instruction automations check', 'check-instruction-automations.mjs', 180000],
    ['job progress check', 'check-job-progress.mjs', 180000],
];
for (const [label, file, timeout] of toolingChecks) {
    const args = [join(root, 'tools', file)];
    if (existsSync(binary)) args.push(binary);
    const check = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout });
    if (check.status !== 0) failures.push(label);
}

const documentedGapCheck = spawnSync(process.execPath, [join(root, 'tools', 'check-documented-gaps.mjs')], { cwd: root, stdio: 'inherit', timeout: 60000 });
if (documentedGapCheck.status !== 0) failures.push('documented gap check');

if (failures.length) {
    console.error(`check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('check: gate, unit-test scan, g3 snapshot, redaction witness, read truncation, caller, search root, inflight, relay exit, console, lost wording, prd legacy list, commit digest, task set, child task, output recovery, context feed, grep paging, prd receipt, prd refuted reopen and documented gap checks passed');
