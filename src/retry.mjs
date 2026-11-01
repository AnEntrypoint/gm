// Transient-failure retry for the network tools: fetch, git_fetch, git_push and ci_status. A transient failure (a timeout,
// a reset or refused connection, the remote hanging up, HTTP 408, 429 or 5xx) is retried three times, with backoff from
// 1 s doubling to a 16 s cap and plus or minus 20% jitter. A permanent failure fails at once. Each retry is a retry event.
const RETRIES = 3;
const BASE_MS = 1000;
const CAP_MS = 16000;
const JITTER = 0.2;

// Failures that a retry cannot fix. Checked first, so "Connection refused" (transient) is never caught by a word like "refusal".
const PERMANENT = /authentication failed|permission denied|access denied|denied|rejected|non-fast-forward|invalid|could not read username|refusal|refuses to/i;

const TRANSIENT = [
  [/connection refused|econnrefused/i, 'ECONNREFUSED'],
  [/failed to connect|error connecting to/i, 'connect'],
  [/connection reset|econnreset|reset by peer|und_err_socket/i, 'ECONNRESET'],
  [/timed out|timeout|etimedout|aborterror|aborted/i, 'ETIMEDOUT'],
  [/hung up unexpectedly|remote end hung up|socket hang up/i, 'hung-up'],
  [/(?:HTTP|returned error:?|status code)\s*(408|429|5\d\d)\b/i, 'HTTP'],
];

// attempt() returns { result, errorType }. errorType is null when the result is final: a success or a permanent failure.
// A transient failure is retried, with a retry event each time, until RETRIES retries have run. Then the last result is
// returned with exhausted set, so the caller reports the failure.
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

// The errorType of a failed result, from its error and output text, or null when the result is final.
export function errorTypeOf(result) {
  if (result.ok) return null;
  return transientType(`${result.error ?? ''}\n${result.output ?? ''}`);
}

export function backoffMs(attempt) {
  const base = Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS);
  return Math.round(base * (1 + JITTER * (2 * Math.random() - 1)));
}

// The errorType of a transient failure named in a message, or null for a permanent or unknown failure.
export function transientType(text) {
  if (PERMANENT.test(text)) return null;
  for (const [pattern, type] of TRANSIENT) {
    const match = pattern.exec(text);
    if (match) return type === 'HTTP' ? `HTTP-${match[1]}` : type;
  }
  return null;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
