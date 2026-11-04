const ROW_DIR = 'work/rows';
const KINDS = { prd: 'work item', unknown: 'open question' };
const STATUSES = ['open', 'resolved', 'all'];
const FIELDS = ['id', 'kind', 'title', 'body', 'status', 'createdAt', 'witnessEvent', 'witnessCommit', 'resolvedAt'];
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
  const reply = readText(rowPath(id));
  if (missing(reply)) return null;
  if (reply?.ok === false) throw new Error(reply.error);
  return parseRow(textOf(reply));
}

function writeRow(row) {
  const reply = host.write_file({ path: rowPath(row.id), content: renderRow(row) });
  if (reply?.ok === false) throw new Error(reply.error);
}

function readRows() {
  const listing = host.list_dir({ path: `${host.workspace}/${ROW_DIR}` });
  if (listing?.ok === false) {
    if (missing(listing)) return [];
    throw new Error(listing.error);
  }
  const entries = Array.isArray(listing) ? listing : (listing.entries ?? listing.names ?? String(listing.output ?? '').split('\n'));
  return entries
    .map((entry) => (typeof entry === 'string' ? entry : entry.name))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => parseRow(textOf(readText(`${host.workspace}/${ROW_DIR}/${name}`))));
}

const compareText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
const sortByCreated = (rows) => rows.sort((a, b) => compareText(String(a.createdAt), String(b.createdAt)) || compareText(a.id, b.id));
const validId = (kind, id) => typeof id === 'string' && new RegExp(`^${kind}-[a-z0-9]+$`).test(id);

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

function removeFile(path) {
  const removed = typeof host.delete_file === 'function' ? host.delete_file({ path }) : null;
  if (removed?.ok === true) return removed;
  const git = (argv) => host.run({ argv: ['git', '--literal-pathspecs', ...argv, '--', path], cwd: host.workspace, timeoutMs: 15000 });
  git(['clean', '-f', '-q']);
  if (host.stat_file({ path })?.ok === false) return { ok: true };
  return git(['rm', '-f', '-q']);
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
  if (!STATUSES.includes(status)) return fail(`status must be one of ${STATUSES.join(', ')}`);
  const rows = sortByCreated(readRows().filter((row) => row.kind === kind && (status === 'all' || row.status === status)));
  return { ok: true, output: rows.length ? rows.map((row) => `${row.id} ${row.status} ${row.title}`).join('\n') : '(none)' };
}

function resolveRow(kind, { id, event, commit }) {
  if (!validId(kind, id)) return fail(`id must name a ${kind} row, with an id that starts ${kind}-`);
  if (!Number.isInteger(event) || event < 1) return fail('event must be a log seq number');
  if (!eventInLog(event)) return fail(`event ${event} is not in this run's log`);
  if (typeof commit !== 'string' || !SHA.test(commit)) return fail('commit must be 7 to 40 lowercase hex digits');
  if (!commitExists(commit)) return fail(`no commit ${commit} in this repository`);
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.status === 'resolved') return fail(`row ${id} is already resolved`);
  Object.assign(row, { status: 'resolved', witnessEvent: event, witnessCommit: commit, resolvedAt: new Date().toISOString() });
  writeRow(row);
  return { ok: true, output: `${id} resolved by event ${event} at commit ${commit}` };
}

function deleteRow({ id }) {
  if (!validId('prd', id)) return fail('id must name a prd row, with an id that starts prd-');
  const row = readRow(id);
  if (row === null) return fail(`no row ${id}`);
  if (row.status === 'resolved') return fail(`row ${id} is resolved; a resolved PRD is history and stays`);
  removeFile(rowPath(id));
  if (host.stat_file({ path: rowPath(id) })?.ok !== false) return fail(`row ${id} could not be removed`);
  return { ok: true, output: `${id} deleted` };
}

export const verbs = [
  ...Object.entries(KINDS).flatMap(([kind, label]) => [
    { name: `${kind}_add`, description: `Add a ${label} row, one file under ${ROW_DIR}. Returns its id.`, inputSchema: obj({ title: str, body: str }, ['title']), call: (args = {}) => addRow(kind, args) },
    { name: `${kind}_list`, description: `List ${label} rows, one line each: id, status, title. status is open (default), resolved or all.`, inputSchema: obj({ status: str }), call: (args = {}) => listRows(kind, args) },
    {
      name: `${kind}_resolve`,
      description: `Resolve a ${label} row. The witness is a seq of this run's log and a commit that exists in this repository.`,
      inputSchema: obj({ id: str, event: { type: 'number' }, commit: str }, ['id', 'event', 'commit']),
      call: (args = {}) => resolveRow(kind, args),
    },
  ]),
  {
    name: 'prd_delete',
    description: 'Delete a work item (PRD) row that is not resolved: the work is dropped and its file is removed, and git keeps it. An open question is resolved, not deleted.',
    inputSchema: obj({ id: str }, ['id']),
    call: (args = {}) => deleteRow(args),
  },
];
