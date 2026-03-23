'use strict';
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const http = require('http');

function loadTarget(targetName) {
  const cfgPath = path.join(os.homedir(), '.claude', 'ssh-targets.json');
  if (!fsSync.existsSync(cfgPath)) throw new Error('No ssh-targets.json found at ' + cfgPath);
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
    path.join(os.homedir(), '.claude', 'gm-tools', 'node_modules', 'ssh2'),
    path.join(os.homedir(), '.claude', 'plugins', 'node_modules', 'ssh2'),
    'ssh2',
  ];
  for (const p of candidates) {
    try { return require(p); } catch (_) {}
  }
  throw new Error('ssh2 not found. Run: cd ~/.claude/gm-tools && npm install ssh2');
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
    let out = '';
    let done = false;

    const finish = (text) => {
      if (!done) { done = true; ssh.end(); resolve(text != null ? text : out.trimEnd()); }
    };

    const timeout = setTimeout(() => {
      if (!done) { done = true; try { ssh.end(); } catch (_) {} resolve(out.trimEnd() || '[timeout after 55s]'); }
    }, 55000);

    ssh.on('ready', () => {
      ssh.exec(cmd, { pty: false }, (err, stream) => {
        if (err) { clearTimeout(timeout); ssh.end(); reject(err); return; }
        stream.on('data', d => {
          const s = d.toString();
          out += s;
          if (onData) onData(s, 'stdout');
        });
        stream.stderr.on('data', d => {
          const s = d.toString();
          out += s;
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

  runSsh(target, cmd, onData).then(out => {
    rpcCall(port, 'completeTask', { taskId, result: { success: true, exitCode: 0, stdout: out, stderr: '', error: null } }).catch(() => {});
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

      // Detect background-only commands (fire-and-forget: ends with & or uses nohup/systemd-run)
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

      return await runSsh(target, cmd, null);
    }
  },
  context: `=== exec:ssh ===
exec:ssh
[@target]
<shell command>

Runs shell command on remote SSH host. Target from ~/.claude/ssh-targets.json ("default" if no @name). Supports multi-line scripts. Password or key auth. Returns combined stdout+stderr. Commands ending with & or using nohup/systemd-run are backgrounded — use exec:sleep/status/close to follow.`
};
