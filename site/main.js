import { createElement as h, createDOMElement } from "webjsx";

const PHASES = [
  { name: 'plan', desc: 'list every unknown. write .gm/prd.yml with acceptance criteria. nothing runs without a plan.' },
  { name: 'execute', desc: 'run code against real services. hypotheses resolved by output, not docs.' },
  { name: 'emit', desc: 'write files only after pre-emit checks pass. verify from disk.' },
  { name: 'verify', desc: 'end-to-end execution. real services, real data, real timing.' },
  { name: 'complete', desc: '.gm/prd.yml empty, test.js passes, git clean, pushed.' },
];

const PRINCIPLES = [
  { title: 'jit execution', desc: 'shell calls intercepted, languages auto-detected, long tasks backgrounded. code runs in managed lifecycle.' },
  { title: '1-shot overviews', desc: 'ast parsing delivers codebase structure, complexity metrics, and caveats before first prompt.' },
  { title: 'semantic search', desc: 'local vector search finds code by intent. compact results fit in context without summarization.' },
  { title: 'single test policy', desc: 'one test.js at project root, 200L max. bug fixes become regression cases. replaces all unit tests.' },
  { title: 'lang plugins', desc: 'a commonjs file at lang/<id>.js wires any runtime into exec dispatch, lsp diagnostics, and context injection.' },
  { title: 'context reduction', desc: 'install only what the project needs. skill tree routes agent through proven steps.' },
];

const PLATFORMS = [
  { id: 'gm-cc', label: 'Claude Code', type: 'cli' },
  { id: 'gm-gc', label: 'Gemini CLI', type: 'cli' },
  { id: 'gm-oc', label: 'OpenCode', type: 'cli' },
  { id: 'gm-kilo', label: 'Kilo Code', type: 'cli' },
  { id: 'gm-codex', label: 'Codex', type: 'cli' },
  { id: 'gm-copilot-cli', label: 'Copilot CLI', type: 'cli' },
  { id: 'gm-qwen', label: 'Qwen Code', type: 'cli' },
  { id: 'gm-hermes', label: 'Hermes Agent', type: 'cli' },
  { id: 'gm-vscode', label: 'VS Code', type: 'ide' },
  { id: 'gm-cursor', label: 'Cursor', type: 'ide' },
  { id: 'gm-zed', label: 'Zed', type: 'ide' },
  { id: 'gm-jetbrains', label: 'JetBrains', type: 'ide' },
];

const RULES = [
  { title: 'name every unknown', desc: 'apiShape=UNKNOWN, fileExists=UNKNOWN. named unknowns get resolved; unnamed ones cause bugs.' },
  { title: 'witnessed execution only', desc: "a mutable closes when real code runs and produces real output. inference doesn't count." },
  { title: 'two-pass limit', desc: 'still open after two attempts → fresh unknown → session resets to plan.' },
  { title: 'divergence → replan', desc: 'output differs from expectation → new mutable → replanning before any further edits.' },
];

function Topbar() {
  const links = [
    ['#principles', 'principles'],
    ['#process', 'process'],
    ['./stats.html', 'stats'],
    ['./made-with.html', 'showcase'],
    ['./paper.html', 'paper I'],
    ['./paper2.html', 'paper II'],
    ['https://github.com/AnEntrypoint/gm', 'source ↗'],
  ];
  return h('header', { class: 'app-top' },
    h('span', { class: 'brand' }, '247420', h('span', { class: 'slash' }, '/'), 'gm'),
    h('nav', {}, ...links.map(([href, label]) =>
      h('a', { href, ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, label)
    ))
  );
}

function Dateline() {
  const today = new Date().toISOString().slice(0, 10);
  return h('div', { class: 'dateline' },
    h('span', { class: 't-micro' }, '247420 / anentrypoint'),
    h('span', { class: 't-micro' }, 'gm — state machine'),
    h('span', { class: 't-micro' }, today),
    h('span', { class: 't-micro' }, 'probably emerging \u{1F300}'),
  );
}

function Hero() {
  return h('section', { class: 'hero' },
    h('span', { class: 'stamp ink' }, 'state machine'),
    h('h1', { class: 't-hero' }, 'gm', h('span', { class: 'slash' }, '/'), 'ship code that works.'),
    h('p', { class: 't-prose lede' }, 'a state machine that enforces plan → execute → emit → verify → complete on every task, across 12 platforms. each unknown is named and resolved by witnessed execution.'),
    h('div', { class: 'hero-cta' },
      h('a', { href: './paper.html', class: 'btn-stamp' }, 'read the paper'),
      h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener', class: 'btn-ghost' }, 'source ↗'),
    ),
    h('div', { class: 'hero-install' },
      h('span', { class: 't-label' }, 'install'),
      h('span', { class: 'cmd' }, 'claude plugin marketplace add AnEntrypoint/gm'),
      h('span', { class: 'cmd' }, 'claude plugin install -s user gm@gm'),
    )
  );
}

function ConversationDemo() {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('span', { class: 't-label' }, '§ how a session looks'),
      h('hr', { class: 'rule' })
    ),
    h('p', { class: 't-prose section-lede' }, 'gm intercepts every prompt and enforces the state machine.'),
    h('div', {},
      h('div', { class: 'msg' },
        h('span', { class: 'msg-role user' }, 'you'),
        h('p', { class: 'msg-body' }, 'add dark mode to the settings page'),
      ),
      h('div', { class: 'msg' },
        h('span', { class: 'msg-role thinking' }, '· thinking'),
        h('p', { class: 'msg-body thinking' }, 'invoking planning skill…'),
      ),
      h('div', { class: 'msg' },
        h('span', { class: 'msg-role gm' }, 'gm'),
        h('p', { class: 'msg-body' }, 'writing .gm/prd.yml with 3 items: discover current theme system, implement toggle, verify persistence. launching exec:codesearch to resolve existingImpl=UNKNOWN.'),
      ),
      h('div', { class: 'msg' },
        h('span', { class: 'msg-role tool' }, 'exec:codesearch'),
        h('p', { class: 'msg-body tool' }, 'theme toggle settings → src/settings.js:42 ThemeProvider'),
      ),
      h('div', { class: 'msg' },
        h('span', { class: 'msg-role gm' }, 'gm'),
        h('p', { class: 'msg-body' }, 'all mutables KNOWN. invoking gm-emit → writing files → gm-complete → test.js passes → committed and pushed.'),
      ),
      h('div', { class: 'prompt-row' },
        h('span', { class: 'caret' }, '>'),
        h('span', { class: 'ptext' }, 'what would you like to work on?'),
        h('span', { class: 'cursor' }),
      ),
    )
  );
}

function Principles() {
  return h('section', { id: 'principles', class: 'section' },
    h('div', { class: 'section-head' },
      h('span', { class: 't-label' }, '§ how it works'),
      h('hr', { class: 'rule' })
    ),
    h('p', { class: 't-prose section-lede' }, 'six mechanisms that keep coding sessions on track.'),
    h('div', { class: 'grid-2' },
      ...PRINCIPLES.map(p => h('div', { class: 'card' },
        h('div', { class: 'card-title' }, p.title),
        h('div', { class: 'card-desc' }, p.desc),
      ))
    )
  );
}

function Process() {
  return h('section', { id: 'process', class: 'section' },
    h('div', { class: 'section-head' },
      h('span', { class: 't-label' }, '§ the process'),
      h('hr', { class: 'rule' })
    ),
    h('p', { class: 't-prose section-lede' }, 'five phases, in order. any new unknown sends the session back to plan.'),
    h('ol', { class: 'phase-list' },
      ...PHASES.map((p, i) => h('li', { class: 'phase-row' },
        h('span', { class: 't-label' }, `${String(i + 1).padStart(2, '0')} ${p.name}`),
        h('span', { class: 't-body' }, p.desc),
      ))
    )
  );
}

function Mutable() {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('span', { class: 't-label' }, '§ mutable discipline'),
      h('hr', { class: 'rule' })
    ),
    h('p', { class: 't-prose section-lede' }, 'every assumption is tracked. each one closes only via witnessed execution.'),
    h('div', { class: 'grid-2' },
      ...RULES.map(r => h('div', { class: 'card' },
        h('div', { class: 'card-title' }, r.title),
        h('div', { class: 'card-desc' }, r.desc),
      ))
    )
  );
}

function PlatformsSection() {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('span', { class: 't-label' }, '§ 12 platforms'),
      h('hr', { class: 'rule' })
    ),
    h('p', { class: 't-prose section-lede' }, 'one state machine, every major coding tool.'),
    h('div', { class: 'idx-list' },
      ...PLATFORMS.map(p => h('a', {
        href: `https://AnEntrypoint.github.io/${p.id}`,
        target: '_blank', rel: 'noopener',
        class: 'idx-row'
      },
        h('span', { class: 'idx-mark' }, '›'),
        h('span', { class: 'idx-label' }, p.label.toLowerCase()),
        h('span', { class: 'idx-type' }, p.type),
        h('span', { class: 'idx-tag' }, p.id),
      ))
    )
  );
}

function Footer() {
  return h('footer', { class: 'app-foot' },
    h('div', { class: 'foot-row' },
      h('span', { class: 't-micro' }, 'built with gm — ',
        h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener' }, 'source ↗'),
        ' · ',
        h('a', { href: './paper.html' }, 'paper')
      ),
      h('span', { class: 't-micro' }, 'probably emerging \u{1F300}'),
    )
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

const root = document.getElementById('root') || document.body;
const vnodes = [Topbar(), Dateline(), h('main', { class: 'page' }, Hero(), ConversationDemo(), Principles(), Process(), Mutable(), PlatformsSection()), Footer()];
for (const vnode of vnodes) {
  const el = createDOMElement(vnode);
  if (el) root.appendChild(el);
}
