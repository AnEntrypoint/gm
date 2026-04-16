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
  { title: 'Two-pass limit', desc: 'Still open after two attempts → fresh unknown → session resets to PLAN.' },
  { title: 'Divergence → replan', desc: 'Output differs from expectation → new mutable → replanning before any further edits.' },
];

function box(title, content, width) {
  const w = width || 'w-full';
  return h('div', { class: `tui-box ${w}` },
    title ? h('div', { class: 'tui-box-title' }, `[ ${title} ]`) : null,
    h('div', { class: 'tui-box-body' }, content)
  );
}

function NavBar() {
  const links = [
    ['#principles', 'Principles'],
    ['#process', 'Process'],
    ['./stats.html', 'Stats'],
    ['./made-with.html', 'Made with gm'],
    ['./paper.html', 'Paper I'],
    ['./paper2.html', 'Paper II'],
    ['https://github.com/AnEntrypoint/gm', 'Source'],
  ];
  return h('nav', { class: 'tui-nav' },
    h('div', { class: 'tui-nav-inner' },
      h('span', { class: 'tui-prompt' }, 'gm@main:~$'),
      h('div', { class: 'tui-nav-links' },
        ...links.map(([href, label]) =>
          h('a', { href, class: 'tui-link', ...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) }, label)
        )
      )
    )
  );
}

function Hero() {
  return h('section', { class: 'tui-hero' },
    h('pre', { class: 'tui-ascii' },
`                     ___
  __ _ _ __ ___     / _ \\_ __ ___
 / _\` | '_ \` _ \\   | | | '_ \` _ \\
| (_| | | | | | |  | |_| | | | | |
 \\__, |_| |_| |_|   \\___/|_| |_| |_|
 |___/`),
    h('div', { class: 'tui-hero-text' },
      h('p', { class: 'tui-green' }, 'State machine for coding agents.'),
      h('p', { class: 'tui-dim' }, 'Enforces PLAN → EXECUTE → EMIT → VERIFY → COMPLETE across 11 platforms.'),
      h('p', { class: 'tui-dim' }, 'Each unknown is named and resolved by code, not guesswork.'),
    ),
    h('div', { class: 'tui-hero-actions' },
      h('span', { class: 'tui-prompt-sm' }, '$'),
      h('a', { href: './paper.html', class: 'tui-cmd' }, 'cat paper.md'),
      h('span', { class: 'tui-sep' }, '|'),
      h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener', class: 'tui-cmd' }, 'git clone gm'),
    )
  );
}

function PrinciplesSection() {
  return h('section', { id: 'principles', class: 'tui-section' },
    box('HOW IT WORKS',
      h('div', { class: 'tui-grid-2' },
        ...PRINCIPLES.map((p, i) =>
          h('div', { class: 'tui-item' },
            h('span', { class: 'tui-green' }, `[${i + 1}] ${p.title}`),
            h('span', { class: 'tui-dim' }, p.desc)
          )
        )
      )
    )
  );
}

function ProcessSection() {
  return h('section', { id: 'process', class: 'tui-section' },
    box('THE PROCESS',
      h('div', { class: 'tui-process' },
        ...PHASES.flatMap((phase, i) => {
          const node = h('div', { class: 'tui-phase' },
            h('div', { class: 'tui-phase-header' },
              h('span', { class: 'tui-amber' }, `0${i + 1}`),
              h('span', { class: 'tui-green tui-bold' }, phase.name),
            ),
            h('div', { class: 'tui-dim tui-phase-desc' }, phase.desc)
          );
          if (i < PHASES.length - 1) {
            return [node, h('div', { class: 'tui-arrow' }, '───▶')];
          }
          return [node];
        })
      )
    )
  );
}

function MutableSection() {
  return h('section', { class: 'tui-section' },
    box('MUTABLE DISCIPLINE',
      h('div', { class: 'tui-grid-2' },
        ...RULES.map((r, i) =>
          h('div', { class: 'tui-item' },
            h('span', { class: 'tui-amber' }, `▸ ${r.title}`),
            h('span', { class: 'tui-dim' }, r.desc)
          )
        )
      )
    )
  );
}

function PlatformsSection() {
  return h('section', { class: 'tui-section' },
    box('PLATFORMS',
      h('div', { class: 'tui-platforms' },
        h('div', { class: 'tui-platform-row' },
          h('span', { class: 'tui-dim' }, 'CLI  '),
          ...PLATFORMS.filter(p => p.type === 'CLI').map(p =>
            h('a', { href: `https://AnEntrypoint.github.io/${p.id}`, target: '_blank', rel: 'noopener', class: 'tui-platform-link' },
              `[${p.label}]`
            )
          )
        ),
        h('div', { class: 'tui-platform-row' },
          h('span', { class: 'tui-dim' }, 'IDE  '),
          ...PLATFORMS.filter(p => p.type === 'IDE').map(p =>
            h('a', { href: `https://AnEntrypoint.github.io/${p.id}`, target: '_blank', rel: 'noopener', class: 'tui-platform-link' },
              `[${p.label}]`
            )
          )
        )
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'tui-footer' },
    h('span', { class: 'tui-dim' }, '─'.repeat(60)),
    h('p', { class: 'tui-dim' },
      'Built with ',
      h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener', class: 'tui-link' }, 'gm'),
      ' · ',
      h('a', { href: './paper.html', class: 'tui-link' }, 'Read the paper')
    ),
    h('span', { class: 'tui-dim' }, '─'.repeat(60)),
  );
}

window.__debug = { PHASES, PRINCIPLES, PLATFORMS, RULES };

const sections = [NavBar(), Hero(), PrinciplesSection(), ProcessSection(), MutableSection(), PlatformsSection(), Footer()];
for (const vnode of sections) {
  const el = createDOMElement(vnode);
  if (el) document.body.appendChild(el);
}
