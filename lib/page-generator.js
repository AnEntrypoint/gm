const fs = require('fs');
const path = require('path');

const PLATFORM_FEATURES = [
  { title: 'state machine', desc: 'immutable PLAN→EXECUTE→EMIT→VERIFY→COMPLETE phases with full mutable tracking' },
  { title: 'semantic search', desc: 'natural language codebase exploration via codesearch skill — no grep needed' },
  { title: 'hooks', desc: 'pre-tool, session-start, prompt-submit, and stop hooks for full lifecycle control' },
  { title: 'agents', desc: 'gm, codesearch, and websearch agents pre-configured and ready to use' },
  { title: 'mcp integration', desc: 'model context protocol server support built in' },
  { title: 'auto-recovery', desc: 'supervisor hierarchy ensures the system never crashes' }
];

const PLATFORM_META = {
  cc: { repoId: 'gm-cc', label: 'Claude Code', type: 'cli', badgeLabel: 'cc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-cc' }, { desc: 'restart Claude Code — activates automatically' }] },
  gc: { repoId: 'gm-gc', label: 'Gemini CLI', type: 'cli', badgeLabel: 'gc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-gc' }, { desc: 'restart Gemini CLI — hooks activate on next session' }] },
  oc: { repoId: 'gm-oc', label: 'OpenCode', type: 'cli', badgeLabel: 'oc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-oc' }, { desc: 'restart OpenCode — activates automatically' }] },
  kilo: { repoId: 'gm-kilo', label: 'Kilo Code', type: 'cli', badgeLabel: 'kilo', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-kilo' }, { desc: 'restart Kilo Code — activates automatically' }] },
  codex: { repoId: 'gm-codex', label: 'Codex', type: 'cli', badgeLabel: 'codex', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-codex' }, { desc: 'restart Codex — activates automatically' }] },
  'copilot-cli': { repoId: 'gm-copilot-cli', label: 'Copilot CLI', type: 'cli', badgeLabel: 'copilot-cli', installSteps: [{ desc: 'install via GitHub CLI', cmd: 'gh extension install AnEntrypoint/gm-copilot-cli' }, { desc: 'restart your terminal — activates automatically' }] },
  vscode: { repoId: 'gm-vscode', label: 'VS Code', type: 'ide', badgeLabel: 'vscode', installSteps: [{ desc: 'Extensions (Ctrl+Shift+X) → search "gm" → install' }, { desc: 'reload VS Code — activates automatically' }] },
  cursor: { repoId: 'gm-cursor', label: 'Cursor', type: 'ide', badgeLabel: 'cursor', installSteps: [{ desc: 'Extensions (Ctrl+Shift+X) → search "gm" → install' }, { desc: 'reload Cursor — activates automatically' }] },
  zed: { repoId: 'gm-zed', label: 'Zed', type: 'ide', badgeLabel: 'zed', installSteps: [{ desc: 'build from source', cmd: 'git clone https://github.com/AnEntrypoint/gm-zed && cd gm-zed && cargo build --release' }, { desc: 'copy to extensions dir', cmd: 'cp target/release/libgm.so ~/.config/zed/extensions/gm/' }, { desc: 'restart Zed — activates automatically' }] },
  jetbrains: { repoId: 'gm-jetbrains', label: 'JetBrains', type: 'ide', badgeLabel: 'jetbrains', installSteps: [{ desc: 'Preferences → Plugins → Marketplace → search "gm" → install' }, { desc: 'restart IDE — activates automatically' }] },
  qwen: { repoId: 'gm-qwen', label: 'Qwen Code', type: 'cli', badgeLabel: 'qwen', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-qwen' }, { desc: 'restart Qwen Code — activates automatically' }] },
  hermes: { repoId: 'gm-hermes', label: 'Hermes Agent', type: 'cli', badgeLabel: 'hermes', installSteps: [{ desc: 'apply hermes-patch to enable hook support (see github.com/AnEntrypoint/hermes-patch)' }, { desc: 'install via npm', cmd: 'npm install -g gm-hermes' }, { desc: 'restart Hermes Agent — skills activate automatically' }] }
};

const ALL_PLATFORMS = Object.values(PLATFORM_META);

function getPlatformPageConfig(adapterName, pluginSpec) {
  const m = PLATFORM_META[adapterName] || { repoId: `gm-${adapterName}`, label: adapterName, type: 'cli', badgeLabel: adapterName, installSteps: [] };
  return {
    name: m.repoId,
    label: m.label,
    description: pluginSpec.description,
    type: m.type,
    version: pluginSpec.version,
    installSteps: m.installSteps,
    features: PLATFORM_FEATURES,
    githubUrl: `https://github.com/AnEntrypoint/${m.repoId}`,
    badgeLabel: m.badgeLabel,
    currentPlatform: m.repoId
  };
}

function loadDesignCss() {
  const root = path.resolve(__dirname, '..', 'vendor', 'design');
  const colors = fs.readFileSync(path.join(root, 'colors_and_type.css'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'app-shell.css'), 'utf8');
  return colors + '\n' + shell;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDateline(label, version) {
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="dateline">
  <span class="t-micro">247420 / anentrypoint</span>
  <span class="t-micro">${esc(label)}</span>
  <span class="t-micro">v${esc(version)}</span>
  <span class="t-micro">${today}</span>
  <span class="t-micro">probably emerging \u{1F300}</span>
</div>`;
}

function renderHero(label, description, githubUrl, type) {
  return `<section class="hero">
  <span class="stamp ink">${esc(type === 'cli' ? 'cli tool' : 'ide ext')}</span>
  <h1 class="t-hero">gm <span class="slash">/</span> ${esc(label.toLowerCase())}</h1>
  <p class="t-prose lede">${esc(description)}</p>
  <div class="hero-cta">
    <a class="btn-stamp" href="${esc(githubUrl)}">source ↗</a>
  </div>
</section>`;
}

function renderInstall(steps) {
  if (!steps || !steps.length) return '';
  const rows = steps.map((s, i) => {
    const num = String(i + 1).padStart(2, '0');
    const cmd = s.cmd ? `<pre class="receipt-cmd"><code>${esc(s.cmd)}</code></pre>` : '';
    return `<div class="receipt-row"><span class="t-label num">${num}</span><div class="receipt-body"><p class="t-body">${esc(s.desc)}</p>${cmd}</div></div>`;
  }).join('\n');
  return `<section class="section">
  <div class="section-head"><span class="t-label">§ install</span><hr class="rule"/></div>
  <div class="receipt">${rows}</div>
</section>`;
}

function renderFeatures(features) {
  const rows = features.map(f => `<li class="feat-row"><span class="t-label feat-tag">${esc(f.title)}</span><span class="t-body feat-desc">${esc(f.desc)}</span></li>`).join('\n');
  return `<section class="section">
  <div class="section-head"><span class="t-label">§ features</span><hr class="rule"/></div>
  <ul class="feat-list">${rows}</ul>
</section>`;
}

function renderStateMachine() {
  const phases = [
    { name: 'plan', desc: 'write .gm/prd.yml with every unknown named before any work begins' },
    { name: 'execute', desc: 'prove every hypothesis via witnessed execution, import real modules' },
    { name: 'emit', desc: 'write files only after all tests pass — pre- and post-emit gates' },
    { name: 'verify', desc: 'end-to-end execution confirms all changes work in real context' },
    { name: 'complete', desc: '.prd empty, git clean, all output pushed' }
  ];
  const rows = phases.map((p, i) => `<li class="phase-row"><span class="t-label phase-name">${String(i + 1).padStart(2, '0')} ${esc(p.name)}</span><span class="t-body phase-desc">${esc(p.desc)}</span></li>`).join('\n');
  return `<section class="section">
  <div class="section-head"><span class="t-label">§ state machine</span><hr class="rule"/></div>
  <p class="t-prose section-lede">every task follows the same five-phase cycle — no skipping, no shortcuts.</p>
  <ol class="phase-list">${rows}</ol>
</section>`;
}

function renderPlatformGrid(currentPlatform) {
  const cli = ALL_PLATFORMS.filter(p => p.type === 'cli');
  const ide = ALL_PLATFORMS.filter(p => p.type === 'ide');
  const row = p => {
    const active = p.repoId === currentPlatform;
    const href = active ? '#' : `https://anentrypoint.github.io/${p.repoId}`;
    const marker = active ? '◆' : '›';
    return `<a class="idx-row${active ? ' idx-active' : ''}" href="${esc(href)}"><span class="idx-mark">${marker}</span><span class="idx-label">${esc(p.label.toLowerCase())}</span><span class="idx-tag t-meta">${esc(p.repoId)}</span></a>`;
  };
  return `<section class="section">
  <div class="section-head"><span class="t-label">§ also available</span><hr class="rule"/></div>
  <div class="platform-cols">
    <div class="platform-col">
      <p class="t-label col-head">cli tools</p>
      <div class="idx-list">${cli.map(row).join('\n')}</div>
    </div>
    <div class="platform-col">
      <p class="t-label col-head">ide extensions</p>
      <div class="idx-list">${ide.map(row).join('\n')}</div>
    </div>
  </div>
</section>`;
}

function renderFooter() {
  return `<footer class="app-foot">
  <hr class="rule-double"/>
  <div class="foot-row">
    <span class="t-micro">generated by gm — convention-driven multi-platform plugin generator</span>
    <span class="t-micro">probably emerging \u{1F300}</span>
  </div>
</footer>`;
}

function pageStyles() {
  return `
@font-face{font-family:'Archivo';src:local('Archivo');}
:root{
  --paper:#EFE9DD;--ink:#0B0B09;--acid:#B8FF00;--link:#1F4DFF;--warn:#FF3B1F;--live:#00A86B;
  --fg:var(--ink);--bg:var(--paper);--fg-2:#3a3a36;--fg-3:#6b6b64;
  --ff-display:'Archivo','Archivo Narrow',ui-sans-serif,sans-serif;
  --ff-mono:'JetBrains Mono','ui-monospace',Menlo,Consolas,monospace;
  --ff-body:'Space Grotesk','Archivo',ui-sans-serif,sans-serif;
  --fs-hero:clamp(64px,12vw,144px);--fs-h1:clamp(40px,6vw,72px);--fs-h2:28px;--fs-h3:18px;--fs-h4:15px;
  --fs-body:14px;--fs-lg:17px;--fs-xs:11px;--fs-micro:10px;
  --lh-tight:1.02;--lh-snug:1.18;--lh-base:1.5;--lh-long:1.6;
  --tr-tight:-0.02em;--tr-label:0.08em;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--space-8:64px;
  --measure:64ch;
  --dur-snap:80ms;--dur-base:160ms;--ease:cubic-bezier(0.2,0,0,1);
}
*,*::before,*::after{box-sizing:border-box;border:0;outline:0;border-radius:0;}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--ff-mono);font-size:var(--fs-body);line-height:var(--lh-base);-webkit-font-smoothing:antialiased;}
a{color:inherit;text-decoration:none;}
a:hover{text-decoration:underline;text-underline-offset:3px;}
.rule{border-top:1px solid var(--ink);height:0;margin:0;flex:1;}
.rule-double{border-top:3px double var(--ink);height:0;margin:0;}
.t-hero{font-family:var(--ff-display);font-size:var(--fs-hero);line-height:var(--lh-tight);letter-spacing:var(--tr-tight);font-weight:800;margin:0;text-transform:lowercase;}
.t-hero .slash{color:var(--fg-3);font-weight:400;margin:0 0.05em;}
h1,h2,h3{margin:0;font-family:var(--ff-display);}
.t-h2,h2{font-size:var(--fs-h2);line-height:var(--lh-snug);font-weight:700;letter-spacing:var(--tr-tight);}
.t-body{font-family:var(--ff-mono);font-size:var(--fs-body);line-height:var(--lh-base);}
.t-prose{font-family:var(--ff-body);font-size:var(--fs-lg);line-height:var(--lh-long);max-width:var(--measure);}
.t-label{font-family:var(--ff-mono);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:var(--tr-label);font-weight:500;color:var(--fg-2);}
.t-micro{font-family:var(--ff-mono);font-size:var(--fs-micro);letter-spacing:var(--tr-label);text-transform:uppercase;color:var(--fg-3);}
.t-meta{font-family:var(--ff-mono);font-size:var(--fs-xs);color:var(--fg-3);}

.stamp{display:inline-block;padding:var(--space-1) var(--space-3);font-family:var(--ff-mono);font-size:var(--fs-xs);letter-spacing:var(--tr-label);text-transform:uppercase;font-weight:600;transform:rotate(-2deg);}
.stamp.ink{background:var(--ink);color:var(--paper);}
.stamp.acid{background:var(--acid);color:var(--ink);}

.btn-stamp{display:inline-flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);background:var(--ink);color:var(--paper);box-shadow:4px 4px 0 var(--ink);font-family:var(--ff-mono);font-weight:600;font-size:var(--fs-body);text-transform:uppercase;letter-spacing:var(--tr-label);cursor:pointer;transition:transform var(--dur-snap) var(--ease),box-shadow var(--dur-snap) var(--ease);}
.btn-stamp:hover{transform:translate(1px,1px);box-shadow:3px 3px 0 var(--ink);text-decoration:none;}
.btn-stamp:active{transform:translate(4px,4px);box-shadow:0 0 0 var(--ink);}

.app-top{position:sticky;top:0;z-index:10;background:var(--paper);display:flex;align-items:center;gap:var(--space-4);padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--ink);}
.app-top .brand{font-family:var(--ff-mono);font-weight:700;text-transform:uppercase;letter-spacing:var(--tr-label);}
.app-top .brand .slash{color:var(--fg-3);margin:0 var(--space-1);}
.app-top nav{margin-left:auto;display:flex;gap:var(--space-4);font-family:var(--ff-mono);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:var(--tr-label);}

.dateline{display:flex;gap:var(--space-5);flex-wrap:wrap;padding:var(--space-2) var(--space-5);border-bottom:1px solid var(--ink);background:var(--paper);}
.page{max-width:1100px;margin:0 auto;padding:0 var(--space-5);}
.hero{padding:var(--space-8) 0 var(--space-7) 0;}
.hero .stamp{margin-bottom:var(--space-4);}
.hero .lede{margin-top:var(--space-4);color:var(--fg-2);}
.hero-cta{margin-top:var(--space-6);}

.section{padding:var(--space-7) 0;border-top:1px solid var(--ink);}
.section-head{display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-5);}
.section-lede{margin-bottom:var(--space-5);color:var(--fg-2);}

.receipt{border:1px solid var(--ink);background:color-mix(in srgb,var(--paper) 94%,var(--ink));}
.receipt-row{display:grid;grid-template-columns:48px 1fr;gap:var(--space-4);padding:var(--space-4);border-bottom:1px dashed var(--ink);}
.receipt-row:last-child{border-bottom:0;}
.receipt-row .num{align-self:start;padding-top:2px;}
.receipt-cmd{font-family:var(--ff-mono);font-size:var(--fs-body);background:var(--ink);color:var(--acid);padding:var(--space-3);margin:var(--space-2) 0 0 0;overflow-x:auto;}
.receipt-cmd code{background:transparent;color:inherit;}

.feat-list,.phase-list,.idx-list{list-style:none;margin:0;padding:0;}
.feat-row,.phase-row{display:grid;grid-template-columns:180px 1fr;gap:var(--space-4);padding:var(--space-3) 0;border-top:1px solid var(--ink);}
.feat-row:last-child,.phase-row:last-child{border-bottom:1px solid var(--ink);}
.feat-tag,.phase-name{padding-top:2px;}

.platform-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);}
@media (max-width:720px){.platform-cols{grid-template-columns:1fr;}.feat-row,.phase-row,.receipt-row{grid-template-columns:1fr;gap:var(--space-1);}.receipt-row{grid-template-columns:48px 1fr;}}
.col-head{margin-bottom:var(--space-3);color:var(--fg-2);}
.idx-row{display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-top:1px solid var(--ink);color:var(--ink);text-decoration:none;transition:background var(--dur-snap) var(--ease);}
.idx-row:last-child{border-bottom:1px solid var(--ink);}
.idx-row:hover{background:var(--ink);color:var(--paper);text-decoration:none;}
.idx-row:hover .idx-tag{color:var(--paper);}
.idx-active{background:var(--acid);color:var(--ink);}
.idx-active:hover{background:var(--acid);color:var(--ink);}
.idx-mark{font-family:var(--ff-mono);color:var(--fg-3);}
.idx-label{font-family:var(--ff-mono);text-transform:uppercase;letter-spacing:var(--tr-label);font-size:var(--fs-body);}
.idx-tag{font-family:var(--ff-mono);}

.app-foot{margin-top:var(--space-8);padding:var(--space-5) var(--space-5) var(--space-7) var(--space-5);}
.foot-row{display:flex;justify-content:space-between;gap:var(--space-4);padding-top:var(--space-3);}
`;
}

function renderTopbar(label, githubUrl) {
  return `<header class="app-top">
  <span class="brand">247420<span class="slash">/</span>gm<span class="slash">/</span>${esc(label.toLowerCase())}</span>
  <nav>
    <a href="https://anentrypoint.github.io/gm">← all platforms</a>
    <a href="${esc(githubUrl)}">source ↗</a>
  </nav>
</header>`;
}

function generateGitHubPage(config) {
  const { label, description, type, version, installSteps, features, githubUrl, currentPlatform } = config;
  const css = pageStyles();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)} · gm</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#EFE9DD">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${renderTopbar(label, githubUrl)}
${renderDateline(label, version || '2.0.0')}
<main class="page">
${renderHero(label, description, githubUrl, type)}
${renderInstall(installSteps)}
${renderFeatures(features)}
${renderStateMachine()}
${renderPlatformGrid(currentPlatform)}
</main>
${renderFooter()}
</body></html>`;
}

module.exports = { generateGitHubPage, getPlatformPageConfig, PLATFORM_META, ALL_PLATFORMS, pageStyles, loadDesignCss };
