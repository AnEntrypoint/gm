#!/usr/bin/env node
// The host's pipe to the gm-new core, tools/core.mjs. The host (Claude Code) starts this file from .mcp.json and holds its stdio. This file
// passes lines both ways, and it does nothing else: it reads where a line ends, never what the line says. The host's lines reach the core
// through a named pipe that this file keeps open for reading and for writing, so a core that exits does not close it, and the lines wait in
// the pipe for the next core. The core's output comes back on its stdout. When that output ends, the core is gone without a handover, and a
// new core starts after RESPAWN_MS. A core that hands over to a newer one keeps the output open, so no second core starts. An error is
// logged, and the connection stays open: this file does not exit on an error. It never changes, so a change to it needs the host to
// reconnect. Everything else is in the core.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, createWriteStream, openSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = join(dirname(fileURLToPath(import.meta.url)), 'core.mjs');
const RESPAWN_MS = 1000;
const EXIT_MS = 10000;
const args = process.argv.slice(2);
let core = null;
let closing = false;

function log(message) {
  process.stderr.write(`gm-new relay: ${message}\n`);
}

// An error in this process is logged, and the connection stays open.
process.on('uncaughtException', (err) => log(`error: ${err?.stack ?? err}`));
process.on('unhandledRejection', (err) => log(`error: ${err?.stack ?? err}`));
process.stdout.on('error', (err) => log(`host output: ${err.message}`));

// The input pipe. The relay holds a reader and a writer, so a write does not fail while no core runs, and the core's end of input comes only
// when this file ends the writer. Node closes a child's stdin when the child exits, so the pipe is not the child's: it is this file's.
const FIFO = join(tmpdir(), `gm-new-${process.pid}-${randomBytes(4).toString('hex')}.in`);
const made = spawnSync('mkfifo', [FIFO]);
if (made.status !== 0) {
  log(`cannot make the input pipe ${FIFO}: ${String(made.stderr || made.error?.message)}`);
  process.exit(1);
}
process.on('exit', () => {
  try {
    unlinkSync(FIFO);
  } catch {
    // The pipe is already gone.
  }
});
const reader = openSync(FIFO, constants.O_RDONLY | constants.O_NONBLOCK);
const input = createWriteStream(FIFO, { fd: openSync(FIFO, 'w') });
input.on('error', (err) => log(`input pipe: ${err.message}`));

function toCore(line) {
  input.write(`${line}\n`);
}

function start() {
  if (closing) return;
  const proc = spawn(process.execPath, [CORE, ...args], { stdio: [reader, 'pipe', 'inherit'] });
  core = proc;
  log(`core started (pid ${proc.pid})`);
  proc.on('error', (err) => log(`core did not start: ${err.message}`));
  proc.on('exit', (code, signal) => log(`core exited (${signal ?? `code ${code}`})`));
  createInterface({ input: proc.stdout, crlfDelay: Infinity })
    .on('line', (line) => {
      if (line.trim() !== '') process.stdout.write(`${line}\n`);
    })
    .on('close', () => {
      log('core output ended');
      if (closing) process.exit(0);
      if (core !== proc) return;
      core = null;
      setTimeout(start, RESPAWN_MS);
    });
}

// The end of the host's input ends the writer. The core reads what is left in the pipe, then its end of input, and it pauses its worker.
function shutdown() {
  if (closing) return;
  closing = true;
  log('host closed the connection; ending the core');
  input.end(() => {
    if (core === null) process.exit(0);
  });
  setTimeout(() => process.exit(0), EXIT_MS).unref();
}

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (line.trim() !== '') toCore(line);
  })
  .on('close', shutdown);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
start();

