const CLI_PLATFORMS = [
  { name: 'cc', label: 'Claude Code' },
  { name: 'gc', label: 'Gemini CLI' },
  { name: 'oc', label: 'OpenCode' },
  { name: 'kilo', label: 'Kilo Code' },
  { name: 'codex', label: 'Codex CLI' },
  { name: 'copilot-cli', label: 'Copilot CLI' }
];

const IDE_PLATFORMS = [
  { name: 'vscode', label: 'VS Code' },
  { name: 'cursor', label: 'Cursor' },
  { name: 'zed', label: 'Zed' },
  { name: 'jetbrains', label: 'JetBrains' }
];

function generateCrossLinks(currentPlatform) {
  const renderGroup = (title, platforms) => {
    const items = platforms.map(p => {
      const isActive = p.name === currentPlatform;
      const cls = isActive
        ? 'active px-3 py-1 rounded-full bg-indigo-600 text-white text-xs font-semibold'
        : 'px-3 py-1 rounded-full bg-gray-800 text-gray-300 text-xs hover:bg-gray-700 transition-colors';
      return `<a href="https://anentrypoint.github.io/gm-${p.name}" class="${cls}">${p.label}</a>`;
    }).join('\n        ');
    return `<div class="mb-4">
      <p class="text-gray-500 text-xs uppercase tracking-wider mb-2">${title}</p>
      <div class="flex flex-wrap gap-2">
        ${items}
      </div>
    </div>`;
  };

  return `<section class="py-12 px-4 bg-gray-900 border-y border-gray-800">
  <div class="max-w-5xl mx-auto">
    <h2 class="text-lg font-semibold text-white mb-6 text-center">All Platforms</h2>
    ${renderGroup('CLI Tools', CLI_PLATFORMS)}
    ${renderGroup('IDE Extensions', IDE_PLATFORMS)}
  </div>
</section>`;
}

function generateGitHubPage(config) {
  const { name, label, description, type, version, installSteps, features, githubUrl, badgeLabel } = config;
  const featuresJson = JSON.stringify(features || []);
  const installStepsJson = JSON.stringify(installSteps || []);
  const typeLabel = type === 'cli' ? 'CLI Tool' : type === 'hub' ? 'Plugin Generator' : 'IDE Extension';
  const typeBadgeColor = type === 'cli' ? '#3b82f6' : type === 'hub' ? '#059669' : '#8b5cf6';
  const crossLinksHtml = generateCrossLinks(name === 'plugforge' ? null : name);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${label} - gm plugin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
    {"imports":{"webjsx":"https://cdn.jsdelivr.net/npm/webjsx@0.0.42/dist/index.js"}}
  </script>
  <style>
    .gradient-hero{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)}
    .card-hover{transition:transform .2s,box-shadow .2s}
    .card-hover:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.3)}
    pre{scrollbar-width:thin}
  </style>
</head>
<body class="bg-gray-950 text-gray-100 font-sans">
<script type="module">
import { createElement as h, applyDiff, Fragment } from "webjsx";
const PLATFORM_NAME = ${JSON.stringify(label)};
const PLATFORM_TYPE = ${JSON.stringify(typeLabel)};
const PLATFORM_TYPE_COLOR = ${JSON.stringify(typeBadgeColor)};
const DESCRIPTION = ${JSON.stringify(description)};
const VERSION = ${JSON.stringify(version || '2.0.0')};
const GITHUB_URL = ${JSON.stringify(githubUrl || '#')};
const BADGE_LABEL = ${JSON.stringify(badgeLabel || name)};
const FEATURES = ${featuresJson};
const INSTALL_STEPS = ${installStepsJson};
const GH_ICON = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
function NavBar() {
  return h('nav',{class:'border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10'},
    h('div',{class:'max-w-5xl mx-auto px-4 py-3 flex items-center justify-between'},
      h('div',{class:'flex items-center gap-3'},
        h('a',{href:'https://anentrypoint.github.io/plugforge',class:'text-white font-bold text-lg hover:text-indigo-400 transition-colors'},'gm'),
        h('span',{class:'text-gray-500'},'/'),
        h('span',{class:'text-gray-300 font-medium'},BADGE_LABEL)
      ),
      h('a',{href:GITHUB_URL,target:'_blank',rel:'noopener',class:'flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm'},
        h('svg',{viewBox:'0 0 16 16',class:'w-5 h-5 fill-current','aria-hidden':'true'},h('path',{d:GH_ICON})),
        'GitHub'
      )
    )
  );
}
function Badge({label,color}) {
  return h('span',{class:'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white',style:\`background-color:\${color}\`},label);
}
function Hero() {
  return h('section',{class:'gradient-hero py-20 px-4'},
    h('div',{class:'max-w-5xl mx-auto text-center'},
      h('div',{class:'flex justify-center gap-2 mb-6'},
        h(Badge,{label:PLATFORM_TYPE,color:PLATFORM_TYPE_COLOR}),
        h(Badge,{label:'v'+VERSION,color:'#374151'})
      ),
      h('h1',{class:'text-4xl md:text-5xl font-bold text-white mb-4'},PLATFORM_NAME),
      h('p',{class:'text-lg text-gray-300 max-w-2xl mx-auto mb-8'},DESCRIPTION),
      h('a',{href:GITHUB_URL,target:'_blank',rel:'noopener',class:'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors'},'View on GitHub')
    )
  );
}
function FeatureCard({title,desc}) {
  return h('div',{class:'card-hover bg-gray-900 border border-gray-800 rounded-xl p-5'},
    h('h3',{class:'font-semibold text-white mb-2'},title),
    h('p',{class:'text-gray-400 text-sm leading-relaxed'},desc)
  );
}
function FeaturesSection() {
  return h('section',{class:'py-16 px-4'},
    h('div',{class:'max-w-5xl mx-auto'},
      h('h2',{class:'text-2xl font-bold text-white mb-8 text-center'},'Features'),
      h('div',{class:'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'},
        ...FEATURES.map(f=>h(FeatureCard,{title:f.title,desc:f.desc}))
      )
    )
  );
}
function InstallStep({step,index}) {
  return h('div',{class:'flex gap-4 items-start'},
    h('div',{class:'flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white'},String(index+1)),
    h('div',{class:'flex-1'},
      h('p',{class:'text-gray-300 text-sm mb-1'},step.desc),
      step.cmd?h('pre',{class:'bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-sm text-green-400 overflow-x-auto mt-1'},step.cmd):null
    )
  );
}
function InstallSection() {
  if(!INSTALL_STEPS.length) return null;
  return h('section',{class:'py-16 px-4 bg-gray-900/50'},
    h('div',{class:'max-w-2xl mx-auto'},
      h('h2',{class:'text-2xl font-bold text-white mb-8 text-center'},'Installation'),
      h('div',{class:'space-y-6'},...INSTALL_STEPS.map((step,i)=>h(InstallStep,{step,index:i})))
    )
  );
}
function Footer() {
  return h('footer',{class:'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm'},
    h('p',null,'Generated by ',
      h('a',{href:'https://github.com/AnEntrypoint/plugforge',class:'text-indigo-400 hover:text-indigo-300'},'plugforge'),
      ' \u2014 convention-driven multi-platform plugin generator'
    )
  );
}
function App() {
  return h(Fragment,null,h(NavBar,null),h(Hero,null),h(FeaturesSection,null),h(InstallSection,null),h(Footer,null));
}
applyDiff(document.body,[h(App,null)]);
</script>
${crossLinksHtml}
</body>
</html>`;
}

module.exports = { generateGitHubPage, generateCrossLinks, CLI_PLATFORMS, IDE_PLATFORMS };
