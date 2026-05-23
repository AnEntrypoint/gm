const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createSession,
  sendCommand,
  getScreenshot,
  closeSession,
  isBrowserAvailable,
} = require('./browser');

const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');

function emitHandlerEvent(severity, message, details) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_DIR, date);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'browser-handler.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      severity,
      message,
      ...details,
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[browser-handler] Failed to emit event: ${e.message}`);
  }
}

async function handleBrowserVerb(body, sessionId) {
  const lines = body.trim().split('\n');
  const action = lines[0]?.trim();
  const args = lines.slice(1).join('\n').trim();

  try {
    emitHandlerEvent('info', 'Browser verb dispatched', {
      sessionId,
      action,
      argsLength: args.length,
    });

    const available = await isBrowserAvailable();
    if (!available) {
      throw new Error(
        'Browser API unavailable at 127.0.0.1:5000. Ensure rs-exec is running with browser support enabled.'
      );
    }

    switch (action) {
      case 'start': {
        const result = await createSession(sessionId);
        console.log(JSON.stringify(result));
        return result;
      }

      case 'stop': {
        const result = await closeSession(sessionId);
        console.log(JSON.stringify(result));
        return result;
      }

      case 'screenshot': {
        const result = await getScreenshot(sessionId);
        console.log(JSON.stringify({
          ok: result.ok,
          mimeType: result.mimeType,
          screenshotLength: result.screenshot?.length || 0,
          screenshot: result.screenshot,
        }));
        return result;
      }

      case 'click':
      case 'type':
      case 'navigate':
      case 'execute': {
        let commandArgs = {};
        if (args) {
          try {
            commandArgs = JSON.parse(args);
          } catch (e) {
            commandArgs = { value: args };
          }
        }

        const result = await sendCommand(sessionId, action, commandArgs);
        console.log(JSON.stringify(result));
        return result;
      }

      default: {
        let commandArgs = {};
        if (args) {
          try {
            commandArgs = JSON.parse(args);
          } catch (e) {
            commandArgs = { value: args };
          }
        }
        const result = await sendCommand(sessionId, action, commandArgs);
        console.log(JSON.stringify(result));
        return result;
      }
    }
  } catch (e) {
    emitHandlerEvent('error', 'Browser verb failed', {
      sessionId,
      action,
      error: e.message,
    });

    const errorResponse = {
      ok: false,
      error: e.message,
      action,
      sessionId,
    };

    console.log(JSON.stringify(errorResponse));
    throw e;
  }
}

module.exports = {
  handleBrowserVerb,
};
