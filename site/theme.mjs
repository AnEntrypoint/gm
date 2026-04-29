import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

const SDK_URL = 'https://unpkg.com/anentrypoint-design@latest/dist/247420.js';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

function extractArticle(html) {
  const bodyOpen = html.search(/<body[^>]*>/i);
  if (bodyOpen < 0) return html;
  const bodyStart = html.indexOf('>', bodyOpen) + 1;
  const bodyEnd = html.lastIndexOf('</body>');
  let body = html.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : html.length);
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
  const map = {
    './index.html': basePath + '/',
    './paper.html': basePath + '/paper/',
    './paper2.html': basePath + '/paper2/',
    './paper3.html': basePath + '/paper3/',
    './paper4.html': basePath + '/paper4/',
    './distribution.html': basePath + '/distribution/',
    './made-with.html': basePath + '/made-with/',
    './stats.html': basePath + '/stats/',
  };
  for (const [from, to] of Object.entries(map)) {
    html = html.split(from).join(to);
  }
  return html;
}

const ARTICLE_CSS = `
.gm-article-wrap{max-width:72ch;margin:0 auto;padding:24px 32px}
.gm-article-wrap .title-block{padding-top:24px;padding-bottom:8px}
.gm-article-wrap .title-block h1{font-size:36px;font-weight:600;letter-spacing:-0.01em;line-height:1.15;color:var(--panel-text);margin:0 0 8px 0}
.gm-article-wrap .title-block .author,.gm-article-wrap .title-block .date{font-family:var(--ff-mono);font-size:12px;color:var(--panel-text-2);margin-top:4px;text-transform:lowercase}
.gm-article-wrap .abstract-block{margin:24px 0;background:var(--panel-1);border-radius:8px;box-shadow:var(--panel-shadow);padding:16px 20px}
.gm-article-wrap .abstract-block .abstract-title{font-family:var(--ff-mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--panel-text-2);margin-bottom:8px}
.gm-article-wrap .abstract-block .abstract-text{font-size:14px;line-height:1.6;color:var(--panel-text)}
.gm-article-wrap article h1,.gm-article-wrap article h2,.gm-article-wrap h2{font-size:22px;font-weight:600;color:var(--panel-text);margin:32px 0 8px 0;letter-spacing:-0.005em}
.gm-article-wrap article h3,.gm-article-wrap h3{font-family:var(--ff-mono);font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--panel-text-2);margin:24px 0 8px 0}
.gm-article-wrap article p,.gm-article-wrap article li,.gm-article-wrap p,.gm-article-wrap li{font-size:14px;line-height:1.6;color:var(--panel-text)}
.gm-article-wrap article p,.gm-article-wrap p{margin:0 0 12px 0}
.gm-article-wrap article pre,.gm-article-wrap pre{background:var(--panel-2);padding:12px 16px;border-radius:6px;overflow-x:auto;font-family:var(--ff-mono);font-size:12px;color:var(--panel-text)}
.gm-article-wrap article code,.gm-article-wrap code{font-family:var(--ff-mono);font-size:12px;background:var(--panel-2);padding:1px 6px;border-radius:4px;color:var(--panel-text)}
.gm-article-wrap article pre code,.gm-article-wrap pre code{padding:0;background:transparent}
.gm-article-wrap article a,.gm-article-wrap a{color:var(--panel-accent);text-decoration:underline;text-underline-offset:3px}
.gm-article-wrap article a:hover,.gm-article-wrap a:hover{color:var(--panel-accent-2)}
.gm-article-wrap article blockquote,.gm-article-wrap blockquote{margin:12px 0;padding:8px 16px;background:var(--panel-1);border-radius:6px;box-shadow:var(--panel-shadow);color:var(--panel-text-2);font-style:italic}
.gm-article-wrap article ul,.gm-article-wrap article ol,.gm-article-wrap ul,.gm-article-wrap ol{padding-left:24px}
.gm-article-wrap article hr,.gm-article-wrap hr{border:0;height:1px;background:var(--panel-3);margin:24px 0}
.gm-article-wrap .theorem{border-left:3px solid var(--panel-accent);padding:8px 16px;margin:12px 0;background:var(--panel-1);border-radius:0 6px 6px 0}
.gm-article-wrap dl{margin:12px 0}
.gm-article-wrap dt{font-family:var(--ff-mono);font-size:12px;color:var(--panel-text);font-weight:600;margin-top:8px}
.gm-article-wrap dd{font-size:14px;line-height:1.6;color:var(--panel-text);margin:0 0 0 16px}
`;

const landingClient = `
import { h, applyDiff, installStyles, components as C } from 'anentrypoint-design';
installStyles();
document.documentElement.classList.add('ds-247420');
const data = JSON.parse(document.getElementById('__site__').textContent);
const { site, nav, page } = data;

function Hero() {
  if (!page || !page.hero) return null;
  return C.Panel({
    style: 'margin:8px',
    children: h('div', { style: 'padding:24px 22px' },
      C.Heading({ level: 1, style: 'margin:0 0 8px 0', children: page.hero.heading || site.title }),
      page.hero.subheading ? C.Lede({ children: page.hero.subheading }) : null,
      page.hero.body ? h('p', { style: 'margin:8px 0 16px 0;color:var(--panel-text-2);max-width:64ch' }, page.hero.body) : null,
      (page.hero.badges && page.hero.badges.length) ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px 0' },
        ...page.hero.badges.map((b, i) => C.Chip({ key: 'b' + i, children: b.label }))
      ) : null,
      (page.hero.ctas && page.hero.ctas.length) ? h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        ...page.hero.ctas.map((c, i) => C.Btn({ key: 'c' + i, href: c.href, primary: c.primary, children: c.label }))
      ) : null
    )
  });
}

function Features() {
  if (!page || !page.features || !page.features.items || !page.features.items.length) return null;
  const rows = page.features.items.map((it, i) => C.RowLink({
    key: 'f' + i,
    code: String(i + 1).padStart(2, '0'),
    title: it.name,
    sub: it.desc || '',
    meta: it.meta || '',
    href: it.href || '#'
  }));
  return C.Panel({
    title: page.features.heading || 'features',
    style: 'margin:8px',
    children: rows
  });
}

function Quickstart() {
  if (!page || !page.quickstart || !page.quickstart.lines || !page.quickstart.lines.length) return null;
  const lineNodes = page.quickstart.lines.map((l, i) => {
    const isComment = l.kind === 'cmt';
    return h('div', { key: 'q' + i, class: 'cli' },
      h('span', { class: 'prompt' }, isComment ? '#' : '$'),
      h('span', { class: 'cmd' }, l.text)
    );
  });
  return C.Panel({
    title: page.quickstart.heading || 'quick start',
    style: 'margin:8px',
    children: h('div', { style: 'padding:16px 22px' }, ...lineNodes)
  });
}

function Examples() {
  if (!page || !page.examples || !page.examples.items || !page.examples.items.length) return null;
  const rows = page.examples.items.map((it, i) => C.RowLink({
    key: 'e' + i,
    title: it.name,
    sub: it.desc || '',
    meta: it.cta || 'open',
    href: it.href || '#'
  }));
  return C.Panel({
    title: page.examples.heading || 'examples',
    style: 'margin:8px',
    children: rows
  });
}

function Footer() {
  return h('footer', { class: 'app-status' },
    h('span', { class: 'item' }, 'styled with '),
    h('a', { class: 'item', href: 'https://anentrypoint.github.io/design/' }, 'anentrypoint-design'),
    h('span', { class: 'item' }, '·'),
    h('a', { class: 'item', href: 'https://247420.xyz' }, '247420.xyz'),
    h('span', { class: 'spread' }),
    site.repo ? h('a', { class: 'item', href: site.repo }, 'source ↗') : null
  );
}

const navItems = (nav && nav.links ? nav.links : []).map(l => [String(l.label || ''), l.href]);

const App = C.AppShell({
  topbar: C.Topbar({ brand: '247420', leaf: site.title || '', items: navItems }),
  crumb: C.Crumb({ trail: ['247420'], leaf: site.title || '' }),
  main: h('div', {}, Hero(), Features(), Quickstart(), Examples()),
  status: Footer()
});
applyDiff(document.getElementById('app'), [App]);
`;

const articleClient = `
import { h, applyDiff, installStyles, components as C } from 'anentrypoint-design';
installStyles();
document.documentElement.classList.add('ds-247420');
const data = JSON.parse(document.getElementById('__site__').textContent);
const { site, nav, page } = data;
const navItems = (nav && nav.links ? nav.links : []).map(l => [String(l.label || ''), l.href]);

function Footer() {
  return h('footer', { class: 'app-status' },
    h('span', { class: 'item' }, 'styled with '),
    h('a', { class: 'item', href: 'https://anentrypoint.github.io/design/' }, 'anentrypoint-design'),
    h('span', { class: 'item' }, '·'),
    h('a', { class: 'item', href: 'https://247420.xyz' }, '247420.xyz'),
    h('span', { class: 'spread' }),
    site.repo ? h('a', { class: 'item', href: site.repo }, 'source ↗') : null
  );
}

const App = C.AppShell({
  topbar: C.Topbar({ brand: '247420', leaf: site.title || '', items: navItems }),
  crumb: C.Crumb({ trail: ['247420', 'gm'], leaf: page.title || '' }),
  main: h('div', { class: 'gm-article-wrap', innerHTML: page.articleHtml || '' }),
  status: Footer()
});
applyDiff(document.getElementById('app'), [App]);
`;

const renderHtml = ({ site, nav, page, clientScript, extraStyles }) => `<!DOCTYPE html>
<html lang="en" class="ds-247420">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title || site.title)}${site.tagline ? ' — ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(page.description || site.description || site.tagline || site.title)}" />
  <meta property="og:title" content="${escapeHtml(page.title || site.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description || site.description || site.tagline || '')}" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(site.glyph || '◆')}%3C/text%3E%3C/svg%3E" />
  <script type="importmap">{"imports":{"anentrypoint-design":"${SDK_URL}"}}</script>
  <style>html,body{margin:0;padding:0}body{background:var(--app-bg,#FBF6EB);color:var(--ink,#1F1B16);font-family:var(--ff-ui,'Nunito',system-ui,sans-serif)}${extraStyles || ''}</style>
</head>
<body>
  <div id="app"></div>
  <script type="application/json" id="__site__">${escapeJson({ site, nav, page })}</script>
  <script type="module">${clientScript}</script>
</body>
</html>
`;

export default {
  render: async (ctx) => {
    const site = ctx.readGlobal('site') || {};
    const nav = ctx.readGlobal('navigation') || { links: [] };
    const docs = ctx.read('pages').docs;
    if (!docs.length) throw new Error('no pages found in site/content/pages');

    const outputs = [];
    for (const doc of docs) {
      const id = doc.id;
      if (!id) throw new Error('page missing id: ' + JSON.stringify(doc).slice(0, 100));
      const path = id === 'home' ? 'index.html' : `${id}/index.html`;

      if (doc.layout === 'article') {
        if (!doc.source) throw new Error(`article page ${id} missing source`);
        const sourcePath = resolve(THIS_DIR, doc.source);
        if (!existsSync(sourcePath)) throw new Error(`source not found: ${sourcePath}`);
        const raw = readFileSync(sourcePath, 'utf8');
        let articleHtml = extractArticle(raw);
        articleHtml = rewriteLegacyLinks(articleHtml, '');
        const page = { ...doc, articleHtml };
        outputs.push({
          path,
          html: renderHtml({ site, nav, page, clientScript: articleClient, extraStyles: ARTICLE_CSS })
        });
      } else {
        outputs.push({
          path,
          html: renderHtml({ site, nav, page: doc, clientScript: landingClient })
        });
      }
    }
    return outputs;
  }
};
