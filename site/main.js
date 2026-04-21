import { createElement as h, createDOMElement, applyDiff } from "webjsx";

const PHASES = [
  { code: 'plan',     title: 'write the unknowns down', meta: '.gm/prd.yml' },
  { code: 'execute',  title: 'run code against real services', meta: 'exec:<lang>' },
  { code: 'emit',     title: 'write files after checks pass', meta: 'pre + post gates' },
  { code: 'verify',   title: 'end-to-end, real data', meta: 'no mocks' },
  { code: 'complete', title: '.prd empty, git clean, pushed', meta: 'test.js' },
];

const PRINCIPLES = [
  { t: 'jit execution', d: 'shell calls intercepted, languages auto-detected, long tasks backgrounded.' },
  { t: '1-shot overviews', d: 'ast parsing delivers structure, complexity, and caveats before first prompt.' },
  { t: 'semantic search', d: 'local vector search finds code by intent. compact results fit in context.' },
  { t: 'single test policy', d: 'one test.js at project root, 200L max. bug fixes become regression cases.' },
  { t: 'lang plugins', d: 'a file at lang/<id>.js wires any runtime into exec dispatch and diagnostics.' },
  { t: 'context reduction', d: 'install only what the project needs. skill tree routes agent through proven steps.' },
];

const PLATFORMS = [
  { code: '001', id: 'gm-cc',         label: 'claude code',    sub: 'anthropic cli',        meta: 'cli · live' },
  { code: '002', id: 'gm-gc',         label: 'gemini cli',     sub: 'google cli',           meta: 'cli · live' },
  { code: '003', id: 'gm-oc',         label: 'opencode',       sub: 'sst agent cli',        meta: 'cli · live' },
  { code: '004', id: 'gm-kilo',       label: 'kilo code',      sub: 'agent cli',            meta: 'cli · live' },
  { code: '005', id: 'gm-codex',      label: 'codex',          sub: 'openai cli',           meta: 'cli · live' },
  { code: '006', id: 'gm-copilot-cli',label: 'copilot cli',    sub: 'github extension',     meta: 'cli · live' },
  { code: '007', id: 'gm-qwen',       label: 'qwen code',      sub: 'alibaba cli',          meta: 'cli · live' },
  { code: '008', id: 'gm-hermes',     label: 'hermes agent',   sub: 'cli · needs patch',    meta: 'cli · wip' },
  { code: '009', id: 'gm-vscode',     label: 'vs code',        sub: 'microsoft ide',        meta: 'ide · live' },
  { code: '010', id: 'gm-cursor',     label: 'cursor',         sub: 'ai-first ide',         meta: 'ide · live' },
  { code: '011', id: 'gm-zed',        label: 'zed',            sub: 'rust ide',             meta: 'ide · live' },
  { code: '012', id: 'gm-jetbrains',  label: 'jetbrains',      sub: 'intellij family',      meta: 'ide · live' },
];

const RULES = [
  { t: 'name every unknown', d: 'apiShape=UNKNOWN, fileExists=UNKNOWN. named unknowns get resolved.' },
  { t: 'witnessed execution only', d: "a mutable closes when real code runs and produces real output." },
  { t: 'two-pass limit', d: 'still open after two attempts → fresh unknown → session resets to plan.' },
  { t: 'divergence → replan', d: 'output differs from expectation → new mutable → replan.' },
];

const NAV = [
  ['#works', 'works'],
  ['#process', 'process'],
  ['./stats.html', 'stats'],
  ['./made-with.html', 'showcase'],
  ['./paper.html', 'paper I'],
  ['./paper2.html', 'paper II'],
  ['https://github.com/AnEntrypoint/gm', 'source ↗'],
];

function Topbar() {
  return h('header', { class: 'app-topbar' },
    h('span', { class: 'brand' }, '247420', h('span', { class: 'slash' }, ' / '), 'gm'),
    h('nav', {}, ...NAV.map(([href, label]) =>
      h('a', { href, ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, label)
    ))
  );
}

function Crumb() {
  return h('div', { class: 'app-crumb' },
    h('span', {}, '247420'), h('span', { class: 'sep' }, '›'),
    h('span', {}, 'gm'), h('span', { class: 'sep' }, '›'),
    h('span', { class: 'leaf' }, 'state machine'),
  );
}

function Hero() {
  return h('section', { class: 'gm-hero' },
    h('h1', {}, 'a state machine that keeps coding sessions on track.'),
    h('p', { class: 'lede' },
      'gm enforces plan → execute → emit → verify → complete on every task, across 12 platforms. each unknown is named and resolved by witnessed execution. ',
      h('span', { class: 'accent' }, 'humor is load-bearing.'),
    ),
    h('div', { class: 'actions' },
      h('a', { class: 'gm-btn', href: './paper.html' }, 'read the paper'),
      h('a', { class: 'gm-btn ghost', href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener' }, 'source ↗'),
    ),
    h('div', { class: 'gm-install' },
      h('div', { class: 'head' }, h('span', {}, 'install · claude code'), h('span', {}, '2 steps')),
      h('div', { class: 'body' },
        h('div', { class: 'cmd' }, 'claude plugin marketplace add AnEntrypoint/gm'),
        h('div', { class: 'cmd' }, 'claude plugin install -s user gm@gm'),
      )
    )
  );
}

function CurrentlyShipping() {
  return h('section', {},
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'currently shipping'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', {}, 'state machine · v2.0'), h('span', {}, '12 platforms')),
      h('div', { class: 'panel-body' },
        h('div', { class: 'row' },
          h('span', { class: 'code' }, h('span', { style: 'color:var(--panel-accent)' }, '●')),
          h('span', { class: 'title' }, 'gm', h('span', { class: 'sub' }, 'state machine for coding agents')),
          h('span', { class: 'meta' }, 'live'),
        ),
        h('div', { class: 'row' },
          h('span', { class: 'code' }, h('span', { style: 'color:var(--panel-accent)' }, '●')),
          h('span', { class: 'title' }, 'plugkit', h('span', { class: 'sub' }, 'rust hook runtime')),
          h('span', { class: 'meta' }, 'live'),
        ),
        h('div', { class: 'row' },
          h('span', { class: 'code' }, h('span', { style: 'color:var(--panel-text-3)' }, '○')),
          h('span', { class: 'title' }, 'flatspace', h('span', { class: 'sub' }, 'flat-file cms (gh pages)')),
          h('span', { class: 'meta' }, 'wip'),
        ),
      )
    )
  );
}

function Works() {
  return h('section', { id: 'works' },
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'works · 12 platforms'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', {}, 'platforms · all'), h('span', {}, '12')),
      h('div', { class: 'panel-body' },
        ...PLATFORMS.map(p => h('a', {
          class: 'panel-row-link',
          href: `https://anentrypoint.github.io/${p.id}`,
          target: '_blank', rel: 'noopener',
        },
          h('span', { class: 'code' }, p.code),
          h('span', { class: 'title' }, p.label, h('span', { class: 'sub' }, p.sub)),
          h('span', { class: 'meta' }, p.meta),
        ))
      )
    )
  );
}

function Conversation() {
  return h('section', {},
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'how a session looks'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', {}, 'session · example'), h('span', {}, 'plan → complete')),
      h('div', { class: 'panel-body' },
        h('div', { class: 'gm-msg' }, h('span', { class: 'who user' }, 'you'), h('span', { class: 'body' }, 'add dark mode to the settings page')),
        h('div', { class: 'gm-msg' }, h('span', { class: 'who' }, 'thinking'), h('span', { class: 'body thinking' }, 'invoking planning skill…')),
        h('div', { class: 'gm-msg' }, h('span', { class: 'who gm' }, 'gm'), h('span', { class: 'body' }, 'writing .gm/prd.yml with 3 items: discover theme system, implement toggle, verify persistence. launching exec:codesearch.')),
        h('div', { class: 'gm-msg' }, h('span', { class: 'who tool' }, 'exec:codesearch'), h('span', { class: 'body' }, 'theme toggle settings → src/settings.js:42 ThemeProvider')),
        h('div', { class: 'gm-msg' }, h('span', { class: 'who gm' }, 'gm'), h('span', { class: 'body' }, 'all mutables KNOWN. invoking gm-emit → writing files → gm-complete → test.js passes → committed and pushed.')),
      )
    )
  );
}

function Process() {
  return h('section', { id: 'process' },
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'the process'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', {}, 'state machine · 5 phases'), h('span', {}, 'any new unknown → plan')),
      h('div', { class: 'panel-body' },
        ...PHASES.map((p, i) => h('div', { class: 'row' },
          h('span', { class: 'code' }, String(i + 1).padStart(3, '0')),
          h('span', { class: 'title' }, p.code, h('span', { class: 'sub' }, p.title)),
          h('span', { class: 'meta' }, p.meta),
        ))
      )
    )
  );
}

function Principles() {
  return h('section', {},
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'how it works'),
    h('div', { class: 'gm-cards' },
      ...PRINCIPLES.map(p => h('div', { class: 'gm-card' },
        h('div', { class: 't' }, p.t),
        h('div', { class: 'd' }, p.d),
      ))
    )
  );
}

function MutableDiscipline() {
  return h('section', {},
    h('div', { class: 'gm-section-label' }, h('span', { class: 'slash' }, '//'), 'mutable discipline'),
    h('div', { class: 'gm-cards' },
      ...RULES.map(r => h('div', { class: 'gm-card' },
        h('div', { class: 't' }, r.t),
        h('div', { class: 'd' }, r.d),
      ))
    )
  );
}

function Footer() {
  return h('footer', { class: 'gm-footer' },
    h('span', {}, 'main · 12 platforms · ',
      h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener' }, 'source ↗'),
      ' · ', h('a', { href: './paper.html' }, 'paper')
    ),
    h('span', {}, 'probably emerging \u{1F300}'),
  );
}

window.__debug = {
  site: {
    get PHASES() { return PHASES; },
    get PRINCIPLES() { return PRINCIPLES; },
    get PLATFORMS() { return PLATFORMS; },
    get RULES() { return RULES; },
  }
};

const root = document.getElementById('root');
const vnodes = [
  Topbar(),
  Crumb(),
  h('main', { class: 'app-main' },
    Hero(),
    CurrentlyShipping(),
    Conversation(),
    Process(),
    Works(),
    Principles(),
    MutableDiscipline(),
  ),
  Footer(),
];
for (const v of vnodes) {
  const el = createDOMElement(v);
  if (el) root.appendChild(el);
}
