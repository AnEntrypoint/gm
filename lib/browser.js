const fs = require('fs');
const path = require('path');
const os = require('os');
const spool = require('./spool.js');

const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');
const SESSION_STATE_DIR = path.join(os.homedir(), '.gm', 'browser-sessions');

function emitBrowserEvent(severity, message, details) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_DIR, date);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'browser.jsonl'), JSON.stringify({ ts: new Date().toISOString(), severity, message, ...details }) + '\n');
  } catch (e) {
    console.error(`[browser] Failed to emit event: ${e.message}`);
  }
}

function loadSessionState(sessionId) {
  try {
    fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });
    const stateFile = path.join(SESSION_STATE_DIR, `${sessionId}.json`);
    if (fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    emitBrowserEvent('warn', 'Failed to load session state', { sessionId, error: e.message });
  }
  return { sessionId, createdAt: new Date().toISOString(), commands: [] };
}

function saveSessionState(sessionId, state) {
  try {
    fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSION_STATE_DIR, `${sessionId}.json`), JSON.stringify(state, null, 2));
  } catch (e) {
    emitBrowserEvent('warn', 'Failed to save session state', { sessionId, error: e.message });
  }
}

function parseJsonFromStdout(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch (e) {}
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

async function runBrowserVerb(action, args, sessionId, timeoutMs = 30000) {
  const payload = args && Object.keys(args).length > 0 ? `${action}\n${JSON.stringify(args)}` : action;
  const result = await spool.execSpool(payload, 'browser', { timeoutMs, sessionId });
  if (!result.ok) throw new Error(result.stderr || result.stdout || `browser verb failed: ${action}`);
  const parsed = parseJsonFromStdout(result.stdout);
  return parsed || { ok: true };
}

async function isBrowserAvailable(sessionId = process.env.CLAUDE_SESSION_ID || 'unknown') {
  try {
    const result = await spool.execSpool('health', 'health', { timeoutMs: 1000, sessionId });
    return !!(result && result.ok);
  } catch (e) {
    return false;
  }
}

async function createSession(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  const result = await runBrowserVerb('start', {}, sessionId, 30000);
  const state = loadSessionState(sessionId);
  state.browserSessionId = result.browserSessionId || result.sessionId || sessionId;
  state.status = 'active';
  state.createdAt = new Date().toISOString();
  saveSessionState(sessionId, state);
  return { ok: true, sessionId, browserSessionId: state.browserSessionId };
}

async function sendCommand(sessionId, commandType, args) {
  if (!sessionId) throw new Error('sessionId is required');
  const result = await runBrowserVerb(commandType, args || {}, sessionId, 30000);
  const state = loadSessionState(sessionId);
  state.commands = state.commands || [];
  state.commands.push({ type: commandType, args: args || {}, timestamp: new Date().toISOString() });
  if (state.commands.length > 1000) state.commands = state.commands.slice(-500);
  saveSessionState(sessionId, state);
  return { ok: true, result: result.result || result.data || result };
}

async function executeScript(sessionId, code, options = {}) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!code || typeof code !== 'string') throw new Error('code must be a non-empty string');
  const payload = { code, ...options };
  return sendCommand(sessionId, 'execute', payload);
}

async function getScreenshot(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  const result = await runBrowserVerb('screenshot', {}, sessionId, 30000);
  let screenshotData = result.screenshot || result.data || '';
  if (screenshotData && !screenshotData.startsWith('data:image')) screenshotData = `data:image/png;base64,${screenshotData}`;
  return { ok: true, screenshot: screenshotData, mimeType: 'image/png' };
}

async function closeSession(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  try { await runBrowserVerb('stop', {}, sessionId, 10000); } catch (e) {}
  const stateFile = path.join(SESSION_STATE_DIR, `${sessionId}.json`);
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  return { ok: true, sessionId };
}

async function closeAllSessions(excludeSessionId = null) {
  if (!fs.existsSync(SESSION_STATE_DIR)) return { ok: true, closed: 0 };
  const files = fs.readdirSync(SESSION_STATE_DIR);
  let closed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const sessionId = file.replace('.json', '');
    if (excludeSessionId && sessionId === excludeSessionId) continue;
    try { await closeSession(sessionId); closed++; } catch (e) {}
  }
  return { ok: true, closed };
}

module.exports = { createSession, sendCommand, executeScript, getScreenshot, closeSession, closeAllSessions, isBrowserAvailable, loadSessionState, saveSessionState };
