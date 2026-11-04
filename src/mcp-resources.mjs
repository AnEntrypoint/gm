import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { flushAllLogs, readEvents } from './log.mjs';

export const RESOURCE_TEMPLATES = [
  { uriTemplate: 'skill://{name}/SKILL.md', name: 'skill-md', title: 'Served skill', description: 'The SKILL.md of a served skill: its frontmatter and its prompt text.', mimeType: 'text/markdown' },
  { uriTemplate: 'skill://{name}/{path}', name: 'skill-file', title: 'Served skill file', description: 'Any other file of a served skill, by its path under the skill directory.' },
  { uriTemplate: 'run://{run}/log', name: 'run-log', title: 'Run event log', description: "A run's event log, one JSON event per line: its newest 64 KB, cut at a line boundary.", mimeType: 'application/x-ndjson' },
  { uriTemplate: 'run://{run}/witness', name: 'run-witness', title: 'Run witness', description: 'The witness a run finished with. It is listed once the run has ended.', mimeType: 'text/plain' },
];

export const LOG_META = 'com.anentrypoint.gmnew/log';
const LOG_TAIL_BYTES = 65536;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RUN_URI = /^run:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)\/(log|witness)$/;
const COMPLETION_CAP = 100;
const WATCH_DEBOUNCE_MS = 150;

export function runResources(runsRoot, runId, witness) {
  const file = join(runsRoot, runId, 'log.jsonl');
  const lastModified = mtimeOf(file);
  const resources = [{ uri: `run://${runId}/log`, name: `${runId} log`, title: 'Run event log', mimeType: 'application/x-ndjson', annotations: { audience: ['assistant'], priority: 0.5, lastModified } }];
  if (witness !== null) resources.push({ uri: `run://${runId}/witness`, name: `${runId} witness`, title: 'Run witness', mimeType: 'text/plain', annotations: { audience: ['user', 'assistant'], priority: 0.8, lastModified } });
  return resources;
}

export function witnessOf(runsRoot, runId) {
  const file = join(runsRoot, runId, 'log.jsonl');
  if (!existsSync(file)) return null;
  flushAllLogs();
  const end = readEvents(file).findLast((event) => event.kind === 'end');
  return typeof end?.witness === 'string' ? end.witness : null;
}

export function readRun(runsRoot, uri) {
  const match = typeof uri === 'string' ? RUN_URI.exec(uri) : null;
  if (match === null) return null;
  const [, runId, part] = match;
  if (!existsSync(join(runsRoot, runId, 'log.jsonl'))) return null;
  if (part === 'witness') {
    const witness = witnessOf(runsRoot, runId);
    return witness === null ? null : { uri, mimeType: 'text/plain', text: witness };
  }
  flushAllLogs();
  const { text, size, fromByte } = tailOf(join(runsRoot, runId, 'log.jsonl'), LOG_TAIL_BYTES);
  return { uri, mimeType: 'application/x-ndjson', text, _meta: { [LOG_META]: { totalBytes: size, fromByte, truncated: fromByte > 0 } } };
}

export function runIds(runsRoot) {
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name) && existsSync(join(runsRoot, entry.name, 'log.jsonl')))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export function completionOf(params, { skills, filesOf, runsRoot }) {
  const candidates = candidatesOf(params?.ref?.uri, params?.argument?.name, params?.context?.arguments, { skills, filesOf, runsRoot });
  const prefix = String(params?.argument?.value ?? '');
  const matching = candidates.filter((value) => value.startsWith(prefix));
  const values = matching.slice(0, COMPLETION_CAP);
  return { completion: { values, total: matching.length, hasMore: matching.length > values.length } };
}

function candidatesOf(uri, argument, context, { skills, filesOf, runsRoot }) {
  if (uri === 'skill://{name}/SKILL.md' || uri === 'skill://{name}/{path}') {
    if (argument === 'name') return skills;
    return argument === 'path' && skills.includes(context?.name) ? filesOf(context.name) : [];
  }
  if (uri === 'run://{run}/log' || uri === 'run://{run}/witness') return argument === 'run' ? runIds(runsRoot) : [];
  return [];
}

export function createSubscriptions({ dirs, digestOf, changed }) {
  const digests = new Map();
  let watchers = [];
  let timer = null;
  const check = () => {
    timer = null;
    for (const [uri, seen] of digests) {
      const now = digestOf(uri);
      if (now === seen) continue;
      digests.set(uri, now);
      changed(uri);
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, WATCH_DEBOUNCE_MS);
    timer.unref();
  };
  const open = () => {
    watchers = dirs.filter((dir) => existsSync(dir)).map((dir) => {
      const watcher = watch(dir, { recursive: true }, schedule);
      watcher.on('error', schedule);
      watcher.unref();
      return watcher;
    });
  };
  const close = () => {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    clearTimeout(timer);
    timer = null;
  };
  return {
    subscribe(uri, digest) {
      if (digests.size === 0) open();
      digests.set(uri, digest);
    },
    unsubscribe(uri) {
      digests.delete(uri);
      if (digests.size === 0) close();
    },
  };
}

function tailOf(file, bytes) {
  const size = statSync(file).size;
  const at = Math.max(0, size - bytes);
  const buffer = Buffer.alloc(size - at);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, at);
  } finally {
    closeSync(fd);
  }
  const newline = buffer.indexOf(10);
  const start = at === 0 ? 0 : newline === -1 ? buffer.length : newline + 1;
  return { text: buffer.subarray(start).toString('utf8'), size, fromByte: at + start };
}

function mtimeOf(file) {
  return existsSync(file) ? statSync(file).mtime.toISOString() : undefined;
}
