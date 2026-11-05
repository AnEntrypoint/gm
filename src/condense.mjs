const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const SIGNAL_WORDS = ['error', 'fail', 'warn', 'pass', 'assert', 'panic', 'fatal', 'traceback', 'exception', 'exit code', '##[error]'];
const MIN_LINES = 200;
const MIN_CHARS = 16384;
const MAX_CHARS = 8000;
const HEAD_LINES = 20;
const TAIL_LINES = 20;
const MAX_SIGNALS = 40;

function signal(line) {
  const lower = line.toLowerCase();
  return SIGNAL_WORDS.some((word) => lower.includes(word));
}

export function condenseOutput(text) {
  const originalChars = text.length;
  if (originalChars <= MIN_CHARS && text.split('\n').length <= MIN_LINES) return null;
  const clean = text.replace(ANSI, '');
  const rawLines = clean.split('\n');
  const unique = [];
  let previous = null;
  let repeats = 0;
  const flush = () => {
    if (previous === null) return;
    unique.push(previous);
    if (repeats > 1) unique.push(`[gm: repeated ${repeats} times]`);
    previous = null;
    repeats = 0;
  };
  for (const line of rawLines) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.trim() === '') continue;
    if (trimmed === previous) { repeats += 1; continue; }
    flush();
    previous = trimmed;
    repeats = 1;
  }
  flush();
  const head = unique.slice(0, Math.min(HEAD_LINES, unique.length));
  const tailStart = Math.max(head.length, unique.length - TAIL_LINES);
  const tail = unique.slice(tailStart);
  const middle = unique.slice(head.length, tailStart);
  const signals = middle.filter(signal).slice(0, MAX_SIGNALS);
  const shown = [...head];
  if (middle.length > 0) shown.push('[gm: ...]');
  shown.push(...signals);
  if (middle.length > 0) shown.push('[gm: ...]');
  shown.push(...tail);
  const droppedLines = Math.max(0, rawLines.length - head.length - signals.length - tail.length);
  let output = shown.join('\n');
  if (output.length > MAX_CHARS) output = output.slice(0, MAX_CHARS);
  output += `\n[gm: kept ${head.length + signals.length + tail.length} of ${unique.length} lines; dropped ${droppedLines}; ${originalChars} chars; use raw:true or the job log for the full output]`;
  return { output, compressed: true, originalChars, keptChars: output.length, droppedLines };
}
