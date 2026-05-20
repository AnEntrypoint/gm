const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');

class DaemonBootstrap {
  constructor() {
    this.daemons = new Map();
    this.socketChecks = new Map();
  }

  getAcptoApiSocket() {
    return '127.0.0.1:4800';
  }

  getLearnSocket() {
    return 'http://127.0.0.1:4801';
  }

  getCodeinsightSocket() {
    return 'http://127.0.0.1:4802';
  }

  getExecSocket() {
    return 'http://127.0.0.1:4803';
  }

  checkSocket(url, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const [host, port] = url.replace('http://', '').split(':');
      const socket = require('net').createConnection({ host, port, timeout: timeoutMs });

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });
    });
  }

  async checkState() {
    const state = {
      acptoapi: await this.checkSocket(this.getAcptoApiSocket()),
      learn: await this.checkSocket(this.getLearnSocket()),
      codeinsight: await this.checkSocket(this.getCodeinsightSocket()),
      exec: await this.checkSocket(this.getExecSocket())
    };

    return state;
  }

  spawnDaemon(name, command, args = [], options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...options
      });

      child.unref();

      this.daemons.set(name, { child, pid: child.pid, startedAt: Date.now() });

      child.stderr.on('data', (data) => {
        const err = data.toString();
        if (err.includes('listening') || err.includes('ready') || err.includes('started')) {
          resolve({ ok: true, pid: child.pid });
        }
      });

      child.stdout.on('data', (data) => {
        const out = data.toString();
        if (out.includes('listening') || out.includes('ready') || out.includes('started')) {
          resolve({ ok: true, pid: child.pid });
        }
      });

      setTimeout(() => {
        resolve({ ok: true, pid: child.pid });
      }, 1000);
    });
  }

  async spawnAcpToApi() {
    try {
      const existing = await this.checkSocket(this.getAcptoApiSocket(), 1000);
      if (existing) {
        return { ok: true, message: 'acptoapi already running' };
      }

      const cmd = process.platform === 'win32' ? 'bun.exe' : 'bun';
      const result = await this.spawnDaemon('acptoapi', cmd, ['x', 'acptoapi@latest']);

      if (!result.ok) {
        return { ok: false, error: 'Failed to spawn acptoapi' };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const ready = await this.checkSocket(this.getAcptoApiSocket(), 3000);

      return { ok: ready, pid: result.pid, message: ready ? 'acptoapi ready' : 'acptoapi spawn timeout' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async spawnLearn() {
    try {
      const existing = await this.checkSocket(this.getLearnSocket(), 1000);
      if (existing) {
        return { ok: true, message: 'rs-learn already running' };
      }

      const dbPath = path.join(process.cwd(), '.gm', 'rs-learn.db');
      const cmd = process.platform === 'win32' ? 'rs-learn.exe' : 'rs-learn';
      const result = await this.spawnDaemon('rs-learn', cmd, ['serve', '--db', dbPath, '--port', '4801']);

      if (!result.ok) {
        return { ok: false, error: 'Failed to spawn rs-learn' };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const ready = await this.checkSocket(this.getLearnSocket(), 3000);

      return { ok: ready, pid: result.pid, message: ready ? 'rs-learn ready' : 'rs-learn spawn timeout' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async spawnCodeinsight() {
    try {
      const existing = await this.checkSocket(this.getCodeinsightSocket(), 1000);
      if (existing) {
        return { ok: true, message: 'rs-codeinsight already running' };
      }

      const indexPath = path.join(process.cwd(), '.gm', 'code-search');
      const cmd = process.platform === 'win32' ? 'rs-codeinsight.exe' : 'rs-codeinsight';
      const result = await this.spawnDaemon('rs-codeinsight', cmd, ['serve', '--index', indexPath, '--port', '4802']);

      if (!result.ok) {
        return { ok: false, error: 'Failed to spawn rs-codeinsight' };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const ready = await this.checkSocket(this.getCodeinsightSocket(), 3000);

      return { ok: ready, pid: result.pid, message: ready ? 'rs-codeinsight ready' : 'rs-codeinsight spawn timeout' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async spawnRsExec() {
    try {
      const existing = await this.checkSocket(this.getExecSocket(), 1000);
      if (existing) {
        return { ok: true, message: 'rs-exec already running' };
      }

      const spoolDir = path.join(process.cwd(), '.gm', 'exec-spool');
      const cmd = process.platform === 'win32' ? 'rs-exec.exe' : 'rs-exec';
      const result = await this.spawnDaemon('rs-exec', cmd, ['daemon', '--spool', spoolDir, '--port', '4803']);

      if (!result.ok) {
        return { ok: false, error: 'Failed to spawn rs-exec' };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const ready = await this.checkSocket(this.getExecSocket(), 3000);

      return { ok: ready, pid: result.pid, message: ready ? 'rs-exec ready' : 'rs-exec spawn timeout' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async waitForReady(name, timeoutMs = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (name === 'acptoapi' && await this.checkSocket(this.getAcptoApiSocket())) {
        return true;
      }
      if (name === 'rs-learn' && await this.checkSocket(this.getLearnSocket())) {
        return true;
      }
      if (name === 'rs-codeinsight' && await this.checkSocket(this.getCodeinsightSocket())) {
        return true;
      }
      if (name === 'rs-exec' && await this.checkSocket(this.getExecSocket())) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  getSocket(name) {
    switch (name) {
      case 'acptoapi':
        return this.getAcptoApiSocket();
      case 'rs-learn':
        return this.getLearnSocket();
      case 'rs-codeinsight':
        return this.getCodeinsightSocket();
      case 'rs-exec':
        return this.getExecSocket();
      default:
        return null;
    }
  }

  shutdown(name) {
    const daemon = this.daemons.get(name);
    if (daemon && daemon.child) {
      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /PID ${daemon.pid} /F`);
        } else {
          process.kill(-daemon.pid);
        }
        this.daemons.delete(name);
      } catch (e) {}
    }
  }

  shutdownAll() {
    for (const name of this.daemons.keys()) {
      this.shutdown(name);
    }
  }
}

module.exports = DaemonBootstrap;
