const EXECUTE = 'playwriter_execute';
const BROWSERS = 'playwriter_browsers';
const BROWSER_MS = 10000;
const TITLE_CHARS = 80;
const URL_CHARS = 200;
const OPEN_RUN = "if (!state.gmPage || state.gmPage.isClosed()) { state.gmProject = await browser.newContext(); state.gmPage = await state.gmProject.newPage(); } var page = state.gmPage;if (!state.gmRun) { state.gmRun = await browser.newContext(); state.gmRun.setDefaultTimeout(60000); state.gmRun.setDefaultNavigationTimeout(10000); } context = state.gmRun; ";
const TABS_CODE = "const cdp = await browser.newBrowserCDPSession(); const { targetInfos } = await cdp.send('Target.getTargets'); const { browserContextIds } = await cdp.send('Target.getBrowserContexts'); const created = new Set(browserContextIds); const rows = []; let own = null; if (state.gmRun) { for (const p of state.gmRun.pages()) { if (p.isClosed()) continue; if (own === null) { const s = await state.gmRun.newCDPSession(p); own = (await s.send('Target.getTargetInfo')).targetInfo.browserContextId; await s.detach(); } rows.push({ url: p.url(), title: await p.title().catch(() => '') }); } } const counts = { otherRuns: 0, projectTabs: 0 }; for (const t of targetInfos) { if (t.type !== 'page' || t.browserContextId === own) continue; if (created.has(t.browserContextId)) counts.otherRuns += 1; else counts.projectTabs += 1; } await cdp.detach(); return 'GMTABS' + JSON.stringify({ rows, counts }) + 'GMTABS';";
const CLOSE_CODE = "let n = 0; if (state.gmRun) { try { n = state.gmRun.pages().filter((p) => !p.isClosed()).length; await state.gmRun.close(); } finally { delete state.gmRun; } } return 'GMCLOSED' + n + 'GMCLOSED';";

export const BROWSER_VERBS = [
  {
    name: 'browser_tabs',
    description: 'The tabs this run opened in its own browser context, listed with url and title, and the other tabs of this project browser counted but not listed. When nothing changed since the last call the reply says unchanged.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_close_run',
    description: "Close this run's browser context and every tab in it. Other runs and other projects are not touched. finish calls it.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_close_machine',
    description: 'Close the whole project browser, with every run\'s tabs. A separate explicit action that needs confirm true. playwriter_browsers close is run-scoped and never does this.',
    inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' }, target: { type: 'string' }, force: { type: 'boolean' } }, required: ['confirm'] },
  },
];

const HANDLED = new Set([EXECUTE, BROWSERS, ...BROWSER_VERBS.map((verb) => verb.name)]);
const textOf = (value) => (typeof value === 'string' ? value : '');
const headChars = (text, count) => (text.length <= count ? text : `${text.slice(0, count)}...`);
const outputOf = (reply) => {
  if (typeof reply.output === 'string') return reply.output;
  if (typeof reply.error === 'string') return reply.error;
  return 'the browser did not answer';
};

function renderView(view) {
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const listed = rows.map((row, index) => `${index === 0 ? '' : '; '}[${index + 1}] ${headChars(textOf(row.url), URL_CHARS)} "${headChars(textOf(row.title), TITLE_CHARS)}"`).join('');
  let text = rows.length === 0 ? 'tabs: none in this run' : `tabs: ${rows.length} in this run, safe to close on finish: ${listed}`;
  const otherRuns = typeof view.counts?.otherRuns === 'number' ? view.counts.otherRuns : 0;
  const projectTabs = typeof view.counts?.projectTabs === 'number' ? view.counts.projectTabs : 0;
  if (otherRuns + projectTabs > 0) text += `; not this run and not closable by it: ${otherRuns} in other runs and ${projectTabs} in the project browser`;
  return { text, count: rows.length };
}

export function createBrowserScope({ inner, log }) {
  let used = false;
  let lastView = null;
  let lastCount = 0;

  const reset = () => {
    used = false;
    lastView = null;
    lastCount = 0;
  };

  async function userExecute(args) {
    if (typeof args.code !== 'string') return inner(EXECUTE, args);
    const trimmed = args.code.replace(/[; \n\t\r]+$/, '');
    const single = trimmed !== '' && !/[;\n]/.test(trimmed) && !trimmed.includes('return');
    const parenthesized = trimmed.startsWith('(') && trimmed.endsWith(')');
    const body = single || parenthesized ? `return await (${trimmed});` : args.code;
    used = true;
    return inner(EXECUTE, { ...args, code: OPEN_RUN + body });
  }

  async function tabs() {
    if (!used) return { ok: true, state: 'none', text: 'tabs: none in this run' };
    const reply = await inner(EXECUTE, { code: TABS_CODE, timeout: BROWSER_MS });
    const unavailable = (why) => ({ ok: true, state: 'unavailable', text: `tabs: unavailable: ${why}` });
    if (reply.ok !== true) return unavailable(headChars(outputOf(reply), TITLE_CHARS));
    const match = /GMTABS([\s\S]*)GMTABS/.exec(outputOf(reply));
    if (match === null) return unavailable('the browser answer had no tab view');
    let view;
    try {
      view = JSON.parse(match[1]);
    } catch {
      return unavailable('the tab view was not JSON');
    }
    const rendered = renderView(view);
    if (lastView === rendered.text) return { ok: true, state: 'unchanged', text: `tabs: unchanged, ${lastCount} in this run` };
    lastView = rendered.text;
    lastCount = rendered.count;
    return { ok: true, state: 'changed', text: rendered.text };
  }

  async function closeRun() {
    if (!used) return { ok: true, closedPages: 0, skipped: true };
    const reply = await inner(EXECUTE, { code: CLOSE_CODE, timeout: BROWSER_MS });
    reset();
    if (reply.ok !== true) return { ok: false, error: `this run's browser context was not closed: ${outputOf(reply)}` };
    const match = /GMCLOSED(\d+)GMCLOSED/.exec(outputOf(reply));
    return { ok: true, closedPages: match === null ? 0 : Number(match[1]) };
  }

  async function closeMachine(args) {
    if (args.confirm !== true) return { ok: false, error: "browser_close_machine needs confirm true: it closes the whole project browser, with every run's tabs in it" };
    const reply = await inner(BROWSERS, { action: 'close', target: typeof args.target === 'string' ? args.target : 'project', force: args.force === true });
    if (reply.ok === true) reset();
    return reply;
  }

  return {
    handles: (name) => HANDLED.has(name),
    async call(name, args = {}) {
      if (name === EXECUTE) return userExecute(args);
      if (name === BROWSERS) return args.action === 'close' ? closeRun() : inner(BROWSERS, args);
      if (name === 'browser_tabs') return tabs();
      if (name === 'browser_close_run') return closeRun();
      return closeMachine(args);
    },
    async closeForRun() {
      const closed = await closeRun();
      log.append('browser-closed', closed);
      return closed;
    },
    tabsText: async () => (await tabs()).text,
  };
}
