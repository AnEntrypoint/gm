import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commitExists, SHA } from './git.mjs';
import { resultZone1, resultZone2 } from './compact.mjs';

export const ROW_DIR = 'work/rows';
const KINDS = { prd: 'work item', unknown: 'open question' };
const STATUSES = ['open', 'parked', 'resolved', 'all'];
const STATUS_ALIASES = { pending: 'open', completed: 'resolved' };
const FIELDS = ['id', 'kind', 'title', 'body', 'status', 'createdAt', 'witnessEvent', 'witnessCommit', 'resolvedAt', 'parkReason'];
const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const DELETE_TOOL = {
  name: 'prd_delete',
  description: `Delete a work item (PRD) row that is not resolved: the work is dropped and its file is removed, and git keeps it. An open question is resolved, not deleted.`,
  inputSchema: obj({ id: str }, ['id']),
};

const PARK_TOOL = {
  name: 'prd_park',
  description: 'Park an open work item (PRD) row with a reason. A parked row is not open, and finish lists it with its reason in the witness.',
  inputSchema: obj({ id: str, reason: str }, ['id', 'reason']),
};

const REOPEN_TOOL = {
  name: 'prd_reopen',
  description: 'Move a parked work item (PRD) row back to open.',
  inputSchema: obj({ id: str }, ['id']),
};

export const ROW_TOOLS = [
  ...Object.entries(KINDS).flatMap(([kind, label]) => [
    { name: `${kind}_add`, description: `Add a ${label} row, one file under ${ROW_DIR}. Returns its id.`, inputSchema: obj({ title: str, body: str }, ['title']) },
    { name: `${kind}_list`, description: `List ${label} rows, one line each: id, status, title. status is open (default), parked, resolved or all.`, inputSchema: obj({ status: str }) },
    {
      name: `${kind}_resolve`,
      description: `Resolve a ${label} row. The witness is a seq of this run's log and a commit that exists in this repository.`,
      inputSchema: obj({ id: str, event: { type: 'number' }, commit: str }, ['id', 'event', 'commit']),
    },
  ]),
  DELETE_TOOL,
  PARK_TOOL,
  REOPEN_TOOL,
];

// A row keeps its id and its state in both horizons. A listing of rows is cut in the second horizon.
export const COMPACT = {
  tools: {
    prd_add: { zone1: resultZone1, zone2: resultZone2 },
    prd_delete: { zone1: resultZone1, zone2: resultZone2 },
    prd_park: { zone1: resultZone1, zone2: resultZone2 },
    prd_reopen: { zone1: resultZone1, zone2: resultZone2 },
    prd_resolve: { zone1: resultZone1, zone2: resultZone2 },
    unknown_add: { zone1: resultZone1, zone2: resultZone2 },
    unknown_resolve: { zone1: resultZone1, zone2: resultZone2 },
    prd_list: { zone1: resultZone1, zone2: () => null },
    unknown_list: { zone1: resultZone1, zone2: () => null },
  },
};

export function createRowVerbs({ root, confine, log }) {
  const handlers = {};
  for (const kind of Object.keys(KINDS)) {
    handlers[`${kind}_add`] = ({ title, body = '' }) => addRow(kind, title, body);
    handlers[`${kind}_list`] = ({ status = 'open' }) => listRows(kind, status);
    handlers[`${kind}_resolve`] = (args) => resolveRow(kind, args);
  }
  handlers.prd_delete = ({ id }) => deleteRow(id);
  handlers.prd_park = ({ id, reason }) => parkRow(id, reason);
  handlers.prd_reopen = ({ id }) => reopenRow(id);
  return handlers;

  async function addRow(kind, title, body) {
    if (typeof title !== 'string' || title.trim() === '') return fail('title must be a non-empty string');
    if (typeof body !== 'string') return fail('body must be a string');
    const row = { id: newId(kind), kind, title: title.trim(), body, status: 'open', createdAt: new Date().toISOString() };
    await writeRow(row);
    log.append('row-added', { row: row.id, rowKind: kind, title: row.title });
    return { ok: true, output: row.id };
  }

  async function listRows(kind, status) {
    const wanted = STATUS_ALIASES[status] ?? status;
    if (!STATUSES.includes(wanted)) return fail(`status must be one of ${[...STATUSES, ...Object.keys(STATUS_ALIASES)].join(', ')}`);
    const rows = sortByCreated((await readRows(confine)).filter((row) => row.kind === kind && (wanted === 'all' || (STATUS_ALIASES[row.status] ?? row.status) === wanted)));
    return { ok: true, output: rows.length ? rows.map((row) => `${row.id} ${row.status} ${row.title}${row.status === 'parked' ? ` (parked: ${row.parkReason})` : ''}`).join('\n') : '(none)' };
  }

  async function parkRow(id, reason) {
    if (!validId('prd', id)) return fail('id must name a prd row, with an id that starts prd-');
    if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must be a non-empty string');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.status !== 'open') return fail(`row ${id} is ${row.status}; only an open row is parked`);
    Object.assign(row, { status: 'parked', parkReason: reason.trim() });
    await writeRow(row);
    return { ok: true, output: `${id} parked: ${row.parkReason}` };
  }

  async function reopenRow(id) {
    if (!validId('prd', id)) return fail('id must name a prd row, with an id that starts prd-');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.status !== 'parked') return fail(`row ${id} is ${row.status}; only a parked row is reopened`);
    Object.assign(row, { status: 'open', parkReason: undefined });
    await writeRow(row);
    return { ok: true, output: `${id} reopened` };
  }

  async function deleteRow(id) {
    if (!validId('prd', id)) return fail('id must name a prd row, with an id that starts prd-');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.status === 'resolved') return fail(`row ${id} is resolved; a resolved PRD is history and stays`);
    const at = confine(`${ROW_DIR}/${id}.yml`);
    if (at.refused) throw new Error(at.refused);
    await rm(at.path);
    return { ok: true, output: `${id} deleted` };
  }

  async function resolveRow(kind, { id, event, commit }) {
    if (!validId(kind, id)) return fail(`id must name a ${kind} row, with an id that starts ${kind}-`);
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

// The open rows of a kind, for the reminder of a long body: how many rows there are and how many are open, and the first limit open rows in
// list order. That window is the next rows to do. A row file that cannot be read makes the read throw, and the caller says so.
export async function rowSummary(confine, kind, limit) {
  const rows = sortByCreated((await readRows(confine)).filter((row) => row.kind === kind));
  const open = rows.filter((row) => row.status === 'open');
  const window = open.slice(0, limit).map((row) => ({ id: row.id, title: row.title }));
  return { total: rows.length, open: open.length, window, more: open.length - window.length };
}

// The open rows of every kind, in list order. A finish is refused while any of them is open, and names them.
export async function openRows(confine) {
  return sortByCreated((await readRows(confine)).filter((row) => row.status === 'open'));
}

export async function parkedRows(confine) {
  return sortByCreated((await readRows(confine)).filter((row) => row.status === 'parked'));
}

async function readRows(confine) {
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

// Creation order, then id, so the list order is the same for every reader.
function sortByCreated(rows) {
  return rows.sort((a, b) => compareText(String(a.createdAt), String(b.createdAt)) || compareText(a.id, b.id));
}

function newId(kind) {
  return `${kind}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

function validId(kind, id) {
  return typeof id === 'string' && new RegExp(`^${kind}-[a-z0-9]+$`).test(id);
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
