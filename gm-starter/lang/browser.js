'use strict';
const path = require('path');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const fsSync = require('fs');

function findPlugkit() {
  try { execSync('plugkit --version', { encoding: 'utf-8', timeout: 3000 }); return 'plugkit'; } catch (_) {}
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'plugkit'),
    path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'gm-cc', 'bin', 'plugkit'),
  ];
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return p;
  }
  return 'plugkit';
}

module.exports = {
  id: 'browser',
  exec: {
    run(code, cwd) {
      const tmp = path.join(os.tmpdir(), 'gm-browser-' + Date.now() + '.js');
      try {
        fsSync.writeFileSync(tmp, code, 'utf-8');
        const plugkit = findPlugkit();
        const opts = { encoding: 'utf-8', timeout: 120000, ...(cwd && { cwd }) };
        const r = spawnSync(plugkit, ['exec', '--lang', 'browser', '--file', tmp], opts);
        const out = (r.stdout || '').trimEnd();
        const err = (r.stderr || '').trimEnd();
        return out && err ? out + '\n[stderr]\n' + err : out || err || '(no output)';
      } finally {
        try { fsSync.unlinkSync(tmp); } catch (_) {}
      }
    }
  }
};
