import { checkFiles } from './checker.mjs';

const DICT_PATH = new URL('./dictionary.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function runSte100Verify(filePaths, opts = {}) {
  const violations = checkFiles(filePaths, DICT_PATH, opts);
  return {
    ok: violations.length === 0,
    violation_count: violations.length,
    violations,
  };
}
