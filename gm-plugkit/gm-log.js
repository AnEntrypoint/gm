'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');

function currentSess() {
  return process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '';
}

function logEvent(sub, event, fields, opts) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const safeFields = { ...(fields || {}) };
    if (Object.prototype.hasOwnProperty.call(safeFields, 'pid')) {
      safeFields.child_pid = safeFields.pid;
      delete safeFields.pid;
    }
    const rec = {
      ts: new Date().toISOString(),
      sub,
      event,
      pid: process.pid,
      sess: (opts && opts.sess) || currentSess(),
    };
    if (!opts || opts.cwd !== false) rec.cwd = process.cwd();
    if (opts && opts.role) rec.role = opts.role;
    Object.assign(rec, safeFields);
    fs.appendFileSync(path.join(dir, `${sub}.jsonl`), JSON.stringify(rec) + '\n');
  } catch (_) {}
}

module.exports = { GM_LOG_ROOT, currentSess, logEvent };
