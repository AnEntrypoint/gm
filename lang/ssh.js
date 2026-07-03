'use strict';
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const http = require('http');

function loadTarget(targetName) {
  const candidatesCfg = [
    path.join(os.homedir(), '.gm-tools', 'ssh-targets.json'),
    path.join(os.homedir(), '.claude', 'ssh-targets.json'),
  ];
  const cfgPath = candidatesCfg.find(p => fsSync.existsSync(p));
  if (!cfgPath) throw new Error('No ssh-targets.json found at ' + candidatesCfg.join(' or '));
  if (process.platform !== 'win32') {
    try {
      const mode = fsSync.statSync(cfgPath).mode & 0o777;
      if (mode !== 0o600) fsSync.chmodSync(cfgPath, 0o600);
    } catch (_) {}
  }
  const cfg = JSON.parse(fsSync.readFileSync(cfgPath, 'utf8'));
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
    path.join(os.homedir(), '.gm-tools', 'node_modules', 'ssh2'),
    path.join(os.homedir(), '.claude', 'gm-tools', 'node_modules', 'ssh2'),
    path.join(os.homedir(), '.claude', 'plugins', 'node_modules', 'ssh2'),
    'ssh2',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (_) {}
  }
  throw new Error('ssh2 not found. Install into ~/.gm-tools/ with: mkdir -p ~/.gm-tools && cd ~/.gm-tools && npm install ssh2');
}

function getRunnerPort() {
  const portFile = path.join(os.tmpdir(), 'glootie-runner.port');
  try { return parseInt(fsSync.readFileSync(portFile, 'utf8').trim(), 10); } catch { return null; }
}

function rpcCall(port, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params });
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/rpc', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) return reject(new Error(p.error.message || String(p.error)));
            resolve(p.result);
          } catch { reject(new Error('RPC parse error: ' + data)); }
        });
      }
    );
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function runSsh(target, cmd, onData) {
  return new Promise((resolve, reject) => {
    const { Client } = resolveSsh2();
    const ssh = new Client();
    let stdout = '';
    let stderr = '';
    let done = false;

    const finish = (extra) => {
      if (!done) {
        done = true;
        ssh.end();
        resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), timedOut: false, ...extra });
      }
    };

    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        try { ssh.end(); } catch (_) {}
        resolve({ stdout: stdout.trimEnd(), stderr: (stderr + '\n[ssh timed out after 55s; output is partial]').trimEnd(), timedOut: true });
      }
    }, 55000);

    ssh.on('ready', () => {
      ssh.exec(cmd, { pty: false }, (err, stream) => {
        if (err) { clearTimeout(timeout); ssh.end(); reject(err); return; }
        stream.on('data', d => {
          const s = d.toString();
          stdout += s;
          if (onData) onData(s, 'stdout');
        });
        stream.stderr.on('data', d => {
          const s = d.toString();
          stderr += s;
          if (onData) onData(s, 'stderr');
        });
        stream.on('close', () => { clearTimeout(timeout); finish(); });
      });
    });

    ssh.on('error', err => { clearTimeout(timeout); if (!done) { done = true; reject(err); } });

    const connOpts = { host: target.host, port: target.port || 22, username: target.username, readyTimeout: 15000 };
    if (target.password) connOpts.password = target.password;
    if (target.keyPath) connOpts.privateKey = fsSync.readFileSync(target.keyPath);
    if (target.passphrase) connOpts.passphrase = target.passphrase;
    ssh.connect(connOpts);
  });
}

async function runBackground(target, cmd) {
  const port = getRunnerPort();
  if (!port) return null;

  let taskId;
  try {
    const r = await rpcCall(port, 'createTask', { code: '', runtime: 'ssh', workingDirectory: process.cwd() });
    taskId = r?.taskId ?? r;
    await rpcCall(port, 'startTask', { taskId });
  } catch { return null; }

  const onData = (data, type) => {
    rpcCall(port, 'appendOutput', { taskId, type, data }).catch(() => {});
  };

  runSsh(target, cmd, onData).then(r => {
    rpcCall(port, 'completeTask', { taskId, result: { success: !r.timedOut, exitCode: r.timedOut ? 124 : 0, stdout: r.stdout, stderr: r.stderr, error: r.timedOut ? 'ssh timed out after 55s' : null } }).catch(() => {});
  }).catch(err => {
    rpcCall(port, 'completeTask', { taskId, result: { success: false, exitCode: 1, stdout: '', stderr: err.message, error: err.message } }).catch(() => {});
  });

  return taskId;
}

module.exports = {
  id: 'ssh',
  exec: {
    match: /^exec:ssh/,
    async run(code) {
      const { target: targetName, cmd } = parseCommand(code);
      if (!cmd) return '[no command provided]';
      const target = loadTarget(targetName);

      const isBackground = /(&\s*$|^\s*(nohup|systemd-run|setsid)\s)/m.test(cmd);

      if (isBackground) {
        const taskId = await runBackground(target, cmd);
        if (taskId != null) {
          return 'Backgrounded on remote host. Local task_' + taskId + ' streams output.\n\n' +
            '  exec:sleep\n  task_' + taskId + '\n\n' +
            '  exec:status\n  task_' + taskId + '\n\n' +
            '  exec:close\n  task_' + taskId;
        }
      }

      const r = await runSsh(target, cmd, null);
      const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
      return combined || (r.timedOut ? '[ssh timed out after 55s; no output]' : '');
    }
  },
  context: `=== exec:ssh ===
exec:ssh
[@target]
<shell command>

Runs shell command on remote SSH host. Target from ~/.claude/ssh-targets.json ("default" if no @name). Supports multi-line scripts. Password or key auth. Returns combined stdout+stderr. Commands ending with & or using nohup/systemd-run are backgrounded -- use exec:sleep/status/close to follow.`
};
