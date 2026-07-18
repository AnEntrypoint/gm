import fs from 'fs';
import path from 'path';

function makeTaskManager({ spawn, spawnSync, logEvent }) {
  const __tasks = new Map();

  function tasksDir(cwd) {
    const d = path.join(cwd || process.cwd(), '.gm', 'exec-spool', 'tasks');
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    return d;
  }

  function taskMetaPath(cwd, id) { return path.join(tasksDir(cwd), `${id}.json`); }
  function taskOutPath(cwd, id, which) { return path.join(tasksDir(cwd), `${id}.${which}.log`); }

  function writeTaskMeta(cwd, id, meta) {
    try { fs.writeFileSync(taskMetaPath(cwd, id), JSON.stringify(meta, null, 2)); } catch (_) {}
  }

  function nextTaskId(cwd) {
    const counterPath = path.join(tasksDir(cwd), '.counter');
    let n = 0;
    try { n = parseInt(fs.readFileSync(counterPath, 'utf-8'), 10) || 0; } catch (_) {}
    n += 1;
    try { fs.writeFileSync(counterPath, String(n)); } catch (_) {}
    return `t${n}`;
  }

  let _jsRuntimeCmd = null;
  function resolveJsRuntimeCmd() {
    if (_jsRuntimeCmd) return _jsRuntimeCmd;
    if (!/(^|[\\/])node(\.exe)?$/i.test(String(process.execPath || ''))) {
      _jsRuntimeCmd = process.execPath;
      return _jsRuntimeCmd;
    }
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const out = spawnSync(which, ['bun'], { encoding: 'utf-8', windowsHide: true });
      const first = (out && out.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) { _jsRuntimeCmd = first; return _jsRuntimeCmd; }
    } catch (_) {}
    _jsRuntimeCmd = process.execPath;
    return _jsRuntimeCmd;
  }

  function langToCmd(lang, code) {
    if (lang === 'nodejs' || lang === 'js' || lang === 'javascript' || lang === 'node') return { cmd: resolveJsRuntimeCmd(), args: ['-e', code], stdinCode: null };
    if (lang === 'python' || lang === 'py') return { cmd: 'python', args: ['-c', code], stdinCode: null };
    if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') return { cmd: 'bash', args: ['-c', code], stdinCode: null };
    if (lang === 'powershell' || lang === 'ps1') return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', code], stdinCode: null };
    if (lang === 'deno') return { cmd: 'deno', args: ['eval', code], stdinCode: null };
    return null;
  }

  const TASK_MAX_TIMEOUT_MS = 10 * 60 * 1000;

  function spawnTask({ cwd, lang, code, timeoutMs }) {
    const id = nextTaskId(cwd);
    const built = langToCmd(lang, code);
    if (!built) return { ok: false, error: `unsupported lang: ${lang}` };
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TASK_MAX_TIMEOUT_MS) {
      timeoutMs = TASK_MAX_TIMEOUT_MS;
    }
    const outLog = taskOutPath(cwd, id, 'stdout');
    const errLog = taskOutPath(cwd, id, 'stderr');
    let outFd = null, errFd = null;
    try { outFd = fs.openSync(outLog, 'a'); } catch (_) {}
    try { errFd = fs.openSync(errLog, 'a'); } catch (_) {}
    const startedMs = Date.now();
    const isPosix = process.platform !== 'win32';
    const child = spawn(built.cmd, built.args, {
      cwd: cwd || process.cwd(),
      detached: isPosix,
      stdio: ['ignore', outFd || 'ignore', errFd || 'ignore'],
      windowsHide: true,
      env: process.env,
    });
    try { if (outFd !== null) fs.closeSync(outFd); } catch (_) {}
    try { if (errFd !== null) fs.closeSync(errFd); } catch (_) {}
    const meta = {
      id,
      pid: child.pid,
      pgid: isPosix ? child.pid : null,
      lang,
      cmd: built.cmd,
      cwd: cwd || process.cwd(),
      started_ms: startedMs,
      timeout_ms: timeoutMs,
      deadline_ms: startedMs + timeoutMs,
      status: 'running',
      exit_code: null,
      stdout_log: outLog,
      stderr_log: errLog,
    };
    __tasks.set(id, { child, meta });
    writeTaskMeta(cwd, id, meta);
    child.on('exit', (code, signal) => {
      meta.status = signal ? 'killed' : (code === 0 ? 'completed' : 'failed');
      meta.exit_code = code;
      meta.signal = signal;
      meta.ended_ms = Date.now();
      writeTaskMeta(meta.cwd, id, meta);
    });
    child.on('error', (err) => {
      meta.status = 'error';
      meta.error = err.message;
      meta.ended_ms = Date.now();
      writeTaskMeta(meta.cwd, id, meta);
    });
    logEvent('plugkit', 'task.spawn', { task_id: id, pid: child.pid, lang, timeout_ms: timeoutMs });
    return { ok: true, task_id: id, pid: child.pid, started_ms: startedMs };
  }

  function stopTaskById(id) {
    const entry = __tasks.get(id);
    if (!entry) {
      return { ok: false, error: 'unknown task_id', task_id: id };
    }
    const { child, meta } = entry;
    if (meta.status !== 'running') return { ok: true, already: meta.status, task_id: id };
    const pid = meta.pid;
    const isPosix = process.platform !== 'win32';
    try {
      if (isPosix && meta.pgid) {
        try { process.kill(-meta.pgid, 'SIGTERM'); } catch (_) {}
      } else {
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    } catch (_) {}
    const graceTimer = setTimeout(() => {
      if (meta.status !== 'running') return;
      if (isPosix && meta.pgid) {
        try { process.kill(-meta.pgid, 'SIGKILL'); } catch (_) {}
      } else if (process.platform === 'win32') {
        try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
      } else {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }, 2000);
    graceTimer.unref && graceTimer.unref();
    logEvent('plugkit', 'task.stop', { task_id: id, pid });
    return { ok: true, task_id: id, pid };
  }

  function tailFile(filePath, maxBytes) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf-8');
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
        return buf.toString('utf-8');
      } finally { try { fs.closeSync(fd); } catch (_) {} }
    } catch (_) { return ''; }
  }

  function listTasks(cwd) {
    const d = tasksDir(cwd);
    const out = [];
    try {
      for (const entry of fs.readdirSync(d)) {
        if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(d, entry), 'utf-8'));
          out.push(meta);
        } catch (_) {}
      }
    } catch (_) {}
    return out;
  }

  function reapTimedOutTasks() {
    const now = Date.now();
    for (const [id, entry] of __tasks) {
      const m = entry.meta;
      if (m.status === 'running' && m.deadline_ms && now > m.deadline_ms) {
        logEvent('plugkit', 'task.timeout', { task_id: id, pid: m.pid, deadline_ms: m.deadline_ms, now_ms: now });
        stopTaskById(id);
      }
    }
  }

  function killAllTasks(reason) {
    let killed = 0;
    for (const [id, entry] of __tasks) {
      if (entry.meta.status === 'running') {
        stopTaskById(id);
        killed += 1;
      }
    }
    if (killed > 0) logEvent('plugkit', 'task.killAll', { reason, count: killed });
    return killed;
  }

  function pidAliveLocal(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
  }

  function sweepOrphanedTaskMetaOnBoot(cwd) {
    let swept = 0;
    try {
      const dir = tasksDir(cwd);
      const now = Date.now();
      for (const name of fs.readdirSync(dir)) {
        if (!/^t\d+\.json$/.test(name)) continue;
        const metaPath = path.join(dir, name);
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (_) { continue; }
        if (!meta || meta.status !== 'running') continue;
        const stale = !pidAliveLocal(meta.pid) || (meta.deadline_ms && now > meta.deadline_ms);
        if (!stale) continue;
        if (pidAliveLocal(meta.pid)) {
          try {
            if (process.platform === 'win32') {
              spawnSync('taskkill', ['/F', '/T', '/PID', String(meta.pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 });
            } else {
              try { process.kill(-meta.pid, 'SIGKILL'); } catch (_) { try { process.kill(meta.pid, 'SIGKILL'); } catch (_) {} }
            }
          } catch (_) {}
        }
        meta.status = 'reaped-on-boot';
        meta.ended_ms = now;
        try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); } catch (_) {}
        swept += 1;
      }
    } catch (_) {}
    if (swept > 0) logEvent('plugkit', 'task.bootSweepReaped', { cwd: cwd || process.cwd(), count: swept });
    return swept;
  }

  function hostTaskProc(action, params) {
    switch (action) {
      case 'spawn': return spawnTask(params);
      case 'stop': return stopTaskById(params.id || params.task_id);
      case 'list': return { ok: true, tasks: listTasks(params.cwd) };
      case 'output': return {
        ok: true,
        task_id: params.id || params.task_id,
        stdout: tailFile(taskOutPath(params.cwd, params.id || params.task_id, 'stdout'), params.max_bytes || 65536),
        stderr: tailFile(taskOutPath(params.cwd, params.id || params.task_id, 'stderr'), params.max_bytes || 65536),
      };
      case 'reap': { reapTimedOutTasks(); return { ok: true }; }
      case 'killAll': { const n = killAllTasks(params.reason || 'host_task_proc'); return { ok: true, killed: n }; }
      default: return { ok: false, error: `unknown action: ${action}` };
    }
  }

  return {
    __tasks,
    tasksDir,
    taskMetaPath,
    taskOutPath,
    writeTaskMeta,
    nextTaskId,
    resolveJsRuntimeCmd,
    langToCmd,
    TASK_MAX_TIMEOUT_MS,
    spawnTask,
    stopTaskById,
    tailFile,
    listTasks,
    reapTimedOutTasks,
    killAllTasks,
    pidAliveLocal,
    sweepOrphanedTaskMetaOnBoot,
    hostTaskProc,
  };
}

export { makeTaskManager };
