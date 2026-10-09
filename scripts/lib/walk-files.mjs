import fs from 'node:fs';
import path from 'node:path';

// Missing or unreadable paths contribute nothing; that is the contract, not an error.
export function walkFiles(target, { skipName, includeFile }, out = []) {
  if (typeof target !== 'string') throw new TypeError(`walkFiles: target must be a path string, got ${typeof target}`);
  if (typeof skipName !== 'function' || typeof includeFile !== 'function') throw new TypeError('walkFiles: skipName and includeFile must be functions');
  if (!Array.isArray(out)) throw new TypeError('walkFiles: out must be an array');
  return collectFiles(target, skipName, includeFile, out);
}

function collectFiles(target, skipName, includeFile, out) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (includeFile(target)) out.push(target);
    return out;
  }
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skipName(entry.name)) continue;
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) collectFiles(entryPath, skipName, includeFile, out);
    else if (entry.isFile() && includeFile(entryPath)) out.push(entryPath);
  }
  return out;
}
