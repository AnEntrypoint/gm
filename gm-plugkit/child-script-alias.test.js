const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wrapper = fs.readFileSync(path.join(__dirname, 'plugkit-wasm-wrapper.js'), 'utf-8');

const aliasInChildScript = /\bspawnSync\s*\(\s*process\.execPath\s*,\s*\[\s*['"]-e['"]\s*,\s*`[^`]*\b_(?:net|http|https|crypto|childProcess)Module\b[^`]*`/;

(function noParentAliasInChildEvalTemplates() {
  assert.strictEqual(
    aliasInChildScript.test(wrapper),
    false,
    'no spawnSync(process.execPath, ["-e", `...`]) child-script template may reference a parent-scope _*Module alias; the spawned child has no such binding (use require() inside the template). This regression broke findFreePortSync/isPort*/fetchJsonSync and surfaced only as "could not allocate free port" at browser-spawn time.'
  );
})();

(function childTemplatesUseRequire() {
  const childEvalBlocks = wrapper.match(/spawnSync\s*\(\s*process\.execPath\s*,\s*\[\s*['"]-e['"]\s*,\s*`[^`]*`/g) || [];
  for (const block of childEvalBlocks) {
    if (/\brequire\s*\(\s*['"](?:net|http|https)['"]\s*\)/.test(block) || !/\b(?:net|http|https)\b/.test(block)) continue;
    assert.fail(`child -e template uses a node builtin without require(): ${block.slice(0, 80)}...`);
  }
})();

console.log('child-script-alias.test.js: all assertions passed');
