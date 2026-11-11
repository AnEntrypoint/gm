#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = resolve(process.argv[2] ?? join(root, '.github', 'workflows', 'release.yml'));
const lines = readFileSync(workflow, 'utf8').split('\n');
const required = [
    {
        name: 'Replay witness',
        commands: [
            'npm ci --ignore-scripts',
            'build/${{ matrix.preset }}/native/components/tool/gm-tool check build/${{ matrix.preset }}/native/components/host/gm check-witness-next-context-replay',
        ],
    },
    {
        name: 'Node parity',
        commands: ['node native/tests/parity/run.mjs --bin build/${{ matrix.preset }}/native/components/host/gm'],
    },
    {
        name: 'Windows cmd-only run_shell witness',
        commands: ['gm-tool.exe check "build/${{ matrix.preset }}/native/components/host/gm.exe" witness-windows-cmd'],
        forbid: ['continue-on-error'],
    },
];

const failures = [];
const found = [];
for (const step of required) {
    const start = lines.findIndex((line) => line === `      - name: ${step.name}`);
    if (start < 0) {
        failures.push(`no "${step.name}" step`);
        continue;
    }
    let end = start + 1;
    while (end < lines.length && !/^(      - |  \S|\S)/.test(lines[end])) end += 1;
    const block = lines.slice(start, end).join('\n');
    const missing = step.commands.filter((text) => !block.includes(text));
    const forbidden = (step.forbid ?? []).filter((text) => block.includes(text));
    if (missing.length > 0) failures.push(`the "${step.name}" step lacks: ${missing.join('; ')}`);
    else if (forbidden.length > 0) failures.push(`the "${step.name}" step has ${forbidden.join('; ')}, so a failure would not fail its job`);
    else found.push({ step: step.name, lines: end - start, commands: step.commands.length });
}

if (failures.length > 0) {
    console.error(`ci-replay-step: ${failures.join('; ')} in ${workflow}`);
    process.exit(1);
}

console.log(JSON.stringify({ workflow, steps: found, ok: true }));
