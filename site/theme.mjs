import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

function extractArticle(html) {
  const bodyOpen = html.search(/<body[^>]*>/i);
  if (bodyOpen < 0) return html;
  const bodyStart = html.indexOf('>', bodyOpen) + 1;
  const bodyEnd = html.lastIndexOf('</body>');
  let body = html.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : html.length);
  body = body.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  body = body.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
  return body.trim();
}

function rewriteLegacyLinks(html, basePath) {
  const slugs = ['index', 'paper', 'distribution', 'made-with', 'stats', 'crates', 'skills'];
  const slugToPath = { index: '/', paper: '/paper/', distribution: '/distribution/', 'made-with': '/made-with/', stats: '/stats/', crates: '/crates/', skills: '/skills/' };
  return html.replace(/href="([^"]+)"/g, (full, hrefRaw) => {
    const href = hrefRaw.trim();
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('/')) return full;
    let path = href, hash = '';
    const hi = path.indexOf('#');
    if (hi >= 0) { hash = path.slice(hi); path = path.slice(0, hi); }
    path = path.replace(/^\.\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    if (slugs.includes(path)) return `href="${basePath}${slugToPath[path]}${hash}"`;
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

const SDK_CSS = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.css';
const SDK_JS  = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.js';

const CLIENT_SCRIPT = `
import * as ds from '${SDK_JS}';
window.ds = ds;
if (ds.initTheme) ds.initTheme();

const data = JSON.parse(document.getElementById('__site__').textContent);
const { site, navItems, page } = data;
const C = ds.components || {};
const h = ds.h;

const navItemsKit = navItems.map(([label, href]) => [label, href]);
const activeLabel = (() => {
  const seg = (p) => (String(p).replace(/[#?].*$/, '').replace(/^\\.?\\//, '').replace(/\\/$/, '').split('/').filter(Boolean).pop() || '');
  const here = seg(location.pathname);
  const hit = navItems.find(([, href]) => {
    const h = String(href);
    if (/^https?:/.test(h)) return false;
    return seg(h) === here;
  });
  return hit ? hit[0] : (navItems[0] && navItems[0][0]) || '';
})();

const siteRoot = (() => {
  const segNorm = (p) => String(p).replace(/[#?].*$/, '').replace(/^\\.\\//, '').replace(/^\\/+|\\/+$/g, '');
  const here = location.pathname.replace(/[#?].*$/, '');
  const activeEntry = navItems.find(([l]) => l === activeLabel);
  const activeRel = activeEntry ? segNorm(activeEntry[1]) : '';
  if (activeRel && here.replace(/\\/+$/, '').endsWith('/' + activeRel)) {
    return here.replace(/\\/+$/, '').slice(0, here.replace(/\\/+$/, '').length - activeRel.length) || '/';
  }
  return here.endsWith('/') ? here : here.replace(/[^/]*$/, '');
})();
const toRootHref = (href) => {
  const h = String(href);
  if (/^https?:/.test(h) || h.startsWith('#') || h.startsWith('mailto:')) return h;
  if (h.startsWith('/')) return h;
  return siteRoot.replace(/\\/+$/, '/') + h.replace(/^\\.\\//, '').replace(/^\\/+/, '');
};
const onNav = (label) => {
  const entry = navItems.find(([l]) => l === label);
  if (entry) location.href = toRootHref(entry[1]);
};

const ThemeToggleSlot = () => C.ThemeToggle ? C.ThemeToggle({}) : null;

const topbar = C.Topbar ? C.Topbar({
  brand: site.title || 'gm',
  leaf: activeLabel,
  items: navItemsKit,
  active: activeLabel,
  onNav,
}) : null;

const crumb = C.Crumb ? C.Crumb({
  trail: [site.title || 'gm'],
  leaf: page.title || activeLabel || '',
  right: [
    site.tagline ? C.Chip({ tone: 'dim', children: site.tagline }) : null,
    ThemeToggleSlot(),
  ].filter(Boolean),
}) : null;

const status = C.Status ? C.Status({
  left: [
    site.title || 'gm',
    site.code ? site.code : null,
    site.category ? site.category : null,
  ].filter(Boolean),
  right: [
    site.year ? String(site.year) : null,
    site.repo ? h('a', { href: site.repo, target: '_blank', rel: 'noopener' }, 'source') : null,
  ].filter(Boolean),
}) : null;

const buildArticleMain = () => {
  const main = [];
  if (C.Heading) main.push(C.Heading({ level: 1, children: page.title || site.title || '' }));
  if (page.subtitle && C.Lede) main.push(C.Lede({ children: page.subtitle }));
  else if (page.description && C.Lede) main.push(C.Lede({ children: page.description }));
  main.push(h('div', { class: 'ds-prose', id: 'ds-article-host' }));
  return main;
};

const buildLandingMain = () => {
  const main = [];
  const hero = page.hero || {};
  if (C.Heading) main.push(C.Heading({ level: 1, children: hero.heading || site.title || '' }));
  if ((hero.subheading || hero.body) && C.Lede) main.push(C.Lede({ children: hero.subheading || hero.body }));
  if (hero.subheading && hero.body) {
    main.push(h('p', { class: 'ds-prose' }, hero.body));
  }

  const ctas = (hero.ctas || []).map((c) => h('a', {
    class: c.primary ? 'btn-primary' : 'btn',
    href: c.href,
  }, c.label));
  if (ctas.length) main.push(h('div', { class: 'work-detail-chips' }, ...ctas));

  const badges = (hero.badges || []).map((b, i) => C.Chip ? C.Chip({ key: i, tone: 'dim', children: b.label }) : h('span', { key: i }, b.label));
  if (badges.length) main.push(h('div', { class: 'work-detail-chips' }, ...badges));

  const features = page.features;
  if (features && features.items && features.items.length && C.Panel) {
    main.push(C.Panel({
      title: features.heading || 'features',
      count: features.items.length,
      children: features.items.map((it, i) => h('div', { key: i, class: 'row' },
        h('span', { class: 'code' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'title' }, it.name || '', it.desc ? h('span', { class: 'sub' }, it.desc) : null),
        h('span', { class: 'meta' }, '')
      )),
    }));
  }

  const qs = page.quickstart;
  if (qs && qs.lines && qs.lines.length) {
    main.push(h('h3', {}, qs.heading || 'quick start'));
    main.push(h('div', { class: 'cli' },
      ...qs.lines.map((ln, i) => {
        if (!ln) return null;
        if (ln.kind === 'cmt') return h('div', { key: i, class: 'cli-cmt' }, ln.text || ' ');
        if (ln.text) {
          return h('div', { key: i, class: 'cli-line' },
            h('span', { class: 'prompt' }, '$'),
            h('span', { class: 'cmd' }, ln.text)
          );
        }
        return null;
      }).filter(Boolean)
    ));
  }

  const ex = page.examples;
  if (ex && ex.items && ex.items.length && C.Panel) {
    main.push(C.Panel({
      title: ex.heading || 'read further',
      count: ex.items.length,
      children: ex.items.map((it, i) => h('a', { key: i, class: 'row', href: it.href || '#' },
        h('span', { class: 'code' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'title' }, it.name || '', it.desc ? h('span', { class: 'sub' }, it.desc) : null),
        h('span', { class: 'meta' }, it.cta || 'open')
      )),
    }));
  }

  return main;
};

const main = page.layout === 'article' ? buildArticleMain() : buildLandingMain();

const WIDE_ARTICLES = ['made-with', 'stats', 'paper'];
const shell = C.AppShell ? C.AppShell({
  topbar, crumb, main, status,
  narrow: page.layout === 'article' && !WIDE_ARTICLES.includes(page.id),
}) : h('div', {}, ...main);

const root = document.getElementById('app');
if (ds.applyDiff) ds.applyDiff(root, shell);
else if (ds.mount) ds.mount(root, shell);
else { root.innerHTML = ''; root.appendChild(shell); }

if (page.layout === 'article') {
  document.documentElement.classList.add('article-flow');
}
const GRID_PAGES = ['made-with', 'stats'];
if (page.layout !== 'article' && !GRID_PAGES.includes(page.id)) {
  document.documentElement.classList.add('landing-capped');
}
if (page.layout === 'article' && page.articleHtml) {
  const host = document.getElementById('ds-article-host');
  if (host) {
    host.innerHTML = page.articleHtml;
    const firstH1 = host.querySelector('h1');
    if (firstH1) {
      const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const a = norm(firstH1.textContent), t = norm(page.title);
      if (t && (a === t || a.startsWith(t) || t.startsWith(a))) firstH1.remove();
    }
    const toc = host.querySelector('.toc');
    if (toc) {
      if (toc.parentElement !== host) host.insertBefore(toc, host.firstChild);
      host.classList.add('has-toc');
      const col = document.createElement('div');
      col.className = 'article-col';
      let node = toc.nextSibling;
      while (node) {
        const next = node.nextSibling;
        col.appendChild(node);
        node = next;
      }
      host.appendChild(col);
    }
    const blocks = host.querySelectorAll('.mermaid');
    if (blocks.length) {
      import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(({ default: mermaid }) => {
        const dark = matchMedia('(prefers-color-scheme: dark)').matches;
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'loose' });
        mermaid.run({ nodes: blocks });
      }).catch(() => {});
    }
    const loadExternal = (src) => new Promise((res) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = res;
      document.head.appendChild(s);
    });
    const reviveScripts = async (root) => {
      const olds = [...root.querySelectorAll('script')];
      const externals = olds.filter((s) => s.src);
      const inlines = olds.filter((s) => !s.src);
      const needsChart = inlines.some((s) => /new\\s+Chart\\b/.test(s.textContent));
      if (needsChart && typeof window.Chart === 'undefined') {
        await loadExternal('https://cdn.jsdelivr.net/npm/chart.js');
      }
      const swap = (old) => new Promise((res) => {
        const fresh = document.createElement('script');
        for (const a of old.attributes) fresh.setAttribute(a.name, a.value);
        fresh.textContent = old.textContent;
        if (old.src) { fresh.onload = res; fresh.onerror = res; } else { queueMicrotask(res); }
        old.replaceWith(fresh);
      });
      for (const s of externals) await swap(s);
      for (const s of inlines) await swap(s);
    };
    reviveScripts(host);
  }
}

window.__debug = window.__debug || {};
window.__debug.gm = { page: page.id || '', layout: page.layout || 'landing', nav: navItems.length };
`;

const renderHtml = ({ site, navItems, page }) => `<!DOCTYPE html>
<html lang="en" class="ds-247420" data-theme="auto">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title || site.title)}${site.tagline ? ', ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(page.description || site.description || site.tagline || site.title)}" />
  <meta property="og:title" content="${escapeHtml(page.title || site.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description || site.description || site.tagline || '')}" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(site.glyph || 'g')}%3C/text%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${SDK_CSS}" />
  <style>
    html.article-flow, html.article-flow body { height: auto !important; min-height: 100% !important; overflow-y: auto !important; }
    html.article-flow #app, html.article-flow .app, html.article-flow .app-body, html.article-flow .app-main {
      height: auto !important; max-height: none !important; min-height: 0 !important; overflow: visible !important;
    }
    html.landing-capped .app-main > * { max-width: var(--measure-wide, 940px); margin-left: auto; margin-right: auto; width: 100%; }
    @media (max-width: 640px) {
      .app-crumb .ds-chip, .app-crumb [class*="chip"] { display: none; }
      .app-crumb .ds-theme-toggle, .app-crumb [class*="theme-toggle"] { display: inline-flex; }
    }
    #ds-article-host section { position: relative; }
    #ds-article-host canvas { display: block; width: 100% !important; max-width: 100%; height: 300px !important; max-height: 300px; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="__site__">${escapeJson({ site, navItems, page })}</script>
  <script type="module">${CLIENT_SCRIPT}</script>
</body>
</html>`;

export default {
  render: async (ctx) => {
    const site = ctx.readGlobal('site') || {};
    const nav = ctx.readGlobal('navigation') || { links: [] };
    const navItems = flattenNav(nav);
    const docs = ctx.read('pages').docs;
    if (!docs.length) throw new Error('no pages found in site/content/pages');

    const formatStat = (n) => {
      if (n == null || isNaN(n)) return null;
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(n);
    };
    const readJson = (rel) => {
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
  },
};
