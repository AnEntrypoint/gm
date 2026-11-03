const path = require('path');
const fs = require('fs');
const build = require('./units.cjs');

const REPOS = [
  { tag: 'gm-new', root: '/workspace/gm-new', opts: {}, take: Infinity },
  { tag: 'gm-mcp', root: '/workspace/gm/gm-mcp', opts: { dir: 'src', ext: '.js', acorn: '/workspace/gm-new/node_modules/acorn' }, take: 60 },
];
const SHOWN = 50;

function selectUnits() {
  const out = [];
  for (const repo of REPOS) {
    const { units } = build(repo.root, repo.opts);
    const sorted = units.slice().sort((a, b) => (a.file + ':' + String(a.start).padStart(5, '0')).localeCompare(b.file + ':' + String(b.start).padStart(5, '0')));
    const take = Math.min(repo.take, sorted.length);
    for (let i = 0; i < take; i += 1) out.push({ tag: repo.tag, root: repo.root, u: sorted[Math.floor(i * sorted.length / take)] });
  }
  return out;
}

function snippetsOf() {
  return selectUnits().map(({ tag, root, u }) => {
    const lines = fs.readFileSync(path.join(root, u.file), 'utf8').split('\n');
    const body = lines.slice(u.start - 1, Math.min(u.end, u.start - 1 + SHOWN));
    const code = body.join('\n').replace(new RegExp('\\b' + u.name + '\\b', 'g'), 'FN');
    return { tag, file: u.file, name: u.name, start: u.start, end: u.end, code };
  });
}

module.exports = { REPOS, selectUnits, snippetsOf };

if (require.main === module) {
  const all = snippetsOf();
  const keyed = all.map((s, i) => ({ key: 'u' + String(i + 1).padStart(3, '0'), ...s }));
  const dir = '/tmp/gm-scratch/blind';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(keyed.map(({ key, tag, file, name, start, end }) => ({ key, tag, file, name, start, end })), null, 1));
  const parts = [[], [], []];
  keyed.forEach((s, i) => parts[i % 3].push({ key: s.key, code: s.code }));
  parts.forEach((p, i) => fs.writeFileSync(path.join(dir, 'part-' + (i + 1) + '.json'), JSON.stringify(p, null, 1)));
  console.log(JSON.stringify({ total: keyed.length, perRepo: REPOS.map((r) => r.tag + ':' + keyed.filter((s) => s.tag === r.tag).length), parts: parts.map((p) => p.length), chars: parts.map((p) => JSON.stringify(p).length) }));
}
