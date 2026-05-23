const fs = require('fs');
const path = require('path');
const os = require('os');
const spool = require('./spool.js');

const CODEINSIGHT_HOST = '127.0.0.1';
const CODEINSIGHT_PORT = 4802;
const REQUEST_TIMEOUT_MS = 30000;

function emitEvent(severity, message, details = {}) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(os.homedir(), '.claude', 'gm-log', date);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const entry = { ts: new Date().toISOString(), severity, message, ...details };
    fs.appendFileSync(path.join(logDir, 'codeinsight.jsonl'), JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[codeinsight] emit failed: ${e.message}`);
  }
}

async function checkSocketReachable(host = CODEINSIGHT_HOST, port = CODEINSIGHT_PORT, timeoutMs = 1000) {
  try {
    const result = await spool.execSpool('health', 'health', { timeoutMs });
    return !!(result && result.ok);
  } catch (e) {
    return false;
  }
}

async function sendRequest(request, sessionId = 'unknown') {
  const startTime = Date.now();
  const reachable = await checkSocketReachable();

  if (!reachable) {
    emitEvent('warn', 'Codeinsight socket unreachable', {
      host: CODEINSIGHT_HOST,
      port: CODEINSIGHT_PORT,
      sessionId,
      durationMs: Date.now() - startTime,
    });
    return { ok: false, error: `Codeinsight daemon unavailable at ${CODEINSIGHT_HOST}:${CODEINSIGHT_PORT}`, durationMs: Date.now() - startTime };
  }

  try {
    if (request.action === 'search') {
      const q = request.discipline && request.discipline !== 'default' ? `@${request.discipline} ${request.query}` : request.query;
      const result = await spool.execCodesearch(q, { timeoutMs: REQUEST_TIMEOUT_MS, sessionId });
      if (!result.ok) return { ok: false, error: result.stderr || result.stdout || 'codesearch failed', durationMs: Date.now() - startTime };
      return { ok: true, raw: result.stdout || '', durationMs: Date.now() - startTime };
    }
    return { ok: false, error: `Unsupported action via spool: ${request.action}`, durationMs: Date.now() - startTime };
  } catch (err) {
    return { ok: false, error: err.message, durationMs: Date.now() - startTime };
  }
}

async function searchCode(query, discipline = 'default', sessionId = 'unknown') {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { ok: false, error: 'Query must be a non-empty string' };
  }
  const result = await sendRequest({ action: 'search', query: query.trim(), discipline, sessionId }, sessionId);
  if (result.ok) {
    emitEvent('info', 'Search completed', { query: query.trim(), discipline, resultCount: (result.results || []).length, sessionId, durationMs: result.durationMs });
  }
  return result;
}

async function indexProject(projectPath, discipline = 'default', sessionId = 'unknown') {
  if (!projectPath || typeof projectPath !== 'string') {
    return { ok: false, error: 'Project path must be a non-empty string' };
  }
  if (!fs.existsSync(projectPath)) {
    emitEvent('warn', 'Project path does not exist', { projectPath, discipline, sessionId });
    return { ok: false, error: `Project path does not exist: ${projectPath}` };
  }
  const result = await sendRequest({ action: 'index', projectPath: path.resolve(projectPath), discipline, sessionId }, sessionId);
  if (result.ok) {
    emitEvent('info', 'Index completed', { projectPath: path.resolve(projectPath), discipline, filesIndexed: result.filesIndexed, sessionId, durationMs: result.durationMs });
  }
  return result;
}

async function getDiagnostics(projectPath = null, discipline = 'default', sessionId = 'unknown') {
  if (projectPath && !fs.existsSync(projectPath)) {
    return { ok: false, error: `Project path does not exist: ${projectPath}` };
  }
  const result = await sendRequest({ action: 'diagnostics', projectPath: projectPath ? path.resolve(projectPath) : null, discipline, sessionId }, sessionId);
  if (result.ok) {
    emitEvent('info', 'Diagnostics retrieved', { projectPath: projectPath ? path.resolve(projectPath) : 'system-wide', discipline, diagnosticCount: (result.diagnostics || []).length, sessionId, durationMs: result.durationMs });
  }
  return result;
}

async function getIndexStatus(discipline = 'default', sessionId = 'unknown') {
  const result = await sendRequest({ action: 'status', discipline, sessionId }, sessionId);
  if (result.ok) {
    emitEvent('info', 'Index status retrieved', { discipline, indexed: result.indexed, sessionId, durationMs: result.durationMs });
  }
  return result;
}

module.exports = {
  searchCode,
  indexProject,
  getDiagnostics,
  getIndexStatus,
  checkSocketReachable,
};
