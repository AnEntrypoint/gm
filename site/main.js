import { createElement as h, createDOMElement } from "webjsx";

const PHASES = [
  { name: 'PLAN', desc: 'List every unknown. Write .gm/prd.yml with acceptance criteria. Nothing runs without a plan.' },
  { name: 'EXECUTE', desc: 'Run code against real services. Hypotheses resolved by output, not docs.' },
  { name: 'EMIT', desc: 'Write files only after pre-emit checks pass. Verify from disk.' },
  { name: 'VERIFY', desc: 'End-to-end execution. Real services, real data, real timing.' },
  { name: 'COMPLETE', desc: '.gm/prd.yml empty, test.js passes, git clean, pushed.' },
];

const PRINCIPLES = [
  { title: 'JIT Execution', desc: 'Shell calls intercepted, languages auto-detected, long tasks backgrounded. Code runs in managed lifecycle.' },
  { title: '1-Shot Overviews', desc: 'AST parsing delivers codebase structure, complexity metrics, and caveats before first prompt.' },
  { title: 'Semantic Search', desc: 'Local vector search finds code by intent. Compact results fit in context without summarization.' },
  { title: 'Single Test Policy', desc: 'One test.js at project root, 200L max. Bug fixes become regression cases. Replaces all unit tests.' },
  { title: 'Lang Plugins', desc: 'A CommonJS file at lang/<id>.js wires any runtime into exec dispatch, LSP diagnostics, and context injection.' },
  { title: 'Context Reduction', desc: 'Install only what the project needs. Skill tree routes agent through proven steps.' },
];

const PLATFORMS = [
  { id: 'gm-cc', label: 'Claude Code', type: 'CLI' },
  { id: 'gm-gc', label: 'Gemini CLI', type: 'CLI' },
  { id: 'gm-oc', label: 'OpenCode', type: 'CLI' },
  { id: 'gm-kilo', label: 'Kilo Code', type: 'CLI' },
  { id: 'gm-codex', label: 'Codex', type: 'CLI' },
  { id: 'gm-copilot-cli', label: 'Copilot CLI', type: 'CLI' },
  { id: 'gm-qwen', label: 'Qwen Code', type: 'CLI' },
  { id: 'gm-vscode', label: 'VS Code', type: 'IDE' },
  { id: 'gm-cursor', label: 'Cursor', type: 'IDE' },
  { id: 'gm-zed', label: 'Zed', type: 'IDE' },
  { id: 'gm-jetbrains', label: 'JetBrains', type: 'IDE' },
];

const RULES = [
  { title: 'Name every unknown', desc: 'apiShape=UNKNOWN, fileExists=UNKNOWN. Named unknowns get resolved; unnamed ones cause bugs.' },
  { title: 'Witnessed execution only', desc: 'A mutable closes when real code runs and produces real output. Inference doesn\'t count.' },
  { title: 'Two-pass limit', desc: 'Still open after two attempts \u2192 fresh unknown \u2192 session resets to PLAN.' },
  { title: 'Divergence \u2192 replan', desc: 'Output differs from expectation \u2192 new mutable \u2192 replanning before any further edits.' },
];

function NavBar() {
  const links = [
    ['#principles', 'Principles'],
    ['#process', 'Process'],
    ['./stats.html', 'Stats'],
    ['./made-with.html', 'Showcase'],
    ['./paper.html', 'Paper I'],
    ['./paper2.html', 'Paper II'],
    ['https://github.com/AnEntrypoint/gm', 'GitHub'],
  ];
  return h('nav', { class: 'cc-nav' },
    h('div', { class: 'cc-nav-inner' },
      h('a', { href: '#', class: 'cc-logo' }, 'gm'),
      h('div', { class: 'cc-nav-links' },
        ...links.map(([href, label]) =>
          h('a', { href, class: 'cc-nav-link', ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, label)
        )
      )
    )
  );
}

function Hero() {
  return h('section', { class: 'cc-hero' },
    h('div', { class: 'cc-wrap' },
      h('h1', null, 'Ship code that works.', h('br'), h('span', null, 'Every time.')),
      h('p', { class: 'cc-hero-sub' },
        'A state machine that enforces plan \u2192 execute \u2192 emit \u2192 verify \u2192 complete on every task, across 11 platforms. Each unknown is named and resolved by code.'
      ),
      h('div', { class: 'cc-hero-actions' },
        h('a', { href: './paper.html', class: 'cc-btn-primary' }, 'Read the Paper'),
        h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener', class: 'cc-btn-ghost' }, 'View Source'),
      ),
      h('div', { class: 'cc-install' },
        h('div', { class: 'cc-install-label' }, 'Install'),
        h('div', { class: 'cc-install-line' }, 'claude plugin marketplace add AnEntrypoint/gm'),
        h('div', { class: 'cc-install-line' }, 'claude plugin install -s user gm@gm'),
      )
    )
  );
}

function ConversationDemo() {
  return h('section', { class: 'cc-section' },
    h('div', { class: 'cc-wrap' },
      h('h2', { class: 'cc-section-title' }, 'How a session looks'),
      h('p', { class: 'cc-section-sub' }, 'gm intercepts every prompt and enforces the state machine.'),

      h('div', { class: 'cc-msg cc-msg-user' },
        h('div', { class: 'cc-msg-label cc-msg-label-user' }, 'You'),
        h('p', null, 'add dark mode to the settings page')
      ),

      h('div', { class: 'cc-thinking' }, 'Invoking planning skill...'),

      h('div', { class: 'cc-msg cc-msg-assistant' },
        h('div', { class: 'cc-msg-label cc-msg-label-assistant' }, 'gm'),
        h('p', null, 'Writing .gm/prd.yml with 3 items: discover current theme system, implement toggle, verify persistence. Launching exec:codesearch to resolve existingImpl=UNKNOWN.')
      ),

      h('div', { class: 'cc-msg cc-msg-tool' },
        h('div', { class: 'cc-msg-label cc-msg-label-tool' }, 'exec:codesearch'),
        h('p', null, 'theme toggle settings \u2192 src/settings.js:42 ThemeProvider')
      ),

      h('div', { class: 'cc-msg cc-msg-assistant' },
        h('div', { class: 'cc-msg-label cc-msg-label-assistant' }, 'gm'),
        h('p', null, 'All mutables KNOWN. Invoking gm-emit \u2192 writing files \u2192 gm-complete \u2192 test.js passes \u2192 committed and pushed.')
      ),

      h('div', { class: 'cc-prompt' },
        h('span', { class: 'cc-prompt-caret' }, '>'),
        h('span', { class: 'cc-prompt-text' }, 'What would you like to work on?'),
        h('span', { class: 'cc-cursor' }),
      )
    )
  );
}

function PrinciplesSection() {
  return h('section', { id: 'principles', class: 'cc-section' },
    h('div', { class: 'cc-wrap' },
      h('h2', { class: 'cc-section-title' }, 'How It Works'),
      h('p', { class: 'cc-section-sub' }, 'Six mechanisms that keep coding sessions on track.'),
      h('div', { class: 'cc-grid' },
        ...PRINCIPLES.map(p =>
          h('div', { class: 'cc-card' },
            h('div', { class: 'cc-card-title' }, p.title),
            h('div', { class: 'cc-card-desc' }, p.desc)
          )
        )
      )
    )
  );
}

function ProcessSection() {
  return h('section', { id: 'process', class: 'cc-section' },
    h('div', { class: 'cc-wrap' },
      h('h2', { class: 'cc-section-title' }, 'The Process'),
      h('p', { class: 'cc-section-sub' }, 'Five phases, in order. Any new unknown sends the session back to PLAN.'),
      h('div', { class: 'cc-process' },
        ...PHASES.map((phase, i) =>
          h('div', { class: 'cc-phase' },
            h('span', { class: 'cc-status cc-status-info', style: 'min-width:24px;' },
              h('span', { class: 'cc-status-dot' }, '◇')
            ),
            h('span', { class: 'cc-phase-name' }, phase.name),
            h('span', { class: 'cc-phase-desc' }, phase.desc),
          )
        )
      )
    )
  );
}

function MutableSection() {
  return h('section', { class: 'cc-section' },
    h('div', { class: 'cc-wrap' },
      h('h2', { class: 'cc-section-title' }, 'Mutable Discipline'),
      h('p', { class: 'cc-section-sub' }, 'Every assumption is tracked. Each one closes only via witnessed execution.'),
      h('div', { class: 'cc-grid' },
        ...RULES.map(r =>
          h('div', { class: 'cc-card' },
            h('div', { class: 'cc-card-title' }, r.title),
            h('div', { class: 'cc-card-desc' }, r.desc)
          )
        )
      )
    )
  );
}

function PlatformsSection() {
  const cliPlatforms = PLATFORMS.filter(p => p.type === 'CLI');
  const idePlatforms = PLATFORMS.filter(p => p.type === 'IDE');

  return h('section', { class: 'cc-section' },
    h('div', { class: 'cc-wrap' },
      h('h2', { class: 'cc-section-title' }, '11 Platforms'),
      h('p', { class: 'cc-section-sub' }, 'One state machine, every major coding tool.'),

      h('div', null,
        h('h3', { style: 'font-size:14px;color:#8888a0;font-weight:600;margin:20px 0 12px;text-transform:uppercase;letter-spacing:0.8px;' }, 'CLI Tools'),
        h('div', { class: 'cc-platforms-grid', style: 'margin-bottom:24px;' },
          ...cliPlatforms.map(p =>
            h('a', {
              href: `https://AnEntrypoint.github.io/${p.id}`,
              target: '_blank', rel: 'noopener',
              class: 'cc-badge cc-badge-cli'
            }, p.label)
          )
        ),

        h('h3', { style: 'font-size:14px;color:#8888a0;font-weight:600;margin:20px 0 12px;text-transform:uppercase;letter-spacing:0.8px;' }, 'IDE Extensions'),
        h('div', { class: 'cc-platforms-grid' },
          ...idePlatforms.map(p =>
            h('a', {
              href: `https://AnEntrypoint.github.io/${p.id}`,
              target: '_blank', rel: 'noopener',
              class: 'cc-badge cc-badge-ide'
            }, p.label)
          )
        )
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'cc-footer' },
    h('div', { class: 'cc-wrap' },
      h('p', null,
        'Built with ',
        h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener' }, 'gm'),
        ' \u00b7 ',
        h('a', { href: './paper.html' }, 'Read the paper'),
      )
    )
  );
}

window.__debug = { PHASES, PRINCIPLES, PLATFORMS, RULES };

const sections = [NavBar(), Hero(), ConversationDemo(), PrinciplesSection(), ProcessSection(), MutableSection(), PlatformsSection(), Footer()];
for (const vnode of sections) {
  const el = createDOMElement(vnode);
  if (el) document.body.appendChild(el);
}
