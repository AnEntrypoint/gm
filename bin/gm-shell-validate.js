#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = process.cwd();
const WITNESS_DIR = path.join(ROOT, '.gm', 'witness');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function which(cmds) {
  for (const cmd of cmds) {
    try {
      const out = cp.execFileSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
      if (out[0]) return out[0];
    } catch (_) {}
  }
  return '';
}

async function renderPreview() {
  const preview = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-shell-preview-'));
  fs.mkdirSync(path.join(preview, 'vendor'), { recursive: true });
  cp.execSync(`powershell.exe -NoProfile -NonInteractive -Command "Copy-Item -Recurse -Force '${path.join(ROOT, 'site', 'vendor', '*')}' '${path.join(preview, 'vendor')}'"`, { stdio: 'ignore', windowsHide: true });

  const renderScript = `
    import { writeFileSync } from 'fs';
    import { resolve } from 'path';
    const mod = await import('file:///C:/dev/gm/site/theme.mjs');
    const ctx = {
      readGlobal: (k) => {
        if (k === 'site') return { title: 'gm', tagline: "more coushin' for the pushin'", description: 'local browser OS surface', glyph: 'g', accent_from: '#7ee787', accent_to: '#56d364' };
        if (k === 'navigation') return { links: [{ label: 'Home', href: '/' }, { label: 'Paper', href: '/paper/' }, { label: 'Stats', href: '/stats/' }, { label: 'Crates', href: '/crates/' }, { label: 'Skills', href: '/skills/' }] };
        return null;
      },
      read: (k) => {
        if (k === 'pages') return { docs: [{ id: 'home', title: 'gm', layout: 'landing', hero: { heading: 'gm', body: 'local browser OS surface', subheading: 'predictable panes and local vendors', ctas: [{ label: 'Open docs', href: '/paper/', primary: true }], badges: [{ label: 'local' }, { label: 'xstate' }] }, features: { heading: 'features', items: [{ name: 'A', desc: 'a' }, { name: 'B', desc: 'b' }, { name: 'C', desc: 'c' }, { name: 'D', desc: 'd' }] }, examples: { heading: 'docs', items: [{ name: 'Doc', desc: 'd', href: '/paper/', cta: 'open' }] }, quickstart: { lines: [{ kind: 'cmd', text: 'npm run build' }, { kind: 'cmd', text: 'npm start' }] } }] };
        return null;
      }
    };
    const out = await mod.default.render(ctx);
    writeFileSync(resolve('${preview.replace(/\\/g, '\\\\')}', 'index.html'), out[0].html);
  `;
  const tmp = path.join(os.tmpdir(), `gm-shell-render-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, renderScript);
  cp.execFileSync('node', [tmp], { stdio: 'inherit', windowsHide: true });
  try { fs.unlinkSync(tmp); } catch (_) {}

  const server = cp.spawn('python', ['-m', 'http.server', '4210', '--directory', preview], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  server.unref();
  await sleep(1500);
  return { preview, port: 4210 };
}

async function main() {
  const { preview, port } = await renderPreview();
  const witness = path.join(os.tmpdir(), `gm-shell-witness-${Date.now()}.js`);
  const witnessOut = path.join(WITNESS_DIR, `gm-shell-${Date.now()}.json`);
  write(witness, `
await page.goto('http://127.0.0.1:${port}/');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(500);
const before = await page.evaluate(() => ({
  app: window.__debug.gm.app(),
  activeSurface: document.querySelector('[data-app-surface]:not([hidden])')?.dataset.appSurface || null,
  activeAppCopy: document.getElementById('active-app-copy')?.textContent || ''
}));
await page.evaluate(() => { const btn = document.querySelectorAll('[data-app]')[1]; if (btn) btn.click(); });
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  app: window.__debug.gm.app(),
  activeSurface: document.querySelector('[data-app-surface]:not([hidden])')?.dataset.appSurface || null,
  activeAppCopy: document.getElementById('active-app-copy')?.textContent || ''
}));
const result = { before, after };
return JSON.stringify(result);
`);

  const script = fs.readFileSync(witness, 'utf8');
  const relayPort = Number(process.env.PLAYWRITER_PORT) || 19988;
  const relayUrl = `http://127.0.0.1:${relayPort}/cli/execute`;
  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: '9', code: script, timeout: 60000, cwd: ROOT }),
  });
  const result = await response.json();
  const out = result.text || '';
  console.log(out.trim());
  if (!response.ok || result.isError) {
    throw new Error(out || `browser witness failed (${response.status})`);
  }
  fs.mkdirSync(WITNESS_DIR, { recursive: true });
  let parsed = null;
  const m = out.match(/\[return value\]\s*(\{[\s\S]*\})\s*$/);
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch (_) {}
    if (!parsed) {
      try { parsed = JSON.parse(m[1]); } catch (_) {}
    }
  }
  if (!parsed) {
    try {
      const raw = fs.readFileSync(witnessOut, 'utf8');
      parsed = JSON.parse(raw);
    } catch (_) {}
  }
  fs.writeFileSync(witnessOut, JSON.stringify({ preview, port, output: out.trim(), parsed }, null, 2));
  try { fs.unlinkSync(witness); } catch (_) {}
  rmrf(preview);
}

main().catch((e) => {
  console.error(e && e.stack || String(e));
  process.exit(1);
});
