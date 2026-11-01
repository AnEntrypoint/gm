// insight: a one-shot codebase overview from thorns (tree-sitter), a submodule under vendor/thorns and a dependency of this package.
// It reads the files it analyses and writes nothing.
import { analyze } from 'thorns';

const OUTPUT_PAGE = 20000;
const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const INSIGHT_TOOLS = [
  {
    name: 'insight',
    description: 'One-shot codebase overview from thorns (tree-sitter): files and lines by language, the dependency graph, orphan and circular files, duplicated code, complexity hotspots and the most used identifiers. path is optional, relative to the workspace; without it the whole workspace is analysed. The output is capped at 20000 characters.',
    inputSchema: obj({ path: str }),
  },
];

export function createInsightVerbs({ confine }) {
  return {
    insight({ path = '.' }) {
      if (typeof path !== 'string') return { ok: false, error: 'path must be a string' };
      const at = confine(path);
      if (at.refused) return { ok: false, error: `refused: ${path} resolves outside the workspace` };
      try {
        const text = analyze(at.path);
        return { ok: true, output: text.length > OUTPUT_PAGE ? `${text.slice(0, OUTPUT_PAGE)}\n(truncated at ${OUTPUT_PAGE} characters)` : text };
      } catch (err) {
        return { ok: false, error: `insight failed: ${err.message}` };
      }
    },
  };
}
