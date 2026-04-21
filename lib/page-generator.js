const fs = require('fs');
const path = require('path');

const PLATFORM_FEATURES = [
  { title: 'state machine', desc: 'immutable PLAN→EXECUTE→EMIT→VERIFY→COMPLETE phases with full mutable tracking' },
  { title: 'semantic search', desc: 'natural language codebase exploration via codesearch skill' },
  { title: 'hooks', desc: 'pre-tool, session-start, prompt-submit, and stop hooks for full lifecycle control' },
  { title: 'agents', desc: 'gm, codesearch, and websearch agents pre-configured' },
  { title: 'mcp integration', desc: 'model context protocol server support built in' },
  { title: 'auto-recovery', desc: 'supervisor hierarchy ensures the system never crashes' }
];

const PLATFORM_META = {
  cc: { repoId: 'gm-cc', label: 'Claude Code', type: 'cli', badgeLabel: 'cc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-cc' }, { desc: 'restart Claude Code — activates automatically' }] },
  gc: { repoId: 'gm-gc', label: 'Gemini CLI', type: 'cli', badgeLabel: 'gc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-gc' }, { desc: 'restart Gemini CLI — hooks activate on next session' }] },
  oc: { repoId: 'gm-oc', label: 'OpenCode', type: 'cli', badgeLabel: 'oc', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-oc' }, { desc: 'restart OpenCode — activates automatically' }] },
  kilo: { repoId: 'gm-kilo', label: 'Kilo Code', type: 'cli', badgeLabel: 'kilo', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-kilo' }, { desc: 'restart Kilo Code — activates automatically' }] },
  codex: { repoId: 'gm-codex', label: 'Codex', type: 'cli', badgeLabel: 'codex', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-codex' }, { desc: 'restart Codex — activates automatically' }] },
  'copilot-cli': { repoId: 'gm-copilot-cli', label: 'Copilot CLI', type: 'cli', badgeLabel: 'copilot-cli', installSteps: [{ desc: 'install via GitHub CLI', cmd: 'gh extension install AnEntrypoint/gm-copilot-cli' }, { desc: 'restart your terminal' }] },
  vscode: { repoId: 'gm-vscode', label: 'VS Code', type: 'ide', badgeLabel: 'vscode', installSteps: [{ desc: 'Extensions → search "gm" → install' }, { desc: 'reload VS Code' }] },
  cursor: { repoId: 'gm-cursor', label: 'Cursor', type: 'ide', badgeLabel: 'cursor', installSteps: [{ desc: 'Extensions → search "gm" → install' }, { desc: 'reload Cursor' }] },
  zed: { repoId: 'gm-zed', label: 'Zed', type: 'ide', badgeLabel: 'zed', installSteps: [{ desc: 'build from source', cmd: 'git clone https://github.com/AnEntrypoint/gm-zed && cd gm-zed && cargo build --release' }, { desc: 'copy to extensions dir', cmd: 'cp target/release/libgm.so ~/.config/zed/extensions/gm/' }, { desc: 'restart Zed' }] },
  jetbrains: { repoId: 'gm-jetbrains', label: 'JetBrains', type: 'ide', badgeLabel: 'jetbrains', installSteps: [{ desc: 'Preferences → Plugins → search "gm" → install' }, { desc: 'restart IDE' }] },
  qwen: { repoId: 'gm-qwen', label: 'Qwen Code', type: 'cli', badgeLabel: 'qwen', installSteps: [{ desc: 'install via npm', cmd: 'npm install -g gm-qwen' }, { desc: 'restart Qwen Code' }] },
  hermes: { repoId: 'gm-hermes', label: 'Hermes Agent', type: 'cli', badgeLabel: 'hermes', installSteps: [{ desc: 'apply hermes-patch (github.com/AnEntrypoint/hermes-patch)' }, { desc: 'install via npm', cmd: 'npm install -g gm-hermes' }, { desc: 'restart Hermes Agent' }] }
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

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadDesignCss() {
  const root = path.resolve(__dirname, '..', 'vendor', 'design');
  const colors = fs.readFileSync(path.join(root, 'colors_and_type.css'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'app-shell.css'), 'utf8');
  return colors + '\n' + shell;
}

function pageLocalStyles() {
  return `
body { display: flex; flex-direction: column; min-height: 100vh; }
.app-main { max-width: 1100px; margin: 0 auto; width: 100%; padding: 24px 32px 64px 32px; }
.gm-hero { padding: 32px 0 24px 0; }
.gm-hero h1 { font-size: 36px; font-weight: 600; margin: 0 0 6px 0; color: var(--panel-text); letter-spacing: -0.01em; line-height: 1.15; }
.gm-hero .lede { font-size: 14px; line-height: 1.55; color: var(--panel-text-2); max-width: 64ch; margin: 0 0 20px 0; }
.gm-hero .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.gm-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; background: var(--panel-accent); color: var(--panel-1); border-radius: 6px; font-size: 13px; font-weight: 500; text-decoration: none; }
.gm-btn:hover { background: var(--panel-accent-2); text-decoration: none; }
.gm-btn.ghost { background: transparent; color: var(--panel-text); box-shadow: inset 0 0 0 1px var(--panel-3); }
.gm-btn.ghost:hover { background: var(--panel-hover); }
.gm-section-label { font-family: var(--ff-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--panel-text-2); margin: 32px 0 8px 0; }
.gm-section-label .slash { color: var(--panel-text-3); margin-right: 6px; }
.panel-row-link { display: grid; grid-template-columns: 80px 1fr auto; gap: 12px; padding: 8px 16px; align-items: baseline; color: var(--panel-text); text-decoration: none; font-size: 13px; }
.panel-row-link:hover { background: var(--panel-hover); text-decoration: none; }
.panel-row-link .code { font-family: var(--ff-mono); font-size: 11px; color: var(--panel-text-2); letter-spacing: 0.04em; }
.panel-row-link .title { color: var(--panel-text); font-weight: 500; }
.panel-row-link .sub { color: var(--panel-text-2); font-size: 12px; margin-left: 8px; font-weight: 400; }
.panel-row-link .meta { color: var(--panel-text-2); font-size: 11px; text-align: right; font-family: var(--ff-mono); }
.gm-install { background: var(--panel-1); border-radius: 8px; margin: 12px 0; box-shadow: var(--panel-shadow); overflow: hidden; }
.gm-install .head { padding: 10px 16px; background: var(--panel-2); font-family: var(--ff-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--panel-text-2); display: flex; justify-content: space-between; }
.gm-install-step { display: grid; grid-template-columns: 40px 1fr; gap: 12px; padding: 10px 16px; font-family: var(--ff-mono); font-size: 13px; color: var(--panel-text); }
.gm-install-step:not(:last-child) { box-shadow: inset 0 -1px 0 rgba(0,0,0,0.04); }
.gm-install-step .n { font-size: 11px; color: var(--panel-text-2); padding-top: 1px; }
.gm-install-step .d { color: var(--panel-text); font-family: 'Inter','Segoe UI',sans-serif; }
.gm-install-step pre { margin: 6px 0 0 0; padding: 6px 10px; background: var(--panel-2); border-radius: 4px; font-size: 12px; overflow-x: auto; }
.gm-install-step pre code { color: var(--panel-accent); font-family: var(--ff-mono); }
.gm-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 720px) { .gm-cards { grid-template-columns: 1fr; } }
.gm-card { background: var(--panel-1); border-radius: 6px; padding: 14px 16px; box-shadow: var(--panel-shadow); }
.gm-card .t { font-weight: 600; font-size: 13px; color: var(--panel-text); margin-bottom: 4px; }
.gm-card .d { font-size: 12px; color: var(--panel-text-2); line-height: 1.55; }
.gm-footer { padding: 12px 20px; font-family: var(--ff-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--panel-text-3); display: flex; justify-content: space-between; background: var(--panel-1); box-shadow: inset 0 1px 0 rgba(0,0,0,0.04); flex-wrap: wrap; gap: 12px; }
.gm-footer a { color: var(--panel-text-2); }
.gm-footer a:hover { color: var(--panel-text); }
`;
}

function renderTopbar(label, githubUrl) {
  return `<header class="app-topbar">
  <span class="brand">247420<span class="slash"> / </span>gm<span class="slash"> / </span>${esc(label.toLowerCase())}</span>
  <nav>
    <a href="https://anentrypoint.github.io/gm/">← all platforms</a>
    <a href="${esc(githubUrl)}" target="_blank" rel="noopener">source ↗</a>
  </nav>
</header>`;
}

function renderCrumb(label) {
  return `<div class="app-crumb">
  <span>247420</span><span class="sep">›</span>
  <span>gm</span><span class="sep">›</span>
  <span class="leaf">${esc(label.toLowerCase())}</span>
</div>`;
}

function renderHero(label, description, version, githubUrl) {
  return `<section class="gm-hero">
  <h1>gm · ${esc(label.toLowerCase())}</h1>
  <p class="lede">${esc(description)}</p>
  <div class="actions">
    <a class="gm-btn" href="${esc(githubUrl)}" target="_blank" rel="noopener">view on github</a>
    <a class="gm-btn ghost" href="#install">install ↓</a>
  </div>
</section>`;
}

function renderStatus(label, version) {
  return `<section>
  <div class="gm-section-label"><span class="slash">//</span>status</div>
  <div class="panel">
    <div class="panel-head"><span>release · v${esc(version || '2.0.0')}</span><span>probably emerging</span></div>
    <div class="panel-body">
      <div class="row">
        <span class="code"><span style="color:var(--panel-accent)">●</span></span>
        <span class="title">${esc(label)}<span class="sub">part of the gm family</span></span>
        <span class="meta">live</span>
      </div>
    </div>
  </div>
</section>`;
}

function renderInstall(steps) {
  if (!steps || !steps.length) return '';
  const rows = steps.map((s, i) => {
    const num = String(i + 1).padStart(2, '0');
    const cmd = s.cmd ? `<pre><code>${esc(s.cmd)}</code></pre>` : '';
    return `<div class="gm-install-step"><span class="n">${num}</span><div><div class="d">${esc(s.desc)}</div>${cmd}</div></div>`;
  }).join('\n');
  return `<section id="install">
  <div class="gm-section-label"><span class="slash">//</span>install</div>
  <div class="gm-install">
    <div class="head"><span>install · ${steps.length} step${steps.length === 1 ? '' : 's'}</span><span>shell</span></div>
    ${rows}
  </div>
</section>`;
}

function renderFeatures(features) {
  return `<section>
  <div class="gm-section-label"><span class="slash">//</span>features</div>
  <div class="gm-cards">
    ${features.map(f => `<div class="gm-card"><div class="t">${esc(f.title)}</div><div class="d">${esc(f.desc)}</div></div>`).join('\n    ')}
  </div>
</section>`;
}

function renderStateMachine() {
  const phases = [
    { code: 'plan',     title: 'write the unknowns down', meta: '.gm/prd.yml' },
    { code: 'execute',  title: 'run code against real services', meta: 'exec:<lang>' },
    { code: 'emit',     title: 'write files after checks pass', meta: 'pre + post gates' },
    { code: 'verify',   title: 'end-to-end, real data', meta: 'no mocks' },
    { code: 'complete', title: '.prd empty, git clean, pushed', meta: 'test.js' },
  ];
  return `<section>
  <div class="gm-section-label"><span class="slash">//</span>state machine</div>
  <div class="panel">
    <div class="panel-head"><span>5 phases · any new unknown → plan</span><span>strict order</span></div>
    <div class="panel-body">
      ${phases.map((p, i) => `<div class="row"><span class="code">${String(i + 1).padStart(3, '0')}</span><span class="title">${esc(p.code)}<span class="sub">${esc(p.title)}</span></span><span class="meta">${esc(p.meta)}</span></div>`).join('\n      ')}
    </div>
  </div>
</section>`;
}

function renderPlatformGrid(currentPlatform) {
  return `<section>
  <div class="gm-section-label"><span class="slash">//</span>also available</div>
  <div class="panel">
    <div class="panel-head"><span>platforms · 12</span><span>one state machine</span></div>
    <div class="panel-body">
      ${ALL_PLATFORMS.map((p, i) => {
        const active = p.repoId === currentPlatform;
        const href = active ? '#' : `https://anentrypoint.github.io/${p.repoId}`;
        const meta = (p.type === 'cli' ? 'cli' : 'ide') + (active ? ' · here' : ' · live');
        const code = String(i + 1).padStart(3, '0');
        const linkAttrs = active ? '' : ' target="_blank" rel="noopener"';
        return `<a class="panel-row-link" href="${esc(href)}"${linkAttrs}><span class="code">${code}</span><span class="title">${esc(p.label.toLowerCase())}<span class="sub">${esc(p.repoId)}</span></span><span class="meta">${esc(meta)}</span></a>`;
      }).join('\n      ')}
    </div>
  </div>
</section>`;
}

function renderFooter(label) {
  return `<footer class="gm-footer">
  <span>${esc(label.toLowerCase())} · part of <a href="https://anentrypoint.github.io/gm/">gm</a> · <a href="https://github.com/AnEntrypoint" target="_blank" rel="noopener">anentrypoint</a></span>
  <span>probably emerging \u{1F300}</span>
</footer>`;
}

function generateGitHubPage(config) {
  const { label, description, version, installSteps, features, githubUrl, currentPlatform } = config;
  const designCss = loadDesignCss();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)} · gm · 247420</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#181a1f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f5f7" media="(prefers-color-scheme: light)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${designCss}
${pageLocalStyles()}</style>
</head>
<body data-screen-label="gm / ${esc(label.toLowerCase())}">
${renderTopbar(label, githubUrl)}
${renderCrumb(label)}
<main class="app-main">
${renderHero(label, description, version, githubUrl)}
${renderStatus(label, version)}
${renderInstall(installSteps)}
${renderFeatures(features)}
${renderStateMachine()}
${renderPlatformGrid(currentPlatform)}
</main>
${renderFooter(label)}
</body></html>`;
}

module.exports = { generateGitHubPage, getPlatformPageConfig, PLATFORM_META, ALL_PLATFORMS, loadDesignCss, pageLocalStyles };
