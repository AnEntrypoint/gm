---
name: pages
description: Scaffold and maintain a GitHub Pages site. Buildless in browser (webjsx + rippleui via CDN), flatspace for content aggregation built during GH Actions. Use when user wants to create or update a GH Pages site.
---

# Pages — GitHub Pages Site Scaffolder

Scaffold a complete GH Pages site: **no local build step**, content managed via flatspace flat-file CMS, UI via webjsx + rippleui CDN, GH Actions builds and deploys.

**Follow full gm skill chain: planning → gm-execute → gm-emit → gm-complete → update-docs.**

## Stack

| Layer | Tool | How |
|-------|------|-----|
| UI rendering | [webjsx](https://webjsx.org) | ES module via importmap, `applyDiff` for DOM updates |
| Styling | [rippleui](https://ripple-ui.com) | CDN `<link>` — Tailwind-based component classes |
| Content CMS | [flatspace](https://npmjs.com/package/flatspace) | Aggregates `content/` → `docs/data/*.json` at build time |
| Build | GH Actions | `npx flatspace` runs in CI, commits output to `docs/` |
| Hosting | GitHub Pages | Source: `docs/` branch, or GH Actions deploy |

## Directory Layout

```
<project>/
  content/              # Source content (markdown, json, yaml)
    pages/              # Static pages (index.md, about.md, ...)
    posts/              # Blog posts or articles
    data/               # Structured data files
  docs/                 # GH Pages root (gitignored build output except index.html)
    index.html          # Entry point — committed, never regenerated
    app.js              # Main webjsx app — committed
    data/               # flatspace output — gitignored, built by CI
  .github/
    workflows/
      pages.yml         # Build + deploy workflow
  flatspace.config.js   # flatspace aggregation config
```

## index.html — Buildless Entry

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SITE_TITLE}}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rippleui@1.12.1/dist/css/styles.css">
  <script type="importmap">
  {
    "imports": {
      "webjsx": "https://cdn.jsdelivr.net/npm/webjsx@0.0.42/dist/index.js",
      "webjsx/jsx-runtime": "https://cdn.jsdelivr.net/npm/webjsx@0.0.42/dist/jsx-runtime.js"
    }
  }
  </script>
  <script type="module" src="./app.js"></script>
</head>
<body class="bg-backgroundPrimary text-content1 min-h-screen">
  <div id="root"></div>
</body>
</html>
```

## app.js — webjsx App Pattern

```js
import { applyDiff } from 'webjsx';

const h = (tag, props, ...children) => ({ tag, props: props || {}, children });

const state = { page: null, data: {} };

async function loadData(path) {
  const res = await fetch(path);
  return res.json();
}

function render() {
  applyDiff(document.getElementById('root'), App(state));
}

function App(s) {
  if (!s.page) return h('div', { class: 'flex justify-center p-8' },
    h('span', { class: 'spinner' })
  );
  return h('div', { class: 'max-w-4xl mx-auto p-4' },
    h('nav', { class: 'navbar bg-backgroundSecondary mb-6' },
      h('span', { class: 'navbar-brand text-xl font-bold' }, s.page.title)
    ),
    h('main', {}, ...s.page.sections.map(Section))
  );
}

function Section(section) {
  return h('section', { class: 'card mb-4 p-6' },
    h('h2', { class: 'text-2xl font-bold mb-2' }, section.title),
    h('p', { class: 'text-content2' }, section.body)
  );
}

async function main() {
  state.page = await loadData('./data/index.json');
  render();
}

main();
```

## flatspace.config.js

```js
module.exports = {
  input: './content',
  output: './docs/data',
  collections: {
    pages: { dir: 'pages', format: 'markdown' },
    posts: { dir: 'posts', format: 'markdown', sortBy: 'date', order: 'desc' },
    data: { dir: 'data', format: 'json' }
  }
};
```

## GH Actions Workflow — pages.yml

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build content with flatspace
        run: npx flatspace

      - name: Commit built data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/data/
          git diff --staged --quiet || git commit -m "chore: build content [skip ci]"
          git push

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## Scaffolding Steps

When user says "set up pages" or "create GH pages site":

1. **Read** existing `docs/` and `content/` if present — never clobber existing content
2. **Create** directory structure above
3. **Write** `docs/index.html` with correct site title
4. **Write** `docs/app.js` with webjsx app skeleton
5. **Write** `flatspace.config.js`
6. **Write** `.github/workflows/pages.yml`
7. **Write** `content/pages/index.md` with minimal frontmatter (`title`, `sections` array)
8. **Add** `docs/data/` to `.gitignore` (built by CI, not committed by humans)
9. **Verify** GH Pages setting is "GitHub Actions" in repo Settings — remind user if can't verify

## rippleui Component Classes Quick Reference

Use these directly in JSX className strings — no config needed:

| Component | Class |
|-----------|-------|
| Button | `btn btn-primary`, `btn btn-secondary`, `btn btn-ghost` |
| Card | `card p-4` |
| Input | `input input-primary` |
| Navbar | `navbar` + `navbar-brand` |
| Badge | `badge badge-primary` |
| Alert | `alert alert-success`, `alert alert-error` |
| Spinner | `spinner` |
| Divider | `divider` |

Background: `bg-backgroundPrimary`, `bg-backgroundSecondary`. Text: `text-content1`, `text-content2`.

**CSS variable warning**: rippleui color vars (e.g. `--gray-2`) are raw space-separated RGB tuples — not valid CSS colors. Never use them in `rgb()` directly from JS. Use the component classes instead.

## webjsx Patterns

**No JSX transpile needed** — use `h()` factory or import from CDN with importmap and write JSX in `.jsx` files served directly (Chrome supports importmap natively).

For `.js` files without transpile, use the `h` factory pattern shown above.

For `.jsx` with native importmap (no build):
```js
/** @jsxImportSource webjsx */
import { applyDiff } from 'webjsx';
```
Only works if server sets correct MIME type for `.jsx` — GH Pages does not. Use `.js` + `h()` factory.

**applyDiff signature**: `applyDiff(domNode, vnodeOrArray)` — never pass a string, always pass a vnode from `h()`.

**State updates**: mutate `state`, call `render()` — no reactive system, explicit re-render on every change.

## Content Format (flatspace input)

Markdown with YAML frontmatter:
```markdown
---
title: Home
sections:
  - title: Welcome
    body: Hello world
---

# Home

Full markdown body here.
```

flatspace outputs `docs/data/pages/index.json`:
```json
{ "title": "Home", "sections": [...], "body": "<p>Full markdown body here.</p>", "slug": "index" }
```

## Known Gotchas

**GH Pages must be set to "GitHub Actions"** in Settings → Pages. "Deploy from branch" ignores the deploy-pages action entirely.

**docs/data/ must be in .gitignore** but `docs/index.html` and `docs/app.js` must NOT be ignored — they are the committed source files.

**flatspace npx cold start**: first CI run downloads flatspace — takes ~10s extra. Subsequent runs use cache if `actions/setup-node` cache is configured.

**importmap browser support**: all modern browsers support importmap. No IE, no Safari < 16.4. For GH Pages this is fine.

**webjsx CDN version**: pin to explicit version in importmap (e.g. `@0.0.42`) — avoid `@latest` to prevent silent breakage on upstream updates.
