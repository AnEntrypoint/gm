import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

const SDK_JS = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.js';
const SDK_CSS = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.css';

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
import { mount, h, components as C } from 'anentrypoint-design';
const data = JSON.parse(document.getElementById('__site__').textContent);
const { site, navItems, page } = data;

function renderHero(hero) {
  if (!hero) return null;
  const actions = (hero.ctas || []).map((c, i) => C.Btn({ key: 'c' + i, href: c.href, primary: c.primary, children: c.label }));
  const badges = (hero.badges && hero.badges.length)
    ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' },
        ...hero.badges.map((b, i) => C.Chip({ key: 'b' + i, children: b.label })))
    : null;
  return C.Section({
    children: [
      C.Hero({ title: hero.heading || site.title, body: hero.subheading || '', accent: hero.body || '', actions }),
      badges
    ].filter(Boolean)
  });
}

function renderFeatures(features) {
  if (!features || !features.items || !features.items.length) return null;
  return C.Section({
    eyebrow: 'features', title: features.heading || '',
    children: C.Panel({
      children: features.items.map((it, i) => C.RowLink({
        key: 'f' + i, code: String(i + 1).padStart(2, '0'),
        title: it.name, sub: it.desc || '', meta: it.meta || '',
        href: it.href || '#'
      }))
    })
  });
}

function renderQuickstart(qs) {
  if (!qs || !qs.lines || !qs.lines.length) return null;
  return C.Section({
    eyebrow: 'quick start', title: qs.heading || '',
    children: C.Panel({
      children: qs.lines.map((l, i) => h('div', { key: 'q' + i, class: 'cli' },
        h('span', { class: 'prompt' }, l.kind === 'cmt' ? '#' : '$'),
        h('span', { class: 'cmd' }, l.text)))
    })
  });
}

function renderExamples(ex) {
  if (!ex || !ex.items || !ex.items.length) return null;
  return C.Section({
    eyebrow: 'examples', title: ex.heading || '',
    children: C.Panel({
      children: ex.items.map((it, i) => C.RowLink({
        key: 'e' + i, title: it.name, sub: it.desc || '', meta: it.cta || 'open',
        href: it.href || '#'
      }))
    })
  });
}

const topbar = C.Topbar({ brand: '247420', leaf: site.title || 'gm', items: navItems });
const status = C.Status({
  left: ['styled with anentrypoint-design'],
  right: site.repo ? ['source ↗'] : []
});

let main;
if (page.layout === 'article') {
  main = h('div', { class: 'ds-prose', style: 'max-width:min(110ch,92vw);margin:0 auto;padding:24px clamp(16px, 4vw, 48px)', innerHTML: page.articleHtml || '' });
} else {
  main = [renderHero(page.hero), renderFeatures(page.features), renderQuickstart(page.quickstart), renderExamples(page.examples)].filter(Boolean);
}

mount(document.getElementById('app'), () => C.AppShell({
  topbar,
  crumb: C.Crumb({ trail: ['247420'], leaf: page.title || site.title || '' }),
  main,
  status
}));

(async () => {
  try {
    const blocks = document.querySelectorAll('.mermaid, pre.mermaid');
    if (!blocks.length) return;
    const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    m.default.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'loose', themeVariables: { fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: '13px' } });
    await m.default.run({ nodes: blocks });
  } catch (e) { console.error('mermaid init failed:', e); }
})();
`;

const renderHtml = ({ site, navItems, page }) => `<!DOCTYPE html>
<html lang="en" class="ds-247420" data-theme="auto">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title || site.title)}${site.tagline ? ' — ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(page.description || site.description || site.tagline || site.title)}" />
  <meta property="og:title" content="${escapeHtml(page.title || site.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description || site.description || site.tagline || '')}" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(site.glyph || '◆')}%3C/text%3E%3C/svg%3E" />
  <link rel="stylesheet" href="${SDK_CSS}" />
  <script type="importmap">{"imports":{"anentrypoint-design":"${SDK_JS}"}}</script>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="__site__">${escapeJson({ site, navItems, page })}</script>
  <script type="module">${clientScript}</script>
</body>
</html>
`;

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
