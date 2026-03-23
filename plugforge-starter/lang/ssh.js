'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

function loadTarget(targetName) {
  const cfgPath = path.join(os.homedir(), '.claude', 'ssh-targets.json');
  if (!fs.existsSync(cfgPath)) throw new Error('No ssh-targets.json found at ' + cfgPath);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const name = targetName || 'default';
  if (!cfg[name]) throw new Error('No target \'' + name + '\' in ssh-targets.json. Available: ' + Object.keys(cfg).join(', '));
  return cfg[name];
}

function parseCommand(code) {
  const lines = code.trim().split('\n');
  let target = 'default';
  let cmd = code.trim();
  if (lines[0].trim().startsWith('@')) {
    target = lines[0].trim().slice(1);
    cmd = lines.slice(1).join('\n').trim();
  }
  return { target, cmd };
}

function resolveSsh2() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'gm-tools', 'node_modules', 'ssh2'),
    path.join(os.homedir(), '.claude', 'plugins', 'node_modules', 'ssh2'),
    'ssh2',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (_) {}
  }
  throw new Error('ssh2 not found. Run: npm install ssh2 in ~/.claude/gm-tools or ~/.claude/plugins');
}

function runSsh(target, cmd) {
  return new Promise((resolve, reject) => {
    const { Client } = resolveSsh2();
    const ssh = new Client();
    let out = '';
    let done = false;
    const finish = () => { if (!done) { done = true; ssh.end(); resolve(out.trimEnd()); } };
    const timeout = setTimeout(() => {
      if (!done) { done = true; try { ssh.end(); } catch (_) {} resolve(out.trimEnd() || '[timeout after 28s]'); }
    }, 28000);
    ssh.on('ready', () => {
      ssh.exec(cmd, { pty: false }, (err, stream) => {
        if (err) { clearTimeout(timeout); ssh.end(); reject(err); return; }
        stream.on('data', d => { out += d.toString(); });
        stream.stderr.on('data', d => { out += d.toString(); });
        stream.on('close', () => { clearTimeout(timeout); finish(); });
      });
    });
    ssh.on('error', err => { clearTimeout(timeout); if (!done) { done = true; reject(err); } });
    const connOpts = { host: target.host, port: target.port || 22, username: target.username, readyTimeout: 15000 };
    if (target.password) connOpts.password = target.password;
    if (target.keyPath) connOpts.privateKey = fs.readFileSync(target.keyPath);
    if (target.passphrase) connOpts.passphrase = target.passphrase;
    ssh.connect(connOpts);
  });
}

module.exports = {
  id: 'ssh',
  exec: {
    match: /^exec:ssh/,
    async run(code) {
      const { target: targetName, cmd } = parseCommand(code);
      if (!cmd) return '[no command provided]';
      const target = loadTarget(targetName);
      return await runSsh(target, cmd);
    }
  },
  context: `=== exec:ssh ===
exec:ssh
[@target]
<shell command>

Runs shell command on remote SSH host. Target config from ~/.claude/ssh-targets.json ("default" used if no @name given). Supports multi-line scripts. Password or private key auth. Returns combined stdout+stderr.`
};
