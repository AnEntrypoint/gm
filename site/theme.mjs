import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

function extractArticle(html) {
  const bodyOpen = html.search(/<body[^>]*>/i);
  if (bodyOpen < 0) return html;
  const bodyStart = html.indexOf('>', bodyOpen) + 1;
  const bodyEnd = html.lastIndexOf('</body>');
  let body = html.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : html.length);
  body = body.replace(/<header[^>]*class=["'][^"']*(?:app-topbar|gm-topbar)[^"']*["'][\s\S]*?<\/header>/gi, '');
  const crumbIdx = body.indexOf('app-crumb');
  if (crumbIdx >= 0) {
    const closeAfter = body.indexOf('</div>', crumbIdx);
    if (closeAfter >= 0) body = body.slice(closeAfter + '</div>'.length);
  }
  const footerIdx = body.search(/<footer\b[^>]*>/i);
  if (footerIdx >= 0) body = body.slice(0, footerIdx);
  return body.trim();
}

function rewriteLegacyLinks(html, basePath) {
  const slugs = ['index', 'paper', 'distribution', 'made-with', 'stats', 'crates', 'skills'];
  const slugToPath = { index: '/', paper: '/paper/', distribution: '/distribution/', 'made-with': '/made-with/', stats: '/stats/', crates: '/crates/', skills: '/skills/' };
  return html.replace(/href="([^"]+)"/g, (full, hrefRaw) => {
    const href = hrefRaw.trim();
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('/')) return full;
    let path = href;
    let hash = '';
    const hi = path.indexOf('#');
    if (hi >= 0) { hash = path.slice(hi); path = path.slice(0, hi); }
    path = path.replace(/^\.\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    if (slugs.includes(path)) {
      return `href="${basePath}${slugToPath[path]}${hash}"`;
    }
    return full;
  });
}

function flattenNav(nav) {
  const out = [];
  for (const entry of (nav && nav.links ? nav.links : [])) {
    if (entry.group && Array.isArray(entry.group) && entry.group.length) {
      for (const g of entry.group) out.push([g.label, g.href]);
    } else {
      out.push([entry.label, entry.href]);
    }
  }
  return out;
}

const clientScript = `
import { createActor, createMachine } from './vendor/xstate/dist/xstate.esm.js';

const data = JSON.parse(document.getElementById('__site__').textContent);
const tabs = Array.from(document.querySelectorAll('[data-tab]'));
const sections = Array.from(document.querySelectorAll('[data-section]'));
const machine = createMachine({
  id: 'siteViews',
  initial: 'overview',
  states: {
    overview: { on: { NEXT: 'architecture', GOTO_OVERVIEW: 'overview', GOTO_ARCHITECTURE: 'architecture', GOTO_DOCS: 'docs' } },
    architecture: { on: { NEXT: 'docs', PREV: 'overview', GOTO_OVERVIEW: 'overview', GOTO_ARCHITECTURE: 'architecture', GOTO_DOCS: 'docs' } },
    docs: { on: { PREV: 'architecture', GOTO_OVERVIEW: 'overview', GOTO_ARCHITECTURE: 'architecture', GOTO_DOCS: 'docs' } }
  }
});
const actor = createActor(machine);
let state = 'overview';
const sync = () => {
  tabs.forEach((btn) => btn.dataset.active = String(btn.dataset.tab === state));
  sections.forEach((section) => {
    section.hidden = section.dataset.section !== state;
  });
};
const go = (next) => {
  actor.send({ type: next });
};
tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    actor.start();
    actor.send({ type: 'GOTO_' + btn.dataset.tab.toUpperCase() });
    sync();
  });
});
document.querySelectorAll('[data-flow]').forEach((btn) => {
  btn.addEventListener('click', () => go(btn.dataset.flow));
});
actor.subscribe((snapshot) => {
  if (!snapshot.value) return;
  state = typeof snapshot.value === 'string' ? snapshot.value : Object.keys(snapshot.value)[0];
  sync();
});
actor.start();
sync();
window.__debug = {
  gm: {
    view: () => state,
    views: tabs.map((btn) => btn.dataset.tab),
    count: () => sections.length,
  }
};
`;

const renderHtml = ({ site, navItems, page }) => {
  const navHtml = navItems.map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('');
  const heroBadges = (page.hero?.badges || []).map((b) => `<span class="pill">${escapeHtml(b.label)}</span>`).join('');
  const heroActions = (page.hero?.ctas || []).map((c) => `<a class="btn ${c.primary ? 'primary' : ''}" href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`).join('');
  const featureHtml = (page.features?.items || []).map((it, i) => `
    <article class="feature">
      <div class="code">${String(i + 1).padStart(2, '0')}</div>
      <strong>${escapeHtml(it.name)}</strong>
      <p>${escapeHtml(it.desc || '')}</p>
    </article>
  `).join('');
  const examplesHtml = (page.examples?.items || []).map((it) => `
    <div class="doc-card">
      <strong>${escapeHtml(it.name)}</strong>
      <p>${escapeHtml(it.desc || '')}</p>
      <small><a href="${escapeHtml(it.href || '#')}">${escapeHtml(it.cta || 'open')}</a></small>
    </div>
  `).join('');
  const quickstartHtml = (page.quickstart?.lines || []).map((l) => `<div class="cli"><span class="prompt">${l.kind === 'cmt' ? '#' : '$'}</span><span class="cmd">${escapeHtml(l.text)}</span></div>`).join('');

  return `<!DOCTYPE html>
<html lang="en" class="ds-247420" data-theme="auto">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title || site.title)}${site.tagline ? ' — ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(page.description || site.description || site.tagline || site.title)}" />
  <meta property="og:title" content="${escapeHtml(page.title || site.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description || site.description || site.tagline || '')}" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(site.glyph || '◆')}%3C/text%3E%3C/svg%3E" />
  <link rel="stylesheet" href="./vendor/rippleui/dist/css/styles.css" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --bg2: #0b1b33;
      --panel: rgba(10, 19, 36, 0.84);
      --panel-2: rgba(16, 28, 52, 0.88);
      --line: rgba(129, 199, 132, 0.18);
      --text: #e6f2ff;
      --muted: #97aac7;
      --accent: ${escapeHtml(site.accent_from || '#7ee787')};
      --accent2: ${escapeHtml(site.accent_to || '#56d364')};
      --shadow: 0 24px 72px rgba(0, 0, 0, 0.32);
      --radius: 24px;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, system-ui, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(126, 231, 135, 0.18), transparent 34%),
        radial-gradient(circle at top right, rgba(86, 211, 100, 0.12), transparent 30%),
        linear-gradient(180deg, var(--bg), var(--bg2));
      color: var(--text);
      overflow-x: hidden;
    }
    a { color: inherit; text-decoration: none; }
    .shell {
      width: min(1400px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 18px 0 32px;
    }
    .topbar {
      position: sticky;
      top: 14px;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 14px 18px;
      border: 1px solid var(--line);
      background: rgba(6, 10, 18, 0.72);
      backdrop-filter: blur(18px);
      border-radius: 999px;
      box-shadow: var(--shadow);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .brandmark {
      width: 38px; height: 38px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #04110a;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      font-weight: 900;
    }
    .brandcopy { min-width: 0; }
    .brandcopy strong { display: block; font-size: 15px; letter-spacing: 0.02em; }
    .brandcopy span { display: block; color: var(--muted); font-size: 12px; }
    .nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .nav a, .tab {
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid transparent;
      color: var(--muted);
      background: transparent;
    }
    .nav a:hover,
    .tab[data-active="true"] {
      color: var(--text);
      border-color: var(--line);
      background: rgba(255,255,255,0.04);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr);
      gap: 18px;
      margin-top: 20px;
    }
    .panel {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel), var(--panel-2));
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: clip;
    }
    .hero {
      padding: 36px;
      position: relative;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--accent);
      background: rgba(126, 231, 135, 0.08);
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 11px;
    }
    h1, h2, h3, p { margin: 0; }
    .hero h1 {
      margin-top: 14px;
      font-size: clamp(44px, 7vw, 88px);
      line-height: 0.94;
      letter-spacing: -0.05em;
      max-width: 12ch;
    }
    .hero .lede {
      margin-top: 18px;
      max-width: 66ch;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.7;
    }
    .hero-actions, .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }
    .btn, .pill, .tab {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 11px 15px;
      background: rgba(255,255,255,0.04);
      color: var(--text);
    }
    .btn.primary {
      color: #06120a;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      border-color: transparent;
      font-weight: 700;
    }
    .stats {
      display: grid;
      gap: 12px;
      padding: 20px;
    }
    .stat {
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
    }
    .stat strong { display: block; font-size: 24px; margin-bottom: 4px; }
    .stat span { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .tabs {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin: 18px 0 0;
    }
    .layout {
      display: grid;
      gap: 18px;
      margin-top: 18px;
    }
    .section {
      padding: 26px;
    }
    .section h2 {
      margin-top: 4px;
      font-size: 28px;
      letter-spacing: -0.03em;
    }
    .section .sub {
      margin-top: 10px;
      color: var(--muted);
      max-width: 72ch;
      line-height: 1.65;
    }
    .feature-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 20px;
    }
    .feature {
      min-height: 160px;
      padding: 18px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.025);
    }
    .feature .code {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px; height: 40px;
      border-radius: 12px;
      margin-bottom: 12px;
      background: rgba(126, 231, 135, 0.12);
      color: var(--accent);
      font-weight: 700;
    }
    .feature strong { display: block; font-size: 18px; line-height: 1.35; }
    .feature p { margin-top: 8px; color: var(--muted); line-height: 1.65; }
    .cli {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(0,0,0,0.24);
      margin-top: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .prompt { color: var(--accent); flex: 0 0 auto; }
    .cmd { color: var(--text); line-height: 1.55; }
    .docs-grid {
      display: grid;
      gap: 12px;
      margin-top: 18px;
    }
    .doc-card {
      padding: 18px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
    }
    .doc-card strong { display: block; font-size: 18px; margin-bottom: 6px; }
    .doc-card p { color: var(--muted); line-height: 1.65; margin-bottom: 12px; }
    .doc-card small { color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; }
    .footerbar {
      margin-top: 18px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(6, 10, 18, 0.55);
      color: var(--muted);
    }
    @media (max-width: 980px) {
      .hero-grid, .feature-list { grid-template-columns: 1fr; }
      .topbar { border-radius: 24px; flex-direction: column; align-items: stretch; }
      .nav { justify-content: flex-start; }
      .hero { padding: 24px; }
      .section { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div id="micro-shell"></div>
    <div id="workspace-shell"></div>
    <header class="topbar">
      <div class="brand">
        <div class="brandmark">${escapeHtml(site.glyph || '◆')}</div>
        <div class="brandcopy">
          <strong>${escapeHtml(site.title || 'gm')}</strong>
          <span>${escapeHtml(site.tagline || '')}</span>
        </div>
      </div>
      <nav class="nav" aria-label="Primary">
        ${navHtml}
      </nav>
    </header>

    ${page.layout === 'article' ? `
      <main class="panel section" style="margin-top:18px">
        <div class="eyebrow">article</div>
        <h2 style="margin-top:14px">${escapeHtml(page.title || site.title || '')}</h2>
        <div class="sub">${escapeHtml(page.description || '')}</div>
        <article class="docs-grid" style="margin-top:24px">${page.articleHtml || ''}</article>
      </main>
    ` : `
      <main class="grid gap-6">
        <section class="panel hero">
          <div class="eyebrow">state machine / browser shell</div>
          <h1>${escapeHtml(page.hero?.heading || site.title || '')}</h1>
          <p class="lede">${escapeHtml(page.hero?.body || page.hero?.subheading || site.description || '')}</p>
          <div class="hero-actions">${heroActions}</div>
          <div class="pills">${heroBadges}</div>
          <div class="tabs" role="tablist" aria-label="Site views">
            <button class="tab" data-tab="overview" data-active="true" type="button">Overview</button>
            <button class="tab" data-tab="architecture" type="button">Architecture</button>
            <button class="tab" data-tab="docs" type="button">Docs</button>
          </div>
        </section>

        <section class="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
          <div class="panel section" data-section="overview">
            <div class="eyebrow">${escapeHtml(page.features?.heading || 'features')}</div>
            <h2>${escapeHtml(page.features?.heading || '')}</h2>
            <p class="sub">${escapeHtml(page.hero?.subheading || '')}</p>
            <div class="feature-list">${featureHtml}</div>
          </div>
          <aside class="panel stats">
            <div class="stat">
              <strong>${escapeHtml(site.repo ? 'source online' : 'source local')}</strong>
              <span>${escapeHtml(site.repo || 'local-first browser rendering')}</span>
            </div>
            <div class="stat">
              <strong>${escapeHtml(page.title || site.title || 'gm')}</strong>
              <span>${escapeHtml(site.description || site.tagline || '')}</span>
            </div>
            <div class="stat">
              <strong>${escapeHtml(site.code || '001')}</strong>
              <span>structured as a deterministic page flow with explicit browser states.</span>
            </div>
          </aside>
        </section>

        <section class="grid gap-6 lg:grid-cols-2">
          <section class="panel section" data-section="architecture" hidden>
            <div class="eyebrow">architecture</div>
            <h2>Predictable browser surface</h2>
            <p class="sub">The landing shell owns its layout locally, uses explicit tab state, and keeps the article surface separate so content and navigation do not interfere with each other.</p>
            <div class="docs-grid">
              <div class="doc-card">
                <strong>State-machine framing</strong>
                <p>The view is driven by a tiny client state machine so the browser experience has explicit states instead of implicit DOM drift.</p>
                <small>xstate is staged for the next pass</small>
              </div>
              <div class="doc-card">
                <strong>Local shell</strong>
                <p>The layout, spacing, and visual treatment are now in this repo, not only in a remote component library.</p>
                <small>vendor localization remains to do</small>
              </div>
            </div>
          </section>

          <section class="panel section" data-section="docs" hidden>
            <div class="eyebrow">${escapeHtml(page.examples?.heading || 'docs')}</div>
            <h2>${escapeHtml(page.examples?.heading || '')}</h2>
            <div class="docs-grid">
              ${examplesHtml}
            </div>
            <div class="docs-grid" style="margin-top:18px">
              <div class="doc-card">
                <strong>Quickstart</strong>
                ${quickstartHtml}
              </div>
            </div>
          </section>
        </section>

        <div class="footerbar">
          <span>${escapeHtml(site.title || 'gm')} · ${escapeHtml(site.tagline || '')}</span>
          <span>${navItems.length} nav items · ${page.layout === 'article' ? 'article view' : 'landing view'}</span>
        </div>

        <div class="panel section" style="padding:18px">
          <div class="eyebrow">launcher</div>
          <div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div class="docs-grid" style="margin-top:0">
              <div class="doc-card">
                <strong>Open surfaces</strong>
                <p>Keep the browser workspace predictable: each primary route is a stable app surface, not a hidden page state.</p>
                <small>launcher rail</small>
              </div>
              <div class="flex flex-wrap gap-2">
                ${navItems.map(([label, href]) => `<a class="btn btn-outline btn-sm" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')}
              </div>
            </div>
            <div class="docs-grid" style="margin-top:0">
              <div class="doc-card">
                <strong>Live signals</strong>
                <p>State machine, local vendors, and local rendering all remain in the browser loop and are ready for more app panes.</p>
                <small>workspace status</small>
              </div>
              <div class="doc-card">
                <strong>Ready state</strong>
                <p>${escapeHtml(page.layout === 'article' ? 'article' : 'launcher')} view is still witnessable through <code>window.__debug.gm</code>.</p>
                <small>${escapeHtml(page.layout === 'article' ? 'docs' : 'shell')}</small>
              </div>
            </div>
          </div>
        </div>
      </main>
    `}
  </div>
  <script type="application/json" id="__site__">${escapeJson({ site, navItems, page })}</script>
  <script type="module">${clientScript}</script>
  <script type="module">
    import { createElement, applyDiff } from './vendor/webjsx/dist/index.js';
    const data = JSON.parse(document.getElementById('__site__').textContent);
    const host = document.getElementById('workspace-shell');
    const shellLinks = (data.navItems || []).slice(0, 6);
    const render = () => applyDiff(host, createElement('section', { class: 'mb-4 grid gap-4 rounded-3xl border border-base-300 bg-base-100/85 p-4 shadow-2xl lg:grid-cols-[1.1fr_0.9fr]' },
      createElement('div', { class: 'rounded-2xl border border-base-300 bg-base-200/70 p-4' },
        createElement('div', { class: 'flex flex-wrap items-center justify-between gap-3' },
          createElement('div', null,
            createElement('div', { class: 'text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'webjsx local witness'),
            createElement('div', { class: 'text-lg font-semibold' }, data.site.title || 'gm'),
            createElement('div', { class: 'text-sm text-base-content/60' }, data.site.tagline || '')
          ),
          createElement('div', { class: 'badge badge-outline badge-primary' }, (window.__debug && window.__debug.gm && window.__debug.gm.view && window.__debug.gm.view()) || 'overview')
        ),
        createElement('div', { class: 'mt-4 flex flex-wrap gap-2' },
          createElement('button', { class: 'btn btn-primary btn-sm' }, 'Launch app'),
          createElement('button', { class: 'btn btn-outline btn-sm' }, 'Open docs'),
          createElement('button', { class: 'btn btn-outline btn-sm' }, 'Run checks')
        )
      ),
      createElement('div', { class: 'grid gap-4 sm:grid-cols-2' },
        createElement('div', { class: 'rounded-2xl border border-base-300 bg-base-200/70 p-4' },
          createElement('div', { class: 'text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'dock'),
          createElement('div', { class: 'mt-3 flex flex-wrap gap-2' },
            ...shellLinks.map(([label, href]) => createElement('a', { class: 'btn btn-outline btn-sm', href }, label))
          )
        ),
        createElement('div', { class: 'rounded-2xl border border-base-300 bg-base-200/70 p-4' },
          createElement('div', { class: 'text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'signals'),
          createElement('div', { class: 'mt-3 grid gap-2' },
            createElement('div', { class: 'alert alert-success py-3' }, createElement('span', null, 'XState-backed view state')),
            createElement('div', { class: 'alert alert-info py-3' }, createElement('span', null, 'WebJSX-rendered local panel')),
            createElement('div', { class: 'alert alert-warning py-3' }, createElement('span', null, 'RippleUI stylesheet loaded locally'))
          )
        )
      )
    ));
    render();
  </script>
  <script type="module">
    import { createElement, applyDiff } from './vendor/webjsx/dist/index.js';
    const data = JSON.parse(document.getElementById('__site__').textContent);
    const host = document.getElementById('micro-shell');
    const renderWorkspace = () => applyDiff(host, createElement('div', { class: 'mt-4 grid gap-4 rounded-3xl border border-base-300 bg-base-100/60 p-4 shadow-lg lg:grid-cols-2' },
      createElement('div', { class: 'rounded-2xl border border-base-300 bg-base-200/80 p-4' },
        createElement('div', { class: 'text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'workspace'),
        createElement('div', { class: 'mt-2 text-lg font-semibold' }, data.site.title || 'gm'),
        createElement('div', { class: 'mt-1 text-sm text-base-content/60' }, data.site.description || data.site.tagline || ''),
        createElement('label', { class: 'mt-4 block' },
          createElement('div', { class: 'mb-2 text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'command lane'),
          createElement('input', { class: 'input input-bordered w-full bg-base-100/90', placeholder: 'Search apps, docs, or commands', type: 'search' })
        ),
        createElement('div', { class: 'mt-4 flex flex-wrap gap-2' },
          createElement('a', { class: 'btn btn-primary btn-sm', href: './' }, 'Home'),
          createElement('a', { class: 'btn btn-outline btn-sm', href: './paper/' }, 'Paper'),
          createElement('a', { class: 'btn btn-outline btn-sm', href: './stats/' }, 'Stats')
        )
      ),
      createElement('div', { class: 'rounded-2xl border border-base-300 bg-base-200/80 p-4' },
        createElement('div', { class: 'text-xs uppercase tracking-[0.24em] text-base-content/50' }, 'telemetry'),
        createElement('div', { class: 'mt-2 grid gap-2' },
          createElement('div', { class: 'alert alert-info py-3' }, createElement('span', null, 'view: ' + ((window.__debug && window.__debug.gm && window.__debug.gm.view && window.__debug.gm.view()) || 'overview'))),
          createElement('div', { class: 'alert alert-success py-3' }, createElement('span', null, 'surfaces: ' + ((window.__debug && window.__debug.gm && window.__debug.gm.count && window.__debug.gm.count()) || 0))),
          createElement('div', { class: 'alert alert-warning py-3' }, createElement('span', null, 'browser-witnessed and local'))
        )
      )
    ));
    renderWorkspace();
  </script>
</body>
</html>`;
};

export default {
  render: async (ctx) => {
    const site = ctx.readGlobal('site') || {};
    const nav = ctx.readGlobal('navigation') || { links: [] };
    const navItems = flattenNav(nav);
    const docs = ctx.read('pages').docs;
    if (!docs.length) throw new Error('no pages found in site/content/pages');

    const formatStat = n => {
      if (n == null || isNaN(n)) return null;
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(n);
    };
    const readJson = rel => {
      try {
        const p = resolve(THIS_DIR, '..', rel);
        if (!existsSync(p)) return null;
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch { return null; }
    };
    const starsJson = readJson('docs/api/stars.json');
    const npmJson = readJson('docs/api/npm-downloads.json');
    const liveStats = {
      stars: (() => {
        const arr = Array.isArray(starsJson) ? starsJson : (starsJson && starsJson.stars) || [];
        const last = arr[arr.length - 1];
        return formatStat(last && last.count);
      })(),
      npm: formatStat(npmJson && npmJson.total_30d),
    };

    const outputs = [];
    for (const doc of docs) {
      const id = doc.id;
      if (!id) throw new Error('page missing id: ' + JSON.stringify(doc).slice(0, 100));
      const path = id === 'home' ? 'index.html' : `${id}/index.html`;
      if (id === 'home' && doc.hero) doc.hero = { ...doc.hero, stats: liveStats };

      let page = doc;
      if (doc.layout === 'article') {
        if (!doc.source) throw new Error(`article page ${id} missing source`);
        const sourcePath = resolve(THIS_DIR, doc.source);
        if (!existsSync(sourcePath)) throw new Error(`source not found: ${sourcePath}`);
        const raw = readFileSync(sourcePath, 'utf8');
        let articleHtml = extractArticle(raw);
        articleHtml = rewriteLegacyLinks(articleHtml, '');
        page = { ...doc, articleHtml };
      }
      outputs.push({ path, html: renderHtml({ site, navItems, page }) });
    }
    return outputs;
  }
};
