import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commitExists, SHA } from './git.mjs';

export const ROW_DIR = 'work/rows';
const KINDS = { prd: 'work item', unknown: 'open question' };
const STATUSES = ['open', 'resolved', 'all'];
const FIELDS = ['id', 'kind', 'title', 'body', 'status', 'createdAt', 'witnessEvent', 'witnessCommit', 'resolvedAt'];
const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const ROW_TOOLS = Object.entries(KINDS).flatMap(([kind, label]) => [
  { name: `${kind}_add`, description: `Add a ${label} row, one file under ${ROW_DIR}. Returns its id.`, inputSchema: obj({ title: str, body: str }, ['title']) },
  { name: `${kind}_list`, description: `List ${label} rows, one line each: id, status, title. status is open (default), resolved or all.`, inputSchema: obj({ status: str }) },
  {
    name: `${kind}_resolve`,
    description: `Resolve a ${label} row. The witness is a seq of this run's log and a commit that exists in this repository.`,
    inputSchema: obj({ id: str, event: { type: 'number' }, commit: str }, ['id', 'event', 'commit']),
  },
]);

export function createRowVerbs({ root, confine, log }) {
  const handlers = {};
  for (const kind of Object.keys(KINDS)) {
    handlers[`${kind}_add`] = ({ title, body = '' }) => addRow(kind, title, body);
    handlers[`${kind}_list`] = ({ status = 'open' }) => listRows(kind, status);
    handlers[`${kind}_resolve`] = (args) => resolveRow(kind, args);
  }
  return handlers;

  async function addRow(kind, title, body) {
    if (typeof title !== 'string' || title.trim() === '') return fail('title must be a non-empty string');
    if (typeof body !== 'string') return fail('body must be a string');
    const row = { id: newId(kind), kind, title: title.trim(), body, status: 'open', createdAt: new Date().toISOString() };
    await writeRow(row);
    return { ok: true, output: row.id };
  }

  async function listRows(kind, status) {
    if (!STATUSES.includes(status)) return fail(`status must be one of ${STATUSES.join(', ')}`);
    const rows = (await readRows()).filter((row) => row.kind === kind && (status === 'all' || row.status === status));
    rows.sort((a, b) => compareText(String(a.createdAt), String(b.createdAt)) || compareText(a.id, b.id));
    return { ok: true, output: rows.length ? rows.map((row) => `${row.id} ${row.status} ${row.title}`).join('\n') : '(none)' };
  }

  async function resolveRow(kind, { id, event, commit }) {
    if (typeof id !== 'string' || !new RegExp(`^${kind}-[a-z0-9]+$`).test(id)) return fail(`id must name a ${kind} row, with an id that starts ${kind}-`);
    if (!Number.isInteger(event) || event < 1) return fail('event must be a log seq number');
    if (!log.events().some((entry) => entry.seq === event)) return fail(`event ${event} is not in this run's log`);
    if (typeof commit !== 'string' || !SHA.test(commit)) return fail('commit must be 7 to 40 lowercase hex digits');
    if (!(await commitExists(root, commit))) return fail(`no commit ${commit} in this repository`);
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.status === 'resolved') return fail(`row ${id} is already resolved`);
    Object.assign(row, { status: 'resolved', witnessEvent: event, witnessCommit: commit, resolvedAt: new Date().toISOString() });
    await writeRow(row);
    return { ok: true, output: `${id} resolved by event ${event} at commit ${commit}` };
  }

  async function readRows() {
    const dir = confine(ROW_DIR);
    if (dir.refused) throw new Error(dir.refused);
    let names;
    try {
      names = await readdir(dir.path);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const files = names.filter((name) => name.endsWith('.yml'));
    return Promise.all(files.map(async (name) => parseRow(await readFile(join(dir.path, name), 'utf8'))));
  }

  async function readRow(id) {
    const at = confine(`${ROW_DIR}/${id}.yml`);
    if (at.refused) throw new Error(at.refused);
    try {
      return parseRow(await readFile(at.path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function writeRow(row) {
    const at = confine(`${ROW_DIR}/${row.id}.yml`);
    if (at.refused) throw new Error(at.refused);
    await mkdir(dirname(at.path), { recursive: true });
    const temp = `${at.path}.${process.pid}.tmp`;
    await writeFile(temp, renderRow(row));
    await rename(temp, at.path);
  }
}

function newId(kind) {
  return `${kind}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

// Each value is written as JSON, which is also a valid YAML scalar, so a row file is readable YAML.
function renderRow(row) {
  const lines = FIELDS.filter((field) => row[field] !== undefined).map((field) => `${field}: ${JSON.stringify(row[field])}`);
  return `${lines.join('\n')}\n`;
}

function parseRow(source) {
  const row = {};
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z]+): (.*)$/.exec(line);
    if (match) row[match[1]] = parseScalar(match[2]);
  }
  return row;
}

function parseScalar(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Code-point order, so the list order does not depend on the host's locale.
function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function fail(error) {
  return { ok: false, error };
}
