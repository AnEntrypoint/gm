const fs = require('fs');
const path = require('path');
const os = require('os');
const spool = require('./spool.js');

const RS_LEARN_HOST = '127.0.0.1';
const RS_LEARN_PORT = 4801;
const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');

let daemonBootstrap = null;
function getDaemonBootstrap() {
  if (!daemonBootstrap) {
    try {
      daemonBootstrap = require('./daemon-bootstrap.js');
    } catch (e) {
      console.error('[learning] Failed to load daemon-bootstrap:', e.message);
      return null;
    }
  }
  return daemonBootstrap;
}

let requestIdCounter = 1000;

function getRequestId() {
  return ++requestIdCounter;
}

function emitLearningEvent(action, severity, message, details = {}) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_DIR, date);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'learning.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      action,
      severity,
      message,
      ...details,
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[learning] Failed to emit event: ${e.message}`);
  }
}

async function ensureDaemonRunning(sessionId = null) {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const bootstrap = getDaemonBootstrap();

  if (!bootstrap) {
    emitLearningEvent('daemon', 'warn', 'daemon-bootstrap not available, skipping spawn', { sessionId: sid });
    return false;
  }

  try {
    const startTime = Date.now();
    const result = await bootstrap.ensureRsLearningDaemonRunning();
    emitLearningEvent('daemon', 'info', 'daemon spawn result', {
      sessionId: sid,
      ok: result.ok,
      already_running: result.already_running,
      durationMs: Date.now() - startTime,
    });
    return result.ok === true;
  } catch (error) {
    emitLearningEvent('daemon', 'warn', 'daemon spawn failed', {
      sessionId: sid,
      error: error.message,
    });
    return false;
  }
}

async function checkLearningAvailable(timeoutMs = 500) {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';
  try {
    const result = await spool.execSpool('health', 'health', { timeoutMs, sessionId });
    const ok = !!(result && result.ok);
    emitLearningEvent('check', ok ? 'info' : 'warn', ok ? 'rs-learn reachable (spool)' : 'rs-learn unavailable (spool)', { sessionId, timeoutMs });
    return ok;
  } catch (e) {
    emitLearningEvent('check', 'warn', 'rs-learn availability check failed (spool)', { sessionId, timeoutMs, error: e.message });
    return false;
  }
}

async function queryLearning(query, discipline = 'default', sessionId = null) {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const startTime = Date.now();

  try {
    emitLearningEvent('query', 'info', `Learning query: ${query}`, { sessionId: sid, query, discipline });

    const available = await checkLearningAvailable();
    if (!available) {
      emitLearningEvent('query', 'warn', 'Learning unavailable', { sessionId: sid, query });
      return null;
    }

    const payload = discipline && discipline !== 'default' ? `@${discipline} ${query}` : query;
    const result = await spool.execRecall(payload, { timeoutMs: 5000, sessionId: sid });
    if (!result.ok) throw new Error(result.stderr || result.stdout || 'recall failed');

    emitLearningEvent('query', 'info', 'Learning query completed', {
      sessionId: sid,
      query,
      discipline,
      hitCount: (result.stdout || '').length > 0 ? 1 : 0,
      durationMs: Date.now() - startTime,
    });

    return result.stdout || '';
  } catch (error) {
    emitLearningEvent('query', 'error', `Learning query failed: ${query}`, {
      sessionId: sid,
      query,
      error: error.message,
      durationMs: Date.now() - startTime,
    });
    return null;
  }
}

async function persistLearning(fact, discipline = 'default', sessionId = null) {
  const sid = sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const startTime = Date.now();

  try {
    emitLearningEvent('persist', 'info', 'Learning persist initiated', { sessionId: sid, discipline, factLength: fact.length });

    const available = await checkLearningAvailable();
    if (!available) {
      emitLearningEvent('persist', 'error', 'Learning unavailable for persist', { sessionId: sid, discipline });
      throw new Error('rs-learn daemon not available');
    }

    const payload = discipline && discipline !== 'default' ? `@${discipline}\n${fact}` : fact;
    const result = await spool.execMemorize(payload, { timeoutMs: 5000, sessionId: sid });
    if (!result.ok) throw new Error(result.stderr || result.stdout || 'memorize failed');

    emitLearningEvent('persist', 'info', 'Learning persist completed', {
      sessionId: sid,
      discipline,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (error) {
    emitLearningEvent('persist', 'error', `Learning persist failed: ${error.message}`, {
      sessionId: sid,
      discipline,
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

module.exports = {
  checkLearningAvailable,
  queryLearning,
  persistLearning,
  ensureDaemonRunning,
  RS_LEARN_HOST,
  RS_LEARN_PORT,
};
