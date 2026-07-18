import fs from 'fs';
import path from 'path';

function safeName(s) { return String(s).replace(/[^A-Za-z0-9._-]/g, '_'); }

function projectKvDir(ns) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectRoot, '.gm', 'disciplines', safeName(ns));
}

function makeLegacyKvDir(kvDir) {
  return function legacyKvDir(ns) {
    return path.join(kvDir, safeName(ns));
  };
}

function makeKvFilePath() {
  return function kvFilePath(ns, key, ensureDir) {
    const dir = projectKvDir(ns);
    if (ensureDir) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, safeName(key) + '.json');
  };
}

function makeKvReadResolve(legacyKvDir) {
  const kvFilePath = makeKvFilePath();
  return function kvReadResolve(ns, key) {
    const fp = kvFilePath(ns, key);
    if (fs.existsSync(fp)) return fp;
    const legacy = path.join(legacyKvDir(ns), safeName(key) + '.json');
    if (fs.existsSync(legacy)) return legacy;
    return null;
  };
}

function makeKvNamespaceDirs(legacyKvDir) {
  return function kvNamespaceDirs(ns) {
    const out = [];
    const proj = projectKvDir(ns);
    if (fs.existsSync(proj)) out.push(proj);
    const legacy = legacyKvDir(ns);
    if (fs.existsSync(legacy)) out.push(legacy);
    return out;
  };
}

function enabledDisciplineNamespaces(baseNs) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const set = new Set([baseNs]);
  try {
    const enabledPath = path.join(projectRoot, '.gm', 'disciplines', 'enabled.txt');
    if (fs.existsSync(enabledPath)) {
      const lines = fs.readFileSync(enabledPath, 'utf-8').split(/\r?\n/);
      for (const ln of lines) {
        const name = ln.trim();
        if (name && !name.startsWith('#')) set.add(name);
      }
    }
  } catch (_) {}
  return Array.from(set);
}

function jaccardOverlap(a, b) {
  if (!a || !b) return 0;
  const tokenize = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3));
  const A = tokenize(a), B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function makeKvHelpers(kvDir) {
  const legacyKvDir = makeLegacyKvDir(kvDir);
  const kvFilePath = makeKvFilePath();
  const kvReadResolve = makeKvReadResolve(legacyKvDir);
  const kvNamespaceDirs = makeKvNamespaceDirs(legacyKvDir);
  return { safeName, projectKvDir, legacyKvDir, kvFilePath, kvReadResolve, kvNamespaceDirs, enabledDisciplineNamespaces, jaccardOverlap };
}

export { safeName, projectKvDir, enabledDisciplineNamespaces, jaccardOverlap, makeKvHelpers };
