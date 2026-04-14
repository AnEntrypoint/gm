import { createElement as h, createDOMElement } from "webjsx";

const PHASES = [
  { name: 'PLAN', desc: 'List every unknown. Write a .prd with acceptance criteria. Nothing runs without a plan.' },
  { name: 'EXECUTE', desc: 'Run code against real services. Hypotheses are resolved by output, not by reading docs.' },
  { name: 'EMIT', desc: 'Write files only after pre-emit checks pass. Verify output from disk before moving on.' },
  { name: 'VERIFY', desc: 'End-to-end execution. Real services, real data, real timing — no stubs.' },
  { name: 'COMPLETE', desc: '.prd empty, git clean, pushed. Work does not end while anything is unresolved.' },
];

const PRINCIPLES = [
  { title: 'JIT Execution', desc: 'Shell calls are intercepted, languages auto-detected, long tasks backgrounded. Code runs in a managed lifecycle — hypotheses get proven before files change.' },
  { title: '1-Shot Overviews', desc: 'AST parsing delivers codebase structure, complexity metrics, and known caveats before the first prompt. No iterative exploration needed.' },
  { title: 'Semantic Search', desc: 'Local vector search finds code by intent. Results are compact enough to fit in context without summarization.' },
  { title: 'Closed-Loop Testing', desc: 'Ideas run via JIT execution against the live codebase. Client and server validated inline. No test files written to disk.' },
  { title: 'Lang Plugins', desc: 'A single CommonJS file at lang/<id>.js wires any runtime into exec dispatch, LSP diagnostics, and context injection. Hooks auto-discover it — no config changes.' },
  { title: 'Context Reduction', desc: 'Install only what the project needs. A skill tree routes the agent through proven steps without bloated system prompts or redundant scaffolding.' },
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

const GITHUB_ICON = h('svg', { viewBox: '0 0 16 16', class: 'w-5 h-5 fill-current', 'aria-hidden': 'true' },
  h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' })
);

function NavBar() {
  return h('nav', { class: 'navbar navbar-sticky navbar-bordered', style: 'background:#0f172a;border-bottom:1px solid rgba(99,102,241,0.2);' },
    h('div', { class: 'max-w-5xl mx-auto px-4 w-full flex items-center justify-between' },
      h('span', { class: 'text-white font-bold text-lg tracking-tight' }, 'gm'),
      h('div', { class: 'flex items-center gap-4' },
        h('a', { href: '#principles', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Principles'),
        h('a', { href: '#process', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Process'),
        h('a', { href: './stats.html', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Stats'),
        h('a', { href: './made-with.html', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Made with gm'),
        h('a', { href: './paper.html', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Paper I'),
        h('a', { href: './paper2.html', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Paper II'),
        h('a', {
          href: 'https://github.com/AnEntrypoint/gm',
          target: '_blank', rel: 'noopener',
          class: 'flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm'
        }, GITHUB_ICON, 'Source')
      )
    )
  );
}

function Hero() {
  return h('section', { class: 'gradient-hero py-28 px-4' },
    h('div', { class: 'max-w-4xl mx-auto text-center' },
      h('span', { class: 'badge badge-primary mb-6' }, 'Immutable Programming'),
      h('h1', { class: 'text-5xl md:text-7xl font-bold text-white mb-5 tracking-tight' },
        'Ship code that works.', h('br', null), h('span', { class: 'text-indigo-400' }, 'Every time.')
      ),
      h('p', { class: 'text-lg text-gray-300 max-w-2xl mx-auto mb-4' },
        'gm is a state machine that enforces a strict work cycle — plan, execute, emit, verify, complete — on every task, across 11 platforms.'
      ),
      h('p', { class: 'text-gray-500 max-w-xl mx-auto mb-10 text-sm' },
        'Each unknown is named and resolved by code, not guesswork. Work cannot end while anything is unresolved.'
      ),
      h('div', { class: 'flex gap-4 justify-center' },
        h('a', { href: './paper.html', class: 'btn btn-primary' }, 'Read the Paper'),
        h('a', {
          href: 'https://github.com/AnEntrypoint/gm',
          target: '_blank', rel: 'noopener',
          class: 'btn btn-outline flex items-center gap-2'
        }, GITHUB_ICON, 'Source')
      )
    )
  );
}

function PrinciplesSection() {
  return h('section', { id: 'principles', class: 'py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'How It Works'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm max-w-2xl mx-auto' },
        'Six mechanisms that keep coding sessions on track. Each one cuts a specific failure mode.'
      ),
      h('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' },
        ...PRINCIPLES.map((p, i) => h('div', { key: i, class: 'card bg-gray-900 border border-gray-800' },
          h('div', { class: 'card-body' },
            h('h3', { class: 'font-semibold text-white' }, p.title),
            h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, p.desc)
          )
        ))
      )
    )
  );
}

function ProcessSection() {
  return h('section', { id: 'process', class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'The Process'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm max-w-2xl mx-auto' },
        'Five phases, in order. Any new unknown sends the session back to PLAN.'
      ),
      h('div', { class: 'flex flex-col md:flex-row items-stretch gap-2' },
        ...PHASES.flatMap((phase, i) => {
          const card = h('div', { key: phase.name, class: 'card bg-gray-900 border border-gray-800 flex-1' },
            h('div', { class: 'card-body' },
              h('div', { class: 'text-xs font-bold text-indigo-400 uppercase tracking-widest' }, `0${i + 1}`),
              h('div', { class: 'text-base font-bold text-white' }, phase.name),
              h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, phase.desc)
            )
          );
          if (i < PHASES.length - 1) {
            return [card, h('div', { key: `arrow-${i}`, class: 'hidden md:flex items-center justify-center px-1 text-indigo-400 text-xl' }, '\u2192')];
          }
          return [card];
        })
      )
    )
  );
}

function MutableSection() {
  const rules = [
    { title: 'Name every unknown', desc: 'Before touching anything, declare what you don\'t know. apiShape=UNKNOWN, fileExists=UNKNOWN. Named unknowns get resolved; unnamed ones cause bugs.' },
    { title: 'Witnessed execution only', desc: 'A mutable closes when real code runs and produces real output. Inference and doc-reading don\'t count.' },
    { title: 'Two-pass limit', desc: 'If a mutable is still open after two attempts, it becomes a fresh unknown and the session resets to PLAN.' },
    { title: 'Divergence triggers replanning', desc: 'Whenever output differs from expectation, a new mutable is opened and replanning starts before any further edits.' },
  ];
  return h('section', { class: 'py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'Mutable Discipline'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm max-w-2xl mx-auto' },
        'Every assumption is tracked as a mutable. Each one closes only via witnessed execution.'
      ),
      h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-6' },
        ...rules.map((r, i) => h('div', { key: i, class: 'card bg-gray-900 border border-gray-800' },
          h('div', { class: 'card-body' },
            h('h3', { class: 'font-semibold text-white' }, r.title),
            h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, r.desc)
          )
        ))
      )
    )
  );
}

function PlatformsSection() {
  return h('section', { class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, '11 Platforms'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm' }, 'One state machine, every major coding tool.'),
      h('div', { class: 'flex flex-wrap justify-center gap-3' },
        ...PLATFORMS.map(p => h('a', {
          key: p.id,
          href: `https://AnEntrypoint.github.io/${p.id}`,
          target: '_blank', rel: 'noopener',
          class: `badge ${p.type === 'CLI' ? 'badge-outline-primary' : 'badge-outline-secondary'} text-sm px-4 py-2 no-underline`
        }, p.label, h('span', { class: 'ml-1 opacity-60 text-xs' }, p.type)))
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm' },
    h('p', null,
      'Built with ',
      h('a', { href: 'https://github.com/AnEntrypoint/gm', target: '_blank', rel: 'noopener', class: 'text-indigo-400 hover:text-indigo-300 transition-colors' }, 'gm'),
      ' · ',
      h('a', { href: './paper.html', class: 'text-indigo-400 hover:text-indigo-300 transition-colors' }, 'Read the paper')
    )
  );
}

window.__debug = { PHASES, PRINCIPLES, PLATFORMS };

const sections = [NavBar(), Hero(), PrinciplesSection(), ProcessSection(), MutableSection(), PlatformsSection(), Footer()];
for (const vnode of sections) {
  const el = createDOMElement(vnode);
  if (el) document.body.appendChild(el);
}
