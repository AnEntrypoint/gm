// AnEntrypoint design-system theme for flatspace.
// Renders site chrome via anentrypoint-design SDK on the client (importmap → unpkg),
// theme.mjs only emits the static HTML shell + bootstrap script that consumes the YAML
// content that flatspace baked into <script type="application/json" id="__site__">.

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const SDK_URL = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.js';

const clientScript = `
import { h, applyDiff, installStyles } from 'anentrypoint-design';
installStyles();

const data = JSON.parse(document.getElementById('__site__').textContent);
const { site, nav, home } = data;
const accent = \`linear-gradient(135deg, \${site.accent_from || '#58a6ff'}, \${site.accent_to || '#bc8cff'})\`;

function Hero() {
  return h('div', { class: 'hero' },
    h('h1', { class: 'hero-h1' }, home.hero.heading),
    home.hero.subheading ? h('p', { class: 'hero-sub' }, home.hero.subheading) : null,
    home.hero.body ? h('p', { class: 'hero-body' }, home.hero.body) : null,
    h('div', { class: 'badge-row' },
      ...(home.hero.badges || []).map((b, i) => h('span', { class: 'badge', key: i }, b.label))
    ),
    h('div', { class: 'cta-row' },
      ...(home.hero.ctas || []).map((c, i) => h('a', {
        href: c.href, key: i,
        class: 'btn btn-sm ' + (c.primary ? 'btn-primary' : 'btn-ghost'),
        style: 'text-decoration:none'
      }, c.label))
    )
  );
}

function Features() {
  if (!home.features || !home.features.items) return null;
  return h('section', { class: 'section' },
    h('h2', {}, home.features.heading || 'Features'),
    h('div', { class: 'grid-cards' },
      ...home.features.items.map((it, i) =>
        h('div', { class: 'card', key: i },
          h('h3', {}, it.name),
          h('p', {}, it.desc || '')
        )
      )
    )
  );
}

function Quickstart() {
  if (!home.quickstart || !home.quickstart.lines) return null;
  const cls = { cmt: 'cmt', cmd: '', str: 'str', kw: 'kw', fn: 'fn' };
  return h('section', { class: 'section' },
    h('h2', {}, home.quickstart.heading || 'Quick start'),
    h('div', { class: 'code-block' },
      h('pre', {},
        ...home.quickstart.lines.map((l, i) => {
          const c = cls[l.kind] || '';
          return h('span', { key: i, class: c }, l.text + '\n');
        })
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'app-footer' },
    h('span', {}, 'styled with '),
    h('a', { href: 'https://github.com/AnEntrypoint/design' }, 'anentrypoint-design'),
    h('span', {}, ' · part of '),
    h('a', { href: 'https://247420.xyz' }, '247420.xyz'),
    h('span', {}, ' · '),
    h('a', { href: site.repo }, 'source')
  );
}

function App() {
  return h('div', {}, Hero(), Features(), Quickstart(), Footer());
}

applyDiff(document.getElementById('app'), [App()]);
`;

const html = ({ site, nav, home }) => `<!DOCTYPE html>
<html lang="en" class="ds-247420">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(site.title)}${site.tagline ? ' — ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(site.description || site.tagline || site.title)}" />
  <meta property="og:title" content="${escapeHtml(site.title)}" />
  <meta property="og:description" content="${escapeHtml(site.description || site.tagline || '')}" />
  <meta property="og:url" content="${escapeHtml(site.url || '')}" />
  <link rel="canonical" href="${escapeHtml(site.url || '')}" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(site.glyph || '◆')}%3C/text%3E%3C/svg%3E" />
  <script type="importmap">{"imports":{"anentrypoint-design":"${SDK_URL}"}}</script>
  <style>
    body { margin: 0; }
    .hero { padding: 5rem 2rem 3rem; text-align: center; background: linear-gradient(135deg, var(--panel-bg, #0d1117) 0%, var(--panel-bg-2, #161b22) 100%); border-bottom: 1px solid var(--panel-border, #30363d); }
    .hero-h1 { font-size: 4rem; font-weight: 800; margin: 0 0 1rem; letter-spacing: -2px; background: ${'linear-gradient(135deg, ' + (site.accent_from || '#58a6ff') + ', ' + (site.accent_to || '#bc8cff') + ')'}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero-sub { font-size: 1.25rem; color: var(--panel-muted, #8b949e); max-width: 640px; margin: 0 auto 0.75rem; line-height: 1.6; }
    .hero-body { font-size: 1rem; color: var(--panel-muted, #8b949e); max-width: 640px; margin: 0 auto 2rem; line-height: 1.6; }
    .badge-row { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2rem; }
    .badge { background: var(--panel-bg-2, #21262d); border: 1px solid var(--panel-border, #30363d); border-radius: 9999px; padding: 0.25rem 0.75rem; font-size: 0.75rem; color: var(--panel-muted, #8b949e); }
    .cta-row { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .section { max-width: 1100px; margin: 0 auto; padding: 3rem 2rem; }
    .section h2 { font-size: 1.75rem; font-weight: 700; color: var(--panel-text, #e6edf3); margin-bottom: 1.5rem; border-bottom: 1px solid var(--panel-border, #21262d); padding-bottom: 0.75rem; }
    .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
    .card { background: var(--panel-bg-2, #161b22); border: 1px solid var(--panel-border, #30363d); border-radius: 12px; padding: 1.25rem; }
    .card h3 { margin: 0 0 0.5rem; font-size: 1rem; color: ${site.accent_to || '#bc8cff'}; font-family: var(--ff-mono, ui-monospace, monospace); }
    .card p { margin: 0; color: var(--panel-muted, #8b949e); font-size: 0.85rem; line-height: 1.5; }
    .code-block { background: var(--panel-bg-2, #161b22); border: 1px solid var(--panel-border, #30363d); border-radius: 12px; padding: 1.5rem; overflow-x: auto; }
    .code-block pre { margin: 0; font-family: var(--ff-mono, ui-monospace, monospace); font-size: 0.85rem; color: var(--panel-text, #e6edf3); line-height: 1.6; }
    .cmt { color: var(--panel-muted, #8b949e); }
    .str { color: #a5d6ff; } .kw { color: #ff7b72; } .fn { color: #d2a8ff; }
    .app-footer { border-top: 1px solid var(--panel-border, #21262d); padding: 2rem; text-align: center; color: var(--panel-muted, #8b949e); font-size: 0.85rem; }
    .app-footer a { color: #58a6ff; text-decoration: none; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="__site__">${escapeJson({ site, nav, home })}</script>
  <script type="module">${clientScript}</script>
</body>
</html>
`;

export default {
  render: async (ctx) => {
    const site = ctx.readGlobal('site') || {};
    const nav = ctx.readGlobal('navigation') || { links: [] };
    const homeDoc = ctx.read('pages').docs.find(p => p.id === 'home');
    if (!homeDoc) throw new Error('config/pages/home.yaml missing or has no id: home');

    return [{
      path: 'index.html',
      html: html({ site, nav, home: homeDoc })
    }];
  }
};
