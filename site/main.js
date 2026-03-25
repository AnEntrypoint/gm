import { createElement as h, createDOMElement, Fragment } from "webjsx";

const PHASES = [
  { name: 'PLAN', desc: 'Name every unknown. Build a .prd with acceptance criteria. No work without a plan.' },
  { name: 'EXECUTE', desc: 'Resolve unknowns through witnessed code execution only. No speculation, no narration.' },
  { name: 'EMIT', desc: 'Write files after pre-emit validation passes. Post-emit verification from disk confirms output.' },
  { name: 'VERIFY', desc: 'End-to-end witnessed execution. Real services, real data, real timing.' },
  { name: 'COMPLETE', desc: '.prd empty, git clean, pushed. Session cannot end with unresolved work.' },
];

const PRINCIPLES = [
  { title: 'JIT Execution', desc: 'Code runs through a managed lifecycle (gm-exec) that intercepts shell calls, auto-detects languages, and backgrounds long tasks. Agents prove hypotheses before editing files.' },
  { title: '1-Shot Overviews', desc: 'Compact codebase analysis via AST parsing (tree-sitter) delivers structure, complexity, and caveats on first prompt. No exploration phase needed.' },
  { title: 'Semantic Search', desc: 'Local vector-based codebase search finds relevant code by intent, not just string matching. Compact results that fit in context.' },
  { title: 'Closed-Loop Testing', desc: 'Agents test ideas via JIT execution without editing the codebase. Validate client and server side through further execution. No test files on disk.' },
  { title: 'Context Reduction', desc: 'Only install tools you need. A tested skill tree guides the agent through proven steps. No bloated system prompts.' },
  { title: 'Repo Reduction', desc: 'Deduplicate all concerns including cross-domain: unit tests replaced by agentic closed-loop testing, comments removed, specs consolidated.' },
];

const CLI_PLATFORMS = [
  { id: 'gm-cc', label: 'Claude Code' },
  { id: 'gm-gc', label: 'Gemini CLI' },
  { id: 'gm-oc', label: 'OpenCode' },
  { id: 'gm-kilo', label: 'Kilo Code' },
  { id: 'gm-codex', label: 'Codex' },
  { id: 'gm-copilot-cli', label: 'Copilot CLI' },
];

const IDE_PLATFORMS = [
  { id: 'gm-vscode', label: 'VS Code' },
  { id: 'gm-cursor', label: 'Cursor' },
  { id: 'gm-zed', label: 'Zed' },
  { id: 'gm-jetbrains', label: 'JetBrains' },
];

const GITHUB_ICON = h('svg', { viewBox: '0 0 16 16', class: 'w-5 h-5 fill-current', 'aria-hidden': 'true' },
  h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' })
);

function NavBar() {
  return h('nav', { class: 'border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10' },
    h('div', { class: 'max-w-5xl mx-auto px-4 py-3 flex items-center justify-between' },
      h('span', { class: 'text-white font-bold text-lg tracking-tight' }, 'gm'),
      h('div', { class: 'flex items-center gap-4' },
        h('a', { href: '#principles', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Principles'),
        h('a', { href: '#state-machine', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'State Machine'),
        h('a', { href: './paper.html', class: 'text-gray-400 hover:text-white transition-colors text-sm' }, 'Paper'),
        h('a', {
          href: 'https://github.com/AnEntrypoint/plugforge',
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
      h('span', { class: 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white bg-indigo-600 mb-6' }, 'Immutable Programming'),
      h('h1', { class: 'text-5xl md:text-7xl font-bold text-white mb-5 tracking-tight' },
        'Control the agent.', h('br', null), h('span', { class: 'text-indigo-400' }, 'Not the other way around.')
      ),
      h('p', { class: 'text-lg text-gray-300 max-w-2xl mx-auto mb-4' },
        'A state machine framework for agentic coding that enforces lifecycle phases, names every unknown, and requires witnessed execution before writing code.'
      ),
      h('p', { class: 'text-gray-500 max-w-xl mx-auto mb-10 text-sm' },
        'No silent assumptions. No skipped verification. No premature completion. Available across 10 platforms.'
      ),
      h('div', { class: 'flex gap-4 justify-center' },
        h('a', {
          href: './paper.html',
          class: 'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-7 py-3 rounded-lg transition-colors text-sm'
        }, 'Read the Paper'),
        h('a', {
          href: 'https://github.com/AnEntrypoint/plugforge',
          target: '_blank', rel: 'noopener',
          class: 'inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold px-7 py-3 rounded-lg transition-colors text-sm border border-gray-700'
        }, GITHUB_ICON, 'Source')
      )
    )
  );
}

function PrinciplesSection() {
  return h('section', { id: 'principles', class: 'py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'Core Principles'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm max-w-2xl mx-auto' },
        'Six techniques that make LLM coding agents reliable. Each addresses a specific failure mode in unconstrained agentic systems.'
      ),
      h('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' },
        ...PRINCIPLES.map((p, i) => h('div', { key: i, class: 'card-hover bg-gray-900 border border-gray-800 rounded-xl p-6' },
          h('h3', { class: 'font-semibold text-white mb-2' }, p.title),
          h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, p.desc)
        ))
      )
    )
  );
}

function StateMachineSection() {
  return h('section', { id: 'state-machine', class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'The State Machine'),
      h('p', { class: 'text-gray-400 text-center mb-4 text-sm max-w-2xl mx-auto' },
        'Every task progresses through five mandatory phases. New unknowns at any phase trigger a backward transition to PLAN. Forward progress requires all conditions to hold simultaneously.'
      ),
      h('p', { class: 'text-gray-500 text-center mb-10 text-xs' },
        'Snakes and Ladders: climb by satisfying conditions, slide back when assumptions break.'
      ),
      h('div', { class: 'flex flex-col md:flex-row items-stretch gap-0 md:gap-0' },
        ...PHASES.flatMap((phase, i) => {
          const card = h('div', {
            key: phase.name,
            class: 'card-hover flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col'
          },
            h('div', { class: 'text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2' }, `0${i + 1}`),
            h('div', { class: 'text-base font-bold text-white mb-3' }, phase.name),
            h('p', { class: 'text-gray-400 text-sm leading-relaxed flex-1' }, phase.desc)
          );
          if (i < PHASES.length - 1) {
            return [card, h('div', { key: `arrow-${i}`, class: 'phase-arrow hidden md:flex items-center justify-center px-1 text-xl' }, '\u2192')];
          }
          return [card];
        })
      )
    )
  );
}

function MutableDisciplineSection() {
  const rules = [
    { title: 'Name every unknown', desc: 'Before acting, declare what you don\'t know. apiShape=UNKNOWN, fileExists=UNKNOWN. No unnamed assumptions.' },
    { title: 'Witnessed execution only', desc: 'A mutable is resolved when real code runs against real services and produces real output. Reading docs or reasoning doesn\'t count.' },
    { title: 'Two-pass rule', desc: 'If a mutable remains unresolved after two attempts, it becomes a new unknown and the agent snakes back to PLAN.' },
    { title: 'No silent surprises', desc: 'Unexpected output is never absorbed silently. Every discrepancy generates a new named mutable and triggers re-planning.' },
  ];
  return h('section', { class: 'py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'The Mutable Discipline'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm max-w-2xl mx-auto' },
        'The central enforcement mechanism. Agents must confront uncertainty explicitly rather than generating plausible-but-unverified code.'
      ),
      h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-6' },
        ...rules.map((r, i) => h('div', { key: i, class: 'card-hover bg-gray-900 border border-gray-800 rounded-xl p-6' },
          h('h3', { class: 'font-semibold text-white mb-2' }, r.title),
          h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, r.desc)
        ))
      )
    )
  );
}

function PlatformsSection() {
  const allPlatforms = [...CLI_PLATFORMS.map(p => ({...p, type: 'CLI'})), ...IDE_PLATFORMS.map(p => ({...p, type: 'IDE'}))];
  return h('section', { class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'Available Everywhere'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm' }, 'The same agent behavior, enforced across 10 platforms.'),
      h('div', { class: 'flex flex-wrap justify-center gap-3' },
        ...allPlatforms.map(p => h('a', {
          key: p.id,
          href: `https://AnEntrypoint.github.io/${p.id}`,
          target: '_blank', rel: 'noopener',
          class: `inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors no-underline ${p.type === 'CLI' ? 'bg-blue-950/40 border-blue-800/50 text-blue-300 hover:bg-blue-900/40' : 'bg-purple-950/40 border-purple-800/50 text-purple-300 hover:bg-purple-900/40'}`
        },
          h('span', null, p.label),
          h('span', { class: 'text-xs opacity-60' }, p.type)
        ))
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm' },
    h('p', null,
      'Built with ',
      h('a', { href: 'https://github.com/AnEntrypoint/plugforge', target: '_blank', rel: 'noopener', class: 'text-indigo-400 hover:text-indigo-300 transition-colors' }, 'plugforge'),
      ' \u2014 ',
      h('a', { href: './paper.html', class: 'text-indigo-400 hover:text-indigo-300 transition-colors' }, 'Read the paper')
    )
  );
}

const sections = [NavBar(), Hero(), PrinciplesSection(), StateMachineSection(), MutableDisciplineSection(), PlatformsSection(), Footer()];
for (const vnode of sections) {
  const el = createDOMElement(vnode);
  if (el) document.body.appendChild(el);
}
