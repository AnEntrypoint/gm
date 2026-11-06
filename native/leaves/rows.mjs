const ROW_DIR = 'work/rows';
const LEGACY_ROW_DIR = '.gm/prd';
const CLOSE_DIR = 'closes';
const KINDS = { prd: 'work item', unknown: 'open question' };
const STATUSES = ['open', 'parked', 'resolved', 'all'];
const STATUS_ALIASES = { pending: 'open', completed: 'resolved' };
const FIELDS = ['id', 'kind', 'title', 'body', 'status', 'createdAt', 'witnessEvent', 'witnessCommit', 'resolvedAt', 'parkReason'];
const SHA = /^[0-9a-f]{7,40}$/;
const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const fail = (error) => ({ ok: false, error });

const textOf = (reply) => (typeof reply === 'string' ? reply : (reply?.output ?? reply?.content ?? reply?.text ?? ''));

function readText(path) {
  let text = '';
  for (let offset = 0; ;) {
    const reply = host.read_file({ path, offset });
    if (reply?.ok === false) return reply;
    text += textOf(reply);
    if (typeof reply?.next !== 'number') return { ok: true, output: text };
    offset = reply.next;
  }
}
const missing = (reply) => reply?.ok === false && /ENOENT|no such file|not found/i.test(String(reply.error ?? ''));
const rowPath = (id) => `${host.workspace}/${ROW_DIR}/${id}.yml`;
const legacyRowPath = (id) => `${host.workspace}/${LEGACY_ROW_DIR}/${id}.yml`;

function rowFile(id) {
  for (const path of [rowPath(id), legacyRowPath(id)]) {
    if (host.stat_file({ path })?.ok !== false) return path;
  }
  return null;
}

function parseScalar(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseRow(source) {
  const row = {};
  for (const line of source.split('\n')) {
    const match = /^([A-Za-z]+): (.*)$/.exec(line);
    if (match) row[match[1]] = parseScalar(match[2]);
  }
  return row;
}

function renderRow(row) {
  const lines = FIELDS.filter((field) => row[field] !== undefined).map((field) => `${field}: ${JSON.stringify(row[field])}`);
  return `${lines.join('\n')}\n`;
}

function readRow(id) {
  const path = rowFile(id);
  if (path === null) return null;
  const reply = readText(path);
  if (missing(reply)) return null;
  if (reply?.ok === false) throw new Error(reply.error);
  return { ...parseRow(textOf(reply)), file: path };
}

function writeRow(row) {
  const reply = host.write_file({ path: row.file ?? rowPath(row.id), content: renderRow(row) });
  if (reply?.ok === false) throw new Error(reply.error);
}

function rowNames(dir) {
  const listing = host.list_dir({ path: `${host.workspace}/${dir}` });
  if (listing?.ok === false) {
    if (missing(listing)) return [];
    throw new Error(listing.error);
  }
  const entries = Array.isArray(listing) ? listing : (listing.entries ?? listing.names ?? String(listing.output ?? '').split('\n'));
  return entries
    .map((entry) => (typeof entry === 'string' ? entry : entry.name))
    .filter((name) => name.endsWith('.yml'));
}

function readRows() {
  const seen = new Set();
  const rows = [];
  for (const dir of [ROW_DIR, LEGACY_ROW_DIR]) {
    for (const name of rowNames(dir)) {
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push(parseRow(textOf(readText(`${host.workspace}/${dir}/${name}`))));
    }
  }
  return rows;
}

const compareText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
const sortByCreated = (rows) => rows.sort((a, b) => compareText(String(a.createdAt), String(b.createdAt)) || compareText(a.id, b.id));
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);

function newId(kind) {
  const random = Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
  return `${kind}-${Date.now().toString(36)}${random}`;
}

function eventInLog(event) {
  const reply = readText(`${host.runDir}/log.jsonl`);
  if (reply?.ok === false) return false;
  return textOf(reply).split('\n').some((line) => {
    try {
      return JSON.parse(line).seq === event;
    } catch {
      return false;
    }
  });
}

function commitExists(commit) {
  const reply = host.run({ argv: ['git', 'cat-file', '-e', `${commit}^{commit}`], cwd: host.workspace, timeoutMs: 15000 });
  return reply.started && !reply.timedOut && reply.exitCode === 0;
}

function runGit(argv) {
  const reply = host.run({ argv: ['git', ...argv], cwd: host.workspace, timeoutMs: 15000 });
  return reply.started && !reply.timedOut && reply.exitCode === 0;
}

function removeFile(path) {
  const removed = typeof host.delete_file === 'function' ? host.delete_file({ path }) : null;
  if (removed?.ok === true) return removed;
  const windowsPath = path.split('/').join('\\');
  const commands = [
    ['rm', '-f', '--', path],
    ['cmd.exe', '/d', '/c', 'del', '/f', '/q', windowsPath],
  ];
  for (const argv of commands) {
    host.run({ argv, cwd: host.workspace, timeoutMs: 15000 });
    if (host.stat_file({ path })?.ok === false) return { ok: true };
  }
  return fail(`row file ${path} could not be removed`);
}

function addRow(kind, { title, body = '' }) {
  if (typeof title !== 'string' || title.trim() === '') return fail('title must be a non-empty string');
  if (typeof body !== 'string') return fail('body must be a string');
  const row = { id: newId(kind), kind, title: title.trim(), body, status: 'open', createdAt: new Date().toISOString() };
  writeRow(row);
  host.logAppend({ kind: 'row-added', fields: { row: row.id, rowKind: kind, title: row.title } });
  return { ok: true, output: row.id };
}

function listRows(kind, { status = 'open' }) {
  const wanted = STATUS_ALIASES[status] ?? status;
  if (!STATUSES.includes(wanted)) return fail(`status must be one of ${[...STATUSES, ...Object.keys(STATUS_ALIASES)].join(', ')}`);
  const rows = sortByCreated(readRows().filter((row) => row.kind === kind && (wanted === 'all' || (STATUS_ALIASES[row.status] ?? row.status) === wanted)));
  return { ok: true, output: rows.length ? rows.map((row) => `${row.id} ${row.status} ${row.title}${row.status === 'parked' ? ` (parked: ${row.parkReason})` : ''}`).join('\n') : '(none)' };
}

function parkRow(id, reason) {
  if (!validId(id)) return fail('id must be a row id');
  if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must be a non-empty string');
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.kind !== 'prd') return fail(`row ${id} is not a work item`);
  if (row.status !== 'open') return fail(`row ${id} is ${row.status}; only an open row is parked`);
  Object.assign(row, { status: 'parked', parkReason: reason.trim() });
  writeRow(row);
  return { ok: true, output: `${id} parked: ${row.parkReason}` };
}

function reopenRow({ id }) {
  if (!validId(id)) return fail('id must be a row id');
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.kind !== 'prd') return fail(`row ${id} is not a work item`);
  if (row.status !== 'parked') return fail(`row ${id} is ${row.status}; only a parked row is reopened`);
  Object.assign(row, { status: 'open', parkReason: undefined });
  writeRow(row);
  return { ok: true, output: `${id} reopened` };
}

function closeRow(kind, id, witness) {
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.kind !== undefined && row.kind !== kind) return fail(`row ${id} is not a ${KINDS[kind]}`);
  if (row.status === 'resolved') return fail(`row ${id} is already resolved`);
  const status = 'resolved';
  const closeRel = `${CLOSE_DIR}/${id}.txt`;
  const written = host.write_file({ path: `${host.workspace}/${closeRel}`, content: `${id} ${status} ${witness} ${new Date().toISOString()}\n` });
  if (written?.ok === false) return fail(`close record ${closeRel} could not be written: ${written.error}`);
  const rowRel = row.file === legacyRowPath(id) ? `${LEGACY_ROW_DIR}/${id}.yml` : `${ROW_DIR}/${id}.yml`;
  const removed = removeFile(row.file);
  if (removed?.ok !== true) return fail(`row ${id} could not be removed`);
  const paths = [closeRel];
  if (runGit(['ls-files', '--error-unmatch', '--', rowRel])) paths.push(rowRel);
  const message = `close ${id}\n\nRow: ${id}\nStatus: ${status}\nWitness: ${witness}`;
  runGit(['add', '-A', '--', ...paths]);
  if (!runGit(['commit', '-m', message, '--', ...paths])) return fail(`close ${id} has no commit; ${closeRel} is written and the row file is removed`);
  const head = host.run({ argv: ['git', 'rev-parse', '--short', 'HEAD'], cwd: host.workspace, timeoutMs: 15000 });
  return { ok: true, output: `${id} ${status} by witness ${witness} at commit ${head.out?.trim() ?? 'HEAD'}` };
}

function resolveRow(kind, { id, event, commit, witness }) {
  if (!validId(id)) return fail('id must be a row id');
  const given = typeof witness === 'string' ? witness : (typeof event === 'string' ? event : null);
  if (given !== null) {
    const clean = given.replace(/\s+/g, ' ').trim();
    if (clean === '') return fail('witness must be a non-empty string');
    return closeRow(kind, id, clean);
  }
  if (!Number.isInteger(event) || event < 1) return fail('event must be a log seq number');
  if (!eventInLog(event)) return fail(`event ${event} is not in this run's log`);
  if (typeof commit !== 'string' || !SHA.test(commit)) return fail('commit must be 7 to 40 lowercase hex digits');
  if (!commitExists(commit)) return fail(`no commit ${commit} in this repository`);
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.kind !== undefined && row.kind !== kind) return fail(`row ${id} is not a ${KINDS[kind]}`);
  if (row.status === 'resolved') return fail(`row ${id} is already resolved`);
  Object.assign(row, { status: 'resolved', witnessEvent: event, witnessCommit: commit, resolvedAt: new Date().toISOString() });
  writeRow(row);
  return { ok: true, output: `${id} resolved by event ${event} at commit ${commit}` };
}

function deleteRow({ id }) {
  if (!validId(id)) return fail('id must be a row id');
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.kind !== 'prd') return fail(`row ${id} is not a work item`);
  if (row.status === 'resolved') return fail(`row ${id} is resolved; a resolved PRD is history and stays`);
  const path = row.file ?? rowPath(id);
  removeFile(path);
  if (host.stat_file({ path })?.ok !== false) return fail(`row ${id} could not be removed`);
  return { ok: true, output: `${id} deleted` };
}

export const verbs = [
  ...Object.entries(KINDS).flatMap(([kind, label]) => [
    { name: `${kind}_add`, description: `Add a ${label} row, one file under ${ROW_DIR}. Returns its id.`, inputSchema: obj({ title: str, body: str }, ['title']), call: (args = {}) => addRow(kind, args) },
    { name: `${kind}_list`, description: `List ${label} rows, one line each: id, status, title. status is open (default), parked, resolved or all.`, inputSchema: obj({ status: str }), call: (args = {}) => listRows(kind, args) },
    {
      name: `${kind}_resolve`,
      description: `Resolve a ${label} row in one call. Pass witness, the evidence string: the row file is removed, one line goes to closes/<id>.txt, and a commit records the row, status and witness. A numeric event seq and an existing commit sha keep the older in-place resolution.`,
      inputSchema: obj({ id: str, event: { type: 'number' }, commit: str, witness: str }, ['id']),
      call: (args = {}) => resolveRow(kind, args),
    },
  ]),
  {
    name: 'prd_delete',
    description: 'Delete a work item (PRD) row that is not resolved: the work is dropped and its file is removed, and git keeps it. An open question is resolved, not deleted.',
    inputSchema: obj({ id: str }, ['id']),
    call: (args = {}) => deleteRow(args),
  },
  {
    name: 'prd_park',
    description: 'Park an open work item (PRD) row with a reason. A parked row is not open, and finish lists it with its reason in the witness.',
    inputSchema: obj({ id: str, reason: str }, ['id', 'reason']),
    call: (args = {}) => parkRow(args.id, args.reason),
  },
  {
    name: 'prd_reopen',
    description: 'Move a parked work item (PRD) row back to open.',
    inputSchema: obj({ id: str }, ['id']),
    call: (args = {}) => reopenRow(args),
  },
];
