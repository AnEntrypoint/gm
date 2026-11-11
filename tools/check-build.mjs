#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const only = onlyAt === -1 ? null : argv[onlyAt + 1];
const buildArg = argv.find((arg, index) => arg !== '--only' && (onlyAt === -1 || index !== onlyAt + 1) && !arg.startsWith('--'));
const buildDir = resolve(buildArg ?? join(root, 'build', 'release'));
const hostDir = join(buildDir, 'native', 'components', 'host');
const names = process.platform === 'win32' ? ['gm.exe', 'gm-core.exe'] : ['gm', 'gm-core'];
const binary = names.map((name) => join(hostDir, name)).find((path) => existsSync(path));

if (!binary) {
    console.error(`check-build: no gm binary under ${buildDir}`);
    process.exit(2);
}

const CONFORMANCE = 'conformance';
const NATIVE = [
    'check-browser-scope.mjs', 'check-run-code-budget.mjs', 'check-turn-economy.mjs', 'check-restart-jobs.mjs', 'check-run-code-progress.mjs',
    'check-shell-stdin.mjs', 'check-grep-state-scope.mjs', 'check-job-bounds.mjs', 'check-early-run-code.mjs', 'check-stop-fetch.mjs',
    'check-read-parity.mjs', 'check-read-truncation.mjs', 'check-protocol-versions.mjs', 'check-resources-subscribe.mjs', 'check-startup-attempts.mjs',
    'check-skill-serve.mjs', 'check-no-resource-client.mjs', 'check-restart-skill-read.mjs', 'check-relay-reexec.mjs', 'check-embedded-runtime.mjs',
    'witness-next-context-replay.mjs', 'check-install-switch.mjs', 'check-repeated-checks.mjs', 'check-owner-identity.mjs', 'check-build-handover.mjs', 'check-cli-flags.mjs', 'check-cut-marker.mjs', 'check-feed-reference.mjs',
];
const NODE = ['check-turn-economy.mjs', 'check-restart-jobs.mjs', 'check-no-resource-client.mjs', 'check-repeated-checks.mjs'];
const EXCLUSIVE = new Set(['check-relay-reexec.mjs']);
const JOBS = Math.max(1, Number(process.env.GM_CHECK_JOBS ?? Math.min(6, Math.floor(cpus().length / 2))));
const CACHE = join(buildDir, 'check-build-cache.json');
const LOGS = join(buildDir, 'check-build-logs');
const DURATIONS = join(buildDir, 'check-build-durations.json');
const durations = existsSync(DURATIONS) ? JSON.parse(readFileSync(DURATIONS, 'utf8')) : {};
mkdirSync(LOGS, { recursive: true });

const fingerprint = () => {
    const hash = createHash('sha256');
    const stat = statSync(binary);
    hash.update(`${binary}:${stat.size}:${stat.mtimeMs}`);
    for (const dir of ['src', 'skills', 'defaults', 'tools', join('native', 'leaves')]) {
        const walk = (path) => {
            for (const name of readdirSync(join(root, path)).sort()) {
                if (path === 'tools' && /^(check|witness)-/.test(name)) continue;
                const full = join(root, path, name);
                const info = statSync(full);
                if (info.isDirectory()) walk(join(path, name));
                else hash.update(`${join(path, name)}:${info.size}:${info.mtimeMs}`);
            }
        };
        if (existsSync(join(root, dir))) walk(dir);
    }
    return hash.digest('hex');
};
const importClosure = (file, seen) => {
    if (seen.has(file) || !existsSync(file)) return seen;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) importClosure(resolve(dirname(file), spec), seen);
    return seen;
};
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const print = (text) => process.stdout.write(`${text}\n`);

const workspace = mkdtempSync(join(tmpdir(), 'gm-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-check-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const timings = [];
const failures = [];
const started = Date.now();

const logPath = (label) => join(LOGS, `${label.replace(/[^A-Za-z0-9.-]+/g, '_')}.log`);

const runOne = (label, script, args, key) =>
    new Promise((done) => {
        const at = Date.now();
        const log = logPath(label);
        const out = [];
        const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', (chunk) => out.push(chunk));
        child.stderr.on('data', (chunk) => out.push(chunk));
        const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
        child.on('close', (status) => {
            clearTimeout(timer);
            const wall = (Date.now() - at) / 1000;
            writeFileSync(log, Buffer.concat(out));
            timings.push({ label, wall, status });
            durations[label] = wall;
            if (status === 0) {
                if (key) cache[label] = key;
                print(`check-build: ${label} ok ${wall.toFixed(1)} s`);
            } else {
                failures.push(label);
                print(`check-build: ${label} FAILED ${wall.toFixed(1)} s, log ${log}`);
            }
            done(status === 0);
        });
    });

const rescued = [];
const runPool = async (jobs, limit) => {
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
        while (next < jobs.length) {
            const job = jobs[next];
            next += 1;
            await runOne(job.label, job.script, job.args, job.key);
        }
    });
    await Promise.all(lanes);
    for (const job of jobs.filter((job) => failures.includes(job.label))) {
        failures.splice(failures.indexOf(job.label), 1);
        const first = logPath(job.label);
        if (existsSync(first)) renameSync(first, first.replace(/\.log$/, '.first-failure.log'));
        if (await runOne(job.label, job.script, job.args, job.key)) {
            rescued.push(job.label);
            print(`check-build: ${job.label} passed alone after failing in the pool (load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores)`);
        }
    }
};

const selected = (name) => only === null || only === name || only === name.replace(/\.mjs$/, '');

const pipeline = async () => {
    const fp = fingerprint();
    const keyOf = (label, script) => {
        const hash = createHash('sha256').update(`${label}:${fp}`);
        for (const file of [...importClosure(join(root, 'tools', script), new Set())].sort()) hash.update(`${file}:${readFileSync(file)}`);
        return hash.digest('hex');
    };
    const cached = (label, key) => cache[label] === key && !failures.includes(label);

    const jobs = [];
    const exclusive = [];
    const plan = (label, key, job, into) => {
        if (cached(label, key)) {
            print(`check-build: ${label} skipped, inputs unchanged`);
            return;
        }
        into.push({ label, key, ...job });
    };

    if (only === null || only === CONFORMANCE) {
        plan(CONFORMANCE, createHash('sha256').update(`conformance:${fp}`).digest('hex'), { script: join(root, 'tools', 'mcp-conformance.mjs'), args: ['--stdio', binary, 'serve', '--workspace', workspace, '--mcp-config', mcpConfig] }, jobs);
    }
    for (const name of NATIVE.filter(selected)) {
        plan(name, keyOf(name, name), { script: join(root, 'tools', name), args: [binary] }, EXCLUSIVE.has(name) ? exclusive : jobs);
    }
    for (const name of NODE.filter((name) => selected(name) && !EXCLUSIVE.has(name))) {
        const label = `${name} (node)`;
        plan(label, keyOf(label, name), { script: join(root, 'tools', name), args: ['node'] }, jobs);
    }
    if (process.argv.includes('--slow')) {
        for (const name of ['check-run-code-budget.mjs', 'check-turn-economy.mjs']) {
            const label = `${name} (real clock)`;
            plan(label, keyOf(label, name), { script: join(root, 'tools', name), args: [binary, '--real-clock'] }, jobs);
        }
    }
    if (process.argv.includes('--mutations')) {
        exclusive.push({ label: 'check-clock-mutations.mjs', script: join(root, 'tools', 'check-clock-mutations.mjs'), args: [buildDir], key: null });
    }
    jobs.sort((a, b) => (durations[b.label] ?? 30) - (durations[a.label] ?? 30));
    await runPool(jobs, JOBS);
    for (const job of exclusive) await runOne(job.label, job.script, job.args, job.key);
    return failures.length === 0 ? 0 : 1;
};

let status = 1;
try {
    status = await pipeline();
} finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    writeFileSync(DURATIONS, JSON.stringify(durations, null, 2));
    const wall = ((Date.now() - started) / 1000).toFixed(1);
    const top = [...timings].sort((a, b) => b.wall - a.wall).slice(0, 5).map((row) => `${row.label} ${row.wall.toFixed(1)} s`).join('; ');
    print(`check-build: ${timings.length} run, ${failures.length} failed, ${rescued.length} passed alone after a pool failure, jobs ${JOBS}, load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores, wall ${wall} s; longest: ${top || 'none'}`);
}
process.exit(status);
