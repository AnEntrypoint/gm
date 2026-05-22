'use strict';
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const fsSync = require('fs');

function findPlugkit() {
  if (process.env.PLUGKIT_BIN && fsSync.existsSync(process.env.PLUGKIT_BIN)) return process.env.PLUGKIT_BIN;
  const home = os.homedir();
  const candidates = [
    path.join(__dirname, '..', 'bin', 'plugkit.js'),
    path.join(home, '.gm-tools', 'plugkit.js'),
    path.join(home, '.claude', 'gm-tools', 'plugkit.js'),
  ];
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  id: 'browser',
  exec: {
    run(code, cwd) {
      const tmp = path.join(os.tmpdir(), 'gm-browser-' + Date.now() + '.js');
      try {
        fsSync.writeFileSync(tmp, code, 'utf-8');
        const plugkit = findPlugkit();
        if (!plugkit) return '[plugkit wrapper not found]';
        const opts = { encoding: 'utf-8', timeout: 120000, windowsHide: true, ...(cwd && { cwd }) };
        const r = spawnSync(process.execPath, [plugkit, 'exec', '--lang', 'browser', '--file', tmp], opts);
        const out = (r.stdout || '').trimEnd();
        const err = (r.stderr || '').trimEnd();
        return out && err ? out + '\n[stderr]\n' + err : out || err || '(no output)';
      } finally {
        try { fsSync.unlinkSync(tmp); } catch (_) {}
      }
    }
  }
};
