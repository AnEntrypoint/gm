// Transient-failure retry for the network tools: fetch, git_fetch, git_push and ci_status. A transient failure (a timeout,
// a reset or refused connection, the remote hanging up, HTTP 408, 429 or 5xx) is retried three times, with backoff from
// 1 s doubling to a 16 s cap and plus or minus 20% jitter. A permanent failure fails at once. Each retry is a retry event.
const RETRIES = 3;
const BASE_MS = 1000;
const CAP_MS = 16000;
const JITTER = 0.2;

// The error codes a retry can fix. fetch reports the code of a failed call (err.cause.code), and that code decides the class. A
// message never does, so a host name in one cannot decide it.
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

// git and gh print no error code, so their message is matched for the words they print a transient failure with. Each URL and
// each dotted host name is removed from the message first, so a host name in it never decides the class.
const TRANSIENT_TEXT = [
  [/connection refused|econnrefused/i, 'ECONNREFUSED'],
  [/failed to connect|error connecting to/i, 'connect'],
  [/connection reset|econnreset|reset by peer|und_err_socket/i, 'ECONNRESET'],
  [/timed out|timeout|etimedout|aborterror|aborted/i, 'ETIMEDOUT'],
  [/hung up unexpectedly|remote end hung up|socket hang up/i, 'hung-up'],
  [/temporary failure in name resolution/i, 'EAI_AGAIN'],
  [/(?:HTTP|returned error:?|status code)\s*(408|429|5\d\d)\b/i, 'HTTP'],
];
const URL_TEXT = /[a-z][a-z0-9+.-]*:\/\/\S*/gi;
const HOST_TEXT = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;

export async function retrying({ tool, log, attempt }) {
  for (let n = 1; ; n += 1) {
    const { result, errorType } = await attempt();
    if (errorType === null) return { ...result, attempts: n };
    if (n > RETRIES) return { ...result, attempts: n, exhausted: true };
    const delayMs = backoffMs(n);
    log.append('retry', { tool, attempt: n, errorType, delayMs });
    await sleep(delayMs);
  }
}

export function codeType(code) {
  return TRANSIENT_CODES.has(code) ? code : null;
}

export function statusType(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599) ? `HTTP-${status}` : null;
}

export function errorTypeOf(result) {
  if (result.ok) return null;
  return transientText(`${result.error ?? ''}\n${result.output ?? ''}`);
}

export function backoffMs(attempt) {
  const base = Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS);
  return Math.round(base * (1 + JITTER * (2 * Math.random() - 1)));
}

function transientText(text) {
  const message = text.replace(URL_TEXT, ' ').replace(HOST_TEXT, ' ');
  for (const [pattern, type] of TRANSIENT_TEXT) {
    const match = pattern.exec(message);
    if (match) return type === 'HTTP' ? `HTTP-${match[1]}` : type;
  }
  return null;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
