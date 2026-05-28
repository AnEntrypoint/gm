// gm site renderer: delegates to anentrypoint-design SDK (window.ds.components).
// Mirrors C:/dev/247420/lib/components.js: load the SDK from unpkg, render every
// page via C.AppShell + C.Topbar + C.Crumb + C.Panel + C.Status. No vendored
// RippleUI/XState. No inline tokens. Pages render at runtime in the browser.
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

// Client renderer: runs in the browser. Reads __site__ JSON, builds the page
// via window.ds.components (C), mounts into #app. Every surface is an SDK
// primitive: Topbar, AppShell, Crumb, Panel, Section, Install, Receipt,
// Manifesto, Chip, Heading, Lede, Status. No hand-rolled HTML.
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

// Nav hrefs from navigation.yaml are root-relative ("./paper/"). location.href on a relative
// href resolves against the CURRENT page, so from /gm/paper/ a link to "./skills/" wrongly lands
// at /gm/paper/skills/. Resolve every nav href against the SITE ROOT (the deployment base, which
// is /gm/ on Pages and / locally), derived by stripping the active page's own path from the
// current pathname so it works under any base.
const siteRoot = (() => {
  const segNorm = (p) => String(p).replace(/[#?].*$/, '').replace(/^\\.\\//, '').replace(/^\\/+|\\/+$/g, '');
  const here = location.pathname.replace(/[#?].*$/, '');
  const activeEntry = navItems.find(([l]) => l === activeLabel);
  const activeRel = activeEntry ? segNorm(activeEntry[1]) : '';
  if (activeRel && here.replace(/\\/+$/, '').endsWith('/' + activeRel)) {
    return here.replace(/\\/+$/, '').slice(0, here.replace(/\\/+$/, '').length - activeRel.length) || '/';
  }
  // active page is root ("./") or unmatched: root is the dir of the current path
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
  // Article HTML: empty host now; innerHTML injected after applyDiff mounts.
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

  // Hero CTAs + badges
  const ctas = (hero.ctas || []).map((c) => h('a', {
    class: c.primary ? 'btn-primary' : 'btn',
    href: c.href,
  }, c.label));
  if (ctas.length) main.push(h('div', { class: 'work-detail-chips' }, ...ctas));

  const badges = (hero.badges || []).map((b, i) => C.Chip ? C.Chip({ key: i, tone: 'dim', children: b.label }) : h('span', { key: i }, b.label));
  if (badges.length) main.push(h('div', { class: 'work-detail-chips' }, ...badges));

  // Features panel: every item becomes a .row.
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

  // Quickstart: single CLI block (no SDK Install widget; that duplicates the cmd that already lives inline in lines).
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

  // Examples / "read further": Panel of .row links.
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

// Prose articles read best narrow; list/grid pages (showcase, stats) need width.
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
if (page.layout === 'article' && page.articleHtml) {
  const host = document.getElementById('ds-article-host');
  if (host) {
    host.innerHTML = page.articleHtml;
    // The crumb already renders the page title; the article markdown carries its own leading
    // <h1> too, so the title appears twice. Drop the article's leading h1 when it duplicates
    // the page title (prefix match handles the article's longer subtitle form).
    const firstH1 = host.querySelector('h1');
    if (firstH1) {
      const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const a = norm(firstH1.textContent), t = norm(page.title);
      if (t && (a === t || a.startsWith(t) || t.startsWith(a))) firstH1.remove();
    }
    // When the article carries a Contents block, hoist it to a direct child of the host
    // and switch the host to the two-column grid so the .toc sits in a sticky side rail.
    const toc = host.querySelector('.toc');
    if (toc) {
      if (toc.parentElement !== host) host.insertBefore(toc, host.firstChild);
      host.classList.add('has-toc');
    }
    const blocks = host.querySelectorAll('.mermaid');
    if (blocks.length) {
      import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then(({ default: mermaid }) => {
        const dark = matchMedia('(prefers-color-scheme: dark)').matches;
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'loose' });
        mermaid.run({ nodes: blocks });
      }).catch(() => {});
    }
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
    /* The SDK app-shell makes .app-main a fixed-viewport-height column with overflow-y:auto
       (right for app-style surfaces). For a long article that crams the whole paper into a
       short inner scroll box with its own scrollbar; let the article grow and the PAGE scroll. */
    /* The SDK app-shell (.app/.app-body/.app-main) is a fixed-viewport-height layout with
       overflow:hidden/auto, right for OS-window surfaces but wrong for a long article: it clipped
       the paper to ~517px with an inner scrollbar. Free the whole chain so the article flows and
       the document scrolls. html.ds-247420 specificity + !important beats the SDK rules. */
    html.article-flow, html.article-flow body { height: auto !important; min-height: 100% !important; overflow-y: auto !important; }
    html.article-flow #app, html.article-flow .app, html.article-flow .app-body, html.article-flow .app-main {
      height: auto !important; max-height: none !important; min-height: 0 !important; overflow: visible !important;
    }
    .app-main > * { flex-shrink: 0; }
    /* The flatspace-injected article must flow in the page, never inside its own
       scroll box. A narrow AppShell column plus an overflow:auto ancestor squashed
       the paper into a narrow bracket with its own scrollbar; force natural flow and
       full column width so the article scrolls with the page. */
    #ds-article-host, .ds-prose {
      width: 100%;
      max-width: 100%;
      overflow: visible;
      min-height: 0;
    }
    .ds-prose { line-height: 1.65; }
    /* TOC sidebar: when the extracted article carries a .toc, lay the host out as a
       two-column grid with the Contents in a sticky left rail and the article body in
       the right column. The .toc spans all rows; everything else flows in column 2.
       The paper's own .toc head styles are stripped on extraction, so the rail's
       internal typography (title, list, links) is restated here with SDK tokens. */
    #ds-article-host.has-toc {
      display: grid;
      grid-template-columns: 256px minmax(0, 1fr);
      column-gap: 44px;
      align-items: start;
    }
    #ds-article-host.has-toc > .toc {
      grid-column: 1;
      grid-row: 1 / -1;
      position: sticky;
      top: 24px;
      align-self: start;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
      overscroll-behavior: contain;
      margin: 0;
      max-width: 100%;
      padding: 18px 18px 18px 20px;
      background: var(--panel-1);
      border-radius: 10px;
      box-shadow: var(--panel-shadow);
      /* Thin themed scrollbar so the rail does not show a raw wide OS scrollbar. */
      scrollbar-width: thin;
      scrollbar-color: var(--panel-3, #2a2f3a) transparent;
    }
    #ds-article-host.has-toc > .toc::-webkit-scrollbar { width: 8px; }
    #ds-article-host.has-toc > .toc::-webkit-scrollbar-track { background: transparent; }
    #ds-article-host.has-toc > .toc::-webkit-scrollbar-thumb {
      background: var(--panel-3, #2a2f3a);
      border-radius: 8px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    #ds-article-host.has-toc > .toc::-webkit-scrollbar-thumb:hover { background: var(--panel-text-3, #4a5060); background-clip: padding-box; }
    #ds-article-host .toc .toc-title {
      font-family: var(--ff-mono, monospace);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .09em;
      color: var(--panel-text-2);
      margin: 0 0 14px 0;
    }
    #ds-article-host .toc ol { margin: 0; padding-left: 18px; }
    #ds-article-host .toc li { font-size: 13px; line-height: 1.85; color: var(--panel-text); }
    #ds-article-host .toc li::marker { color: var(--panel-text-3, #7a8090); font-variant-numeric: tabular-nums; }
    #ds-article-host .toc a { color: var(--panel-text-2); text-decoration: none; transition: color .12s ease; }
    #ds-article-host .toc a:hover { color: var(--panel-accent, #6ee7b7); }
    #ds-article-host.has-toc > :not(.toc) { grid-column: 2; min-width: 0; }
    @media (max-width: 900px) {
      #ds-article-host.has-toc {
        display: block;
      }
      #ds-article-host.has-toc > .toc {
        position: static;
        max-height: none;
        overflow: visible;
        margin: 0 0 28px 0;
      }
    }
    .ds-prose pre, .ds-prose table { overflow-x: auto; max-width: 100%; }
    .app-main > h1,
    .app-main > h2,
    .app-main > h3 { margin-top: 36px; margin-bottom: 12px; }
    .app-main > h1:first-child { margin-top: 8px; }
    .app-main > .panel,
    .app-main > .work-detail-chips,
    .app-main > .cli { margin-top: 18px; margin-bottom: 18px; }
    .app-main .ds-lede { margin-top: 4px; margin-bottom: 18px; max-width: 64ch; line-height: 1.6; }
    .work-detail-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; row-gap: 10px; }
    .cli {
      display: block;
      background: var(--panel-1, #0f1115);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 16px 0 28px 0;
      font-family: var(--ff-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      font-size: 12.5px;
      line-height: 1.6;
      color: var(--panel-text, #d6d8df);
      box-shadow: var(--panel-shadow, 0 1px 0 rgba(0,0,0,0.04));
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .cli .cli-cmt {
      color: var(--panel-text-3, #7a8090);
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 1.4em;
      padding: 3px 0;
      line-height: 1.6;
    }
    .cli .cli-cmt:empty::before { content: '\\00a0'; }
    .cli .cli-line {
      display: flex;
      gap: 10px;
      padding: 3px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .cli .cli-line .prompt {
      color: var(--panel-accent, #6ee7b7);
      flex: 0 0 auto;
      user-select: none;
    }
    .cli .cli-line .cmd {
      color: var(--panel-text, #d6d8df);
      flex: 1 1 auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .panel .row { align-items: flex-start; padding: 16px 20px; gap: 16px; }
    .panel .row + .row { box-shadow: inset 0 1px 0 rgba(0,0,0,0.06); }
    .panel .row .code { padding-top: 2px; min-width: 28px; }
    .panel .row .meta { padding-top: 2px; opacity: 0.4; }
    .panel .row .title { display: block; line-height: 1.4; }
    .panel .row .title .sub {
      display: block;
      margin-top: 6px;
      font-weight: 400;
      color: var(--panel-text-2, #9aa0ad);
      font-size: 13px;
      line-height: 1.6;
    }
    @media (max-width: 720px) {
      .app-main > h1,
      .app-main > h2,
      .app-main > h3 { margin-top: 28px; }
      .panel .row { padding: 14px 16px; gap: 12px; }
      .cli { padding: 14px 16px; font-size: 12px; }
    }

    /* Article-extracted surfaces (made-with showcase, stats, callouts).
       The source docs' own <style> heads are stripped on extraction, so the
       shell restyles them here with SDK tokens. */
    .ds-prose .card { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; margin: 8px 0; background: var(--panel-1); border-radius: 6px; font-size: 13px; box-shadow: var(--panel-shadow); text-decoration: none; }
    .ds-prose .card:hover { background: var(--panel-hover); }
    .ds-prose .card .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .ds-prose .card .repo-name { font-weight: 600; color: var(--panel-text); }
    .ds-prose .card .stars { color: var(--panel-text-3); font-family: var(--ff-mono); font-size: 12px; flex: 0 0 auto; }
    .ds-prose .card .desc { color: var(--panel-text-2); font-size: 12px; line-height: 1.5; margin: 0; }
    .ds-prose .tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .ds-prose .tag { background: var(--panel-2); color: var(--panel-text-2); border: 1px solid var(--panel-3); font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 3px; font-family: var(--ff-mono, monospace); }
    .ds-prose .gm-callout { margin: 18px 0; padding: 14px 18px; background: var(--panel-1); border-left: 3px solid var(--panel-accent); color: var(--panel-text); }
    .ds-prose .gm-callout .who { display: block; font-family: var(--ff-mono); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--panel-text-2); margin-bottom: 4px; }
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
