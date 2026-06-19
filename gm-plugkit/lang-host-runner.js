#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

async function main() {
  const [, , projectDir, command, codeB64] = process.argv;
  if (!projectDir || !command || codeB64 === undefined) {
    console.log(JSON.stringify({ ok: false, error: 'usage: lang-host-runner <projectDir> <command> <code-base64>' }));
    process.exit(2);
  }
  const code = Buffer.from(codeB64, 'base64').toString('utf8');
  const langDir = path.join(projectDir, 'lang');
  if (!fs.existsSync(langDir)) {
    console.log(JSON.stringify({ ok: false, error: 'no-lang-dir', langDir }));
    return;
  }
  const files = fs.readdirSync(langDir).filter(f => f.endsWith('.js') && f !== 'loader.js');
  const plugins = files.reduce((acc, f) => {
    try {
      const p = require(path.join(langDir, f));
      if (p && typeof p.id === 'string' && p.exec && p.exec.match instanceof RegExp && typeof p.exec.run === 'function') {
        acc.push(p);
      }
    } catch (_) {}
    return acc;
  }, []);
  const plugin = plugins.find(p => p.exec.match.test(command));
  if (!plugin) {
    console.log(JSON.stringify({ ok: false, error: 'no-plugin-matched', command, available: plugins.map(p => p.id) }));
    return;
  }
  const t0 = Date.now();
  const timer = setTimeout(() => {
    console.log(JSON.stringify({ ok: false, error: 'timeout', plugin_id: plugin.id, ms: Date.now() - t0 }));
    process.exit(0);
  }, 30000);
  try {
    const out = await plugin.exec.run(code, projectDir);
    clearTimeout(timer);
    console.log(JSON.stringify({ ok: true, plugin_id: plugin.id, output: String(out), ms: Date.now() - t0 }));
  } catch (e) {
    clearTimeout(timer);
    console.log(JSON.stringify({ ok: false, error: String(e && e.message || e), plugin_id: plugin.id, ms: Date.now() - t0 }));
  }
}

main();
