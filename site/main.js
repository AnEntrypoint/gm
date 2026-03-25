import { createElement as h, applyDiff, Fragment } from "webjsx";

const CLI_PLATFORMS = [
  { id: 'gm-cc', label: 'Claude Code', desc: 'Hooks + agents for Claude Code CLI' },
  { id: 'gm-gc', label: 'Gemini CLI', desc: 'Hooks + agents for Gemini CLI' },
  { id: 'gm-oc', label: 'OpenCode', desc: 'Hooks + agents for OpenCode CLI' },
  { id: 'gm-kilo', label: 'Kilo Code', desc: 'Hooks + agents for Kilo Code CLI' },
  { id: 'gm-codex', label: 'Codex', desc: 'Hooks + agents for Codex CLI' },
  { id: 'gm-copilot-cli', label: 'Copilot CLI', desc: 'Extension for GitHub Copilot CLI' },
];

const IDE_PLATFORMS = [
  { id: 'gm-vscode', label: 'VS Code', desc: 'Extension for Visual Studio Code' },
  { id: 'gm-cursor', label: 'Cursor', desc: 'Extension for Cursor IDE' },
  { id: 'gm-zed', label: 'Zed', desc: 'Extension for Zed Editor (Rust/WASM)' },
  { id: 'gm-jetbrains', label: 'JetBrains', desc: 'Plugin for all JetBrains IDEs' },
];

const PHASES = [
  { name: 'PLAN', desc: 'Write .prd with all unknowns as named items. No work without a plan.' },
  { name: 'EXECUTE', desc: 'Prove every hypothesis via witnessed code execution. Import real modules.' },
  { name: 'EMIT', desc: 'Write files only after all tests pass. Pre and post-emit validation gates.' },
  { name: 'VERIFY', desc: 'End-to-end execution confirms everything works as expected.' },
  { name: 'COMPLETE', desc: '.prd empty, git clean, pushed. Zero unresolved items.' },
];

const GITHUB_ICON = h('svg', { viewBox: '0 0 16 16', class: 'w-5 h-5 fill-current', 'aria-hidden': 'true' },
  h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' })
);

function NavBar() {
  return h('nav', { class: 'border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10' },
    h('div', { class: 'max-w-5xl mx-auto px-4 py-3 flex items-center justify-between' },
      h('span', { class: 'text-white font-bold text-lg tracking-tight' }, 'plugforge'),
      h('div', { class: 'flex items-center gap-4' },
        h('a', {
          href: './paper.html',
          class: 'text-gray-400 hover:text-white transition-colors text-sm'
        }, 'Paper'),
        h('a', {
          href: 'https://github.com/AnEntrypoint/plugforge',
          target: '_blank', rel: 'noopener',
          class: 'flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm'
        }, GITHUB_ICON, 'GitHub')
      )
    )
  );
}

function Hero() {
  return h('section', { class: 'gradient-hero py-28 px-4' },
    h('div', { class: 'max-w-4xl mx-auto text-center' },
      h('span', { class: 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white bg-indigo-600 mb-6' }, 'Convention-Driven Plugin Generator'),
      h('h1', { class: 'text-5xl md:text-7xl font-bold text-white mb-5 tracking-tight' }, 'One source.', h('br', null), h('span', { class: 'text-indigo-400' }, 'Ten platforms.')),
      h('p', { class: 'text-lg text-gray-300 max-w-2xl mx-auto mb-4' },
        'Write your agents, hooks, and skills once in ',
        h('code', { class: 'text-indigo-300 bg-gray-800 px-1.5 py-0.5 rounded text-base' }, 'plugforge-starter/'),
        '. plugforge generates fully working plugins for 6 CLI tools and 4 IDE extensions — automatically.'
      ),
      h('p', { class: 'text-gray-500 max-w-xl mx-auto mb-10 text-sm' },
        'No config files. No registration. Directory structure alone defines behavior. Adding a skill makes it appear in all 10 outputs.'
      ),
      h('a', {
        href: 'https://github.com/AnEntrypoint/plugforge',
        target: '_blank', rel: 'noopener',
        class: 'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-7 py-3 rounded-lg transition-colors text-sm'
      }, GITHUB_ICON, 'View on GitHub')
    )
  );
}

function StateMachineSection() {
  return h('section', { class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, 'State Machine'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm' }, 'Every task runs through five mandatory phases. No shortcuts. No skipped gates.'),
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
            return [card, h('div', { key: `arrow-${i}`, class: 'phase-arrow hidden md:flex items-center justify-center px-1 text-xl' }, '→')];
          }
          return [card];
        })
      )
    )
  );
}

function HowItWorksSection() {
  const steps = [
    { num: '1', title: 'Write once', body: h('span', null, 'Create agents, hooks, and skills in ', h('code', { class: 'text-indigo-300 bg-gray-800 px-1 py-0.5 rounded text-xs' }, 'plugforge-starter/'), '. Directory structure is the only config.') },
    { num: '2', title: 'Run npx gm-builder', body: h('span', null, 'plugforge adapts your source for every platform. Clean build every time — no stale files, no silent failures.') },
    { num: '3', title: 'GitHub Actions publishes', body: h('span', null, 'All 10 outputs pushed automatically. rsync --delete removes orphaned files from every target repo.') },
  ];
  return h('section', { class: 'py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-10 text-center' }, 'How It Works'),
      h('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-6' },
        ...steps.map(s => h('div', { key: s.num, class: 'card-hover bg-gray-900 border border-gray-800 rounded-xl p-6' },
          h('div', { class: 'w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold text-white mb-4' }, s.num),
          h('h3', { class: 'font-semibold text-white mb-2' }, s.title),
          h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, s.body)
        ))
      )
    )
  );
}

function PlatformCard({ p, isCLI }) {
  return h('a', {
    href: `https://AnEntrypoint.github.io/${p.id}`,
    target: '_blank', rel: 'noopener',
    class: 'card-hover block bg-gray-900 border border-gray-800 rounded-xl p-5 no-underline'
  },
    h('div', { class: 'flex items-start justify-between mb-2' },
      h('span', { class: 'font-semibold text-white text-sm' }, p.label),
      h('span', {
        class: `text-xs px-2 py-0.5 rounded-full font-medium ${isCLI ? 'bg-blue-900/60 text-blue-300' : 'bg-purple-900/60 text-purple-300'}`
      }, isCLI ? 'CLI' : 'IDE')
    ),
    h('p', { class: 'text-gray-400 text-xs leading-relaxed' }, p.desc)
  );
}

function PlatformsSection() {
  return h('section', { class: 'py-20 px-4 bg-gray-900/40' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-3 text-center' }, '10 Generated Platforms'),
      h('p', { class: 'text-gray-400 text-center mb-10 text-sm' }, 'Every platform is generated from the same source. Click any to visit its page.'),
      h('div', { class: 'mb-8' },
        h('p', { class: 'text-xs font-semibold text-blue-400 uppercase tracking-wider mb-4' }, 'CLI Tools'),
        h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' },
          ...CLI_PLATFORMS.map(p => h(PlatformCard, { p, isCLI: true, key: p.id }))
        )
      ),
      h('div', null,
        h('p', { class: 'text-xs font-semibold text-purple-400 uppercase tracking-wider mb-4' }, 'IDE Extensions'),
        h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4' },
          ...IDE_PLATFORMS.map(p => h(PlatformCard, { p, isCLI: false, key: p.id }))
        )
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm' },
    h('p', null,
      'Generated by plugforge — ',
      h('a', { href: 'https://github.com/AnEntrypoint/plugforge', target: '_blank', rel: 'noopener', class: 'text-indigo-400 hover:text-indigo-300 transition-colors' }, 'github.com/AnEntrypoint/plugforge')
    )
  );
}

function App() {
  return h(Fragment, null,
    h(NavBar, null),
    h(Hero, null),
    h(StateMachineSection, null),
    h(HowItWorksSection, null),
    h(PlatformsSection, null),
    h(Footer, null)
  );
}

applyDiff(document.body, [h(App, null)]);