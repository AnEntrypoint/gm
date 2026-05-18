#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ensureReady, startSpoolDaemon } = require('./bootstrap');

const usage = `gm-plugkit — Bootstrap and daemon-spawn for gm plugkit binary.

Usage:
  bun x gm-plugkit@latest          Bootstrap + start spool daemon
  bun x gm-plugkit@latest spool    Same as default (explicit)
  bun x gm-plugkit@latest --daemon Same as default
  bun x gm-plugkit@latest --binary Print binary path only
  bun x gm-plugkit@latest --status JSON status check
  bun x gm-plugkit@latest --help   Show this help
`;

function spoolDir() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, '.gm', 'exec-spool');
}

function ensureSpoolDir() {
  try { fs.mkdirSync(spoolDir(), { recursive: true }); } catch (_) {}
}

function writeCliStatus(spec) {
  try {
    ensureSpoolDir();
    fs.writeFileSync(
      path.join(spoolDir(), '.cli-status.json'),
      JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...spec }, null, 2)
    );
  } catch (_) {}
}

function writeCliError(phase, err) {
  try {
    ensureSpoolDir();
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack : null;
    fs.writeFileSync(
      path.join(spoolDir(), '.bootstrap-error.json'),
      JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, error_phase: phase, error_message: msg, stack }, null, 2)
    );
  } catch (_) {}
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  ensureSpoolDir();
  writeCliStatus({ phase: 'starting', args });

  let bootstrapResult;
  try {
    bootstrapResult = await ensureReady();
  } catch (err) {
    writeCliError('ensure-ready', err);
    console.error('Bootstrap failed:', err.message);
    process.exit(1);
  }

  if (!bootstrapResult || !bootstrapResult.ok) {
    const errMsg = (bootstrapResult && bootstrapResult.error) || 'ensureReady returned non-ok';
    writeCliError('ensure-ready', new Error(errMsg));
    console.error('Bootstrap failed:', errMsg);
    process.exit(1);
  }

  writeCliStatus({ phase: 'bootstrapped', version: bootstrapResult.version, binary: bootstrapResult.binaryPath });

  let daemon;
  try {
    daemon = startSpoolDaemon();
  } catch (err) {
    writeCliError('start-daemon', err);
    console.error('Daemon start failed:', err.message);
    process.exit(1);
  }

  if (!daemon || !daemon.ok) {
    const errMsg = (daemon && daemon.error) || 'startSpoolDaemon returned non-ok';
    writeCliError('start-daemon', new Error(errMsg));
    console.error('Daemon start failed:', errMsg);
    process.exit(1);
  }

  writeCliStatus({ phase: 'ready', version: bootstrapResult.version, daemon_pid: daemon.pid, log: daemon.logPath });

  console.log(JSON.stringify({
    ok: true,
    binary: bootstrapResult.binaryPath,
    daemon,
    message: 'plugkit ready, spool watcher running'
  }));
  process.exit(0);
})().catch((err) => {
  writeCliError('uncaught', err);
  console.error('gm-plugkit failed:', err && err.message ? err.message : err);
  process.exit(1);
});
