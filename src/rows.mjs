import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commitExists, SHA } from './git.mjs';
import { resultZone1, resultZone2 } from './compact.mjs';

export const ROW_DIR = 'work/rows';
const KINDS = { prd: 'work item', unknown: 'open question' };
const STATUSES = ['open', 'parked', 'refuted', 'resolved', 'all'];
const STATUS_ALIASES = { pending: 'open', completed: 'resolved' };
const ROW_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
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
  description: 'Move a parked work item (PRD) row back to open, or reopen a refuted row with from:refuted and a reason.',
  inputSchema: obj({ id: str, from: str, reason: str }, ['id']),
};

const RECEIPT_TOOL = {
  name: 'prd_receipt',
  description: 'gm.prd_receipt binds a witness receipt to a work item (PRD) row without resolving it or deleting the row file.',
  inputSchema: obj({ id: str, witness: str, event: { type: 'number' }, commit: str }, ['id', 'witness']),
};

const REFUTE_TOOL = {
  name: 'prd_refute',
  description: 'gm.prd_refute marks an open work item (PRD) row refuted with a reason, verdict, notes and witness receipt.',
  inputSchema: obj({ id: str, reason: str, verdict: str, notes: str, witness: str }, ['id', 'reason']),
};

export const ROW_TOOLS = [
  ...Object.entries(KINDS).flatMap(([kind, label]) => [
    { name: `${kind}_add`, description: `Add a ${label} row, one file under ${ROW_DIR}. Returns its id.`, inputSchema: obj({ title: str, body: str }, ['title']) },
    { name: `${kind}_list`, description: `List ${label} rows, one line each: id, status, title. status is open (default), parked, refuted, resolved or all. A row with receipts carries [receipts:N].`, inputSchema: obj({ status: str }) },
    {
      name: `${kind}_resolve`,
      description: `Resolve a ${label} row. The witness is a seq of this run's log and a commit that exists in this repository. push:true asks to push the close by full sha to origin/main in one call.`,
      inputSchema: obj({ id: str, event: { type: 'number' }, commit: str, push: { type: 'boolean' } }, ['id', 'event', 'commit']),
    },
  ]),
  DELETE_TOOL,
  PARK_TOOL,
  REOPEN_TOOL,
  RECEIPT_TOOL,
  REFUTE_TOOL,
];

export const COMPACT = {
  tools: {
    prd_add: { zone1: resultZone1, zone2: resultZone2 },
    prd_delete: { zone1: resultZone1, zone2: resultZone2 },
    prd_park: { zone1: resultZone1, zone2: resultZone2 },
    prd_reopen: { zone1: resultZone1, zone2: resultZone2 },
    prd_receipt: { zone1: resultZone1, zone2: resultZone2 },
    prd_refute: { zone1: resultZone1, zone2: resultZone2 },
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
  handlers.prd_receipt = (args) => receiptRow(args);
  handlers.prd_refute = (args) => refuteRow(args);
  handlers.prd_reopen = (args) => reopenRow(args);
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
    if (!STATUSES.includes(wanted)) return fail('status must be one of ' + [...STATUSES, ...Object.keys(STATUS_ALIASES)].join(', '));
    const rows = sortByCreated((await readRows(confine)).filter((row) => (row.kind ?? 'prd') === kind && (wanted === 'all' || (STATUS_ALIASES[row.status] ?? row.status) === wanted)));
    const shown = rows.map((row) => {
      const parked = row.status === 'parked' ? ' (parked: ' + row.parkReason + ')' : '';
      const receipts = Array.isArray(row.receipts) && row.receipts.length > 0 ? ' [receipts:' + row.receipts.length + ']' : '';
      return row.id + ' ' + row.status + ' ' + row.title + parked + receipts;
    });
    return { ok: true, output: shown.length ? shown.join('\n') : '(none)' };
  }
  async function parkRow(id, reason) {
    if (!validId(id)) return fail('id must be a row id');
    if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must be a non-empty string');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== 'prd') return fail(`row ${id} is not a work item`);
    if (row.status !== 'open') return fail(`row ${id} is ${row.status}; only an open row is parked`);
    Object.assign(row, { status: 'parked', parkReason: reason.trim() });
    await writeRow(row);
    return { ok: true, output: `${id} parked: ${row.parkReason}` };
  }

  async function reopenRow({ id, from = 'parked', reason }) {
    if (!validId(id)) return fail('id must be a row id');
    if (from !== 'parked' && from !== 'refuted') return fail('from must be parked or refuted');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== undefined && row.kind !== 'prd') return fail(`row ${id} is not a work item`);
    if (from === 'parked') {
      if (row.status !== 'parked') return fail(`row ${id} is ${row.status}; only a parked row is reopened`);
      Object.assign(row, { status: 'open', parkReason: undefined, reopenedFrom: 'parked', reopenedAt: new Date().toISOString() });
    } else {
      if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must be a non-empty string');
      const body = String(row.body ?? '');
      const refuted = row.status === 'refuted' || (row.status === 'resolved' && (/^(status|verdict):\s*(refuted|needs-design)\b/m.test(body) || row.verdict === 'refuted' || row.verdict === 'needs-design' || row.bodyStatus === 'refuted'));
      if (!refuted) return fail(`row ${id} is ${row.status}; only a refuted row is reopened with from:refuted`);
      Object.assign(row, { status: 'open', reopenedFrom: row.status, reopenReason: reason.trim(), reopenedAt: new Date().toISOString() });
    }
    await writeRow(row);
    log.append('row-reopened', { row: id, from, status: row.status, reason: reason ?? '' });
    return { ok: true, output: `${id} reopened from ${from}` };
  }

  async function receiptRow({ id, witness, event, commit }) {
    if (!validId(id)) return fail('id must be a row id');
    if (typeof witness !== 'string' || witness.trim() === '') return fail('witness must be a non-empty string');
    if (event !== undefined && (!Number.isInteger(event) || event < 1 || !log.events().some((entry) => entry.seq === event))) return fail(`event ${event} is not in this run's log`);
    if (commit !== undefined && (typeof commit !== 'string' || !SHA.test(commit))) return fail('commit must be 7 to 40 lowercase hex digits');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== undefined && row.kind !== 'prd') return fail(`row ${id} is not a work item`);
    const receipt = { witness: witness.trim() };
    if (event !== undefined) receipt.event = event;
    if (commit !== undefined) receipt.commit = commit;
    row.receipts = [...(Array.isArray(row.receipts) ? row.receipts : []), receipt];
    if (event !== undefined) row.witnessEvent = event;
    if (commit !== undefined) row.witnessCommit = commit;
    await writeRow(row);
    log.append('row-receipt', { row: id, receipts: row.receipts.length, witness: witness.trim(), commit: commit ?? null });
    return { ok: true, output: `${id} receipt ${row.receipts.length} bound` };
  }

  async function refuteRow({ id, reason, verdict, notes, witness }) {
    if (!validId(id)) return fail('id must be a row id');
    if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must be a non-empty string');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== undefined && row.kind !== 'prd') return fail(`row ${id} is not a work item`);
    if (row.status !== 'open') return fail(`row ${id} is ${row.status}; only an open row is refuted`);
    Object.assign(row, { status: 'refuted', refuteReason: reason.trim(), refutedAt: new Date().toISOString() });
    if (verdict !== undefined) row.verdict = verdict;
    if (notes !== undefined) row.notes = notes;
    if (witness !== undefined) row.witness = witness;
    await writeRow(row);
    log.append('row-refuted', { row: id, status: row.status, reason: row.refuteReason, verdict: row.verdict ?? null });
    return { ok: true, output: `${id} refuted: ${row.refuteReason}` };
  }
  async function deleteRow(id) {
    if (!validId(id)) return fail('id must be a row id');
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== 'prd') return fail(`row ${id} is not a work item`);
    if (row.status === 'resolved') return fail(`row ${id} is resolved; a resolved PRD is history and stays`);
    const at = confine(`${ROW_DIR}/${id}.yml`);
    if (at.refused) throw new Error(at.refused);
    await rm(at.path);
    return { ok: true, output: `${id} deleted` };
  }

  async function resolveRow(kind, { id, event, commit }) {
    if (!validId(id)) return fail('id must be a row id');
    if (!Number.isInteger(event) || event < 1) return fail('event must be a log seq number');
    if (!log.events().some((entry) => entry.seq === event)) return fail(`event ${event} is not in this run's log`);
    if (typeof commit !== 'string' || !SHA.test(commit)) return fail('commit must be 7 to 40 lowercase hex digits');
    if (!(await commitExists(root, commit))) return fail(`no commit ${commit} in this repository`);
    const row = await readRow(id);
    if (row === null) return fail(`no row ${id}`);
    if (row.kind !== kind) return fail(`row ${id} is not a ${KINDS[kind]}`);
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

export async function rowSummary(confine, kind, limit) {
  const rows = sortByCreated((await readRows(confine)).filter((row) => row.kind === kind));
  const open = rows.filter((row) => row.status === 'open');
  const window = open.slice(0, limit).map((row) => ({ id: row.id, title: row.title }));
  return { total: rows.length, open: open.length, window, more: open.length - window.length };
}

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

function sortByCreated(rows) {
  return rows.sort((a, b) => compareText(String(a.createdAt), String(b.createdAt)) || compareText(a.id, b.id));
}

function newId(kind) {
  return `${kind}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

function renderRow(row) {
  const lines = Object.keys(row).filter((field) => field !== 'file' && row[field] !== undefined && ROW_KEY.test(field)).map((field) => field + ': ' + JSON.stringify(row[field]));
  return lines.join('\n') + '\n';
}

function parseRow(source) {
  const row = {};
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*): (.*)$/.exec(line);
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
function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function fail(error) {
  return { ok: false, error };
}
