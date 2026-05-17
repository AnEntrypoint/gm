const path = require('path');
const fs = require('fs');
const PlatformAdapter = require('./base');
const TemplateBuilder = require('../lib/template-builder');

const PLATFORM_WRAPPER_SKILLS = new Set([
  'gm-cc', 'gm-gc', 'gm-oc', 'gm-codex', 'gm-kilo',
  'gm-vscode', 'gm-cursor', 'gm-zed', 'gm-jetbrains', 'gm-copilot-cli'
]);

class SkillAdapter extends PlatformAdapter {
  constructor(options = {}) {
    super({
      name: 'skill',
      label: 'gm-skill (canonical universal harness)',
      configFile: 'gm.json',
      contextFile: 'AGENTS.md'
    });
    this.skillsCache = options.skillsCache || null;
  }

  createFileStructure(pluginSpec, sourceDir) {
    const structure = {
      'gm.json': this.readSourceFile(sourceDir, ['gm.json']),
      'AGENTS.md': this.readSourceFile(sourceDir, ['AGENTS.md', 'CLAUDE.md']) || '# gm-skill\n',
      'README.md': this.generateReadme(pluginSpec),
      'package.json': this.generateSkillPackageJson(pluginSpec)
    };

    Object.assign(structure, this.loadCanonicalSkills(sourceDir));
    Object.assign(structure, this.loadAgentsFromSource(sourceDir));
    Object.assign(structure, TemplateBuilder.loadScriptsFromSource(sourceDir, 'scripts'));
    Object.assign(structure, TemplateBuilder.loadLangFromSource(sourceDir, 'lang'));
    Object.assign(structure, TemplateBuilder.loadLibFilesFromSource(sourceDir, 'lib'));
    Object.assign(structure, this.loadGmPlugkit(sourceDir));
    Object.assign(structure, this.loadPrompts(sourceDir));

    return structure;
  }

  loadCanonicalSkills(sourceDir) {
    const skillsDir = path.join(sourceDir, 'skills');
    const out = {};
    if (!fs.existsSync(skillsDir)) return out;

    const entries = this.skillsCache
      ? Array.from(this.skillsCache.entries()).map(([name, content]) => ({ name, content }))
      : fs.readdirSync(skillsDir).filter(n => {
          const skillMd = path.join(skillsDir, n, 'SKILL.md');
          return fs.existsSync(skillMd);
        }).map(name => ({
          name,
          content: fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf-8')
        }));

    for (const { name, content } of entries) {
      if (PLATFORM_WRAPPER_SKILLS.has(name)) continue;
      out[`skills/${name}/SKILL.md`] = content;

      const skillDir = path.join(skillsDir, name);
      if (fs.existsSync(skillDir)) {
        try {
          for (const file of fs.readdirSync(skillDir)) {
            if (file === 'SKILL.md') continue;
            const fp = path.join(skillDir, file);
            if (fs.statSync(fp).isFile()) {
              out[`skills/${name}/${file}`] = fs.readFileSync(fp, 'utf-8');
            }
          }
        } catch (e) {}
      }
    }
    return out;
  }

  loadAgentsFromSource(sourceDir) {
    const agentsDir = path.join(sourceDir, 'agents');
    if (!fs.existsSync(agentsDir)) return {};
    return fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .reduce((acc, f) => {
        acc[`agents/${f}`] = fs.readFileSync(path.join(agentsDir, f), 'utf-8');
        return acc;
      }, {});
  }

  loadPrompts(sourceDir) {
    const promptsDir = path.join(sourceDir, 'prompts');
    if (!fs.existsSync(promptsDir)) return {};
    return fs.readdirSync(promptsDir)
      .filter(f => f.endsWith('.txt'))
      .reduce((acc, f) => {
        acc[`prompts/${f}`] = fs.readFileSync(path.join(promptsDir, f), 'utf-8');
        return acc;
      }, {});
  }

  loadGmPlugkit(sourceDir) {
    const pkDir = path.join(sourceDir, 'gm-plugkit');
    if (!fs.existsSync(pkDir)) return {};
    const out = {};
    for (const f of fs.readdirSync(pkDir)) {
      const fp = path.join(pkDir, f);
      if (fs.statSync(fp).isFile()) {
        out[`gm-plugkit/${f}`] = fs.readFileSync(fp, 'utf-8');
      }
    }
    return out;
  }

  generateSkillPackageJson(pluginSpec) {
    return JSON.stringify({
      name: 'gm-skill',
      version: pluginSpec.version,
      description: 'Canonical universal harness — AI-native software engineering via skill-driven orchestration; bootstraps plugkit for task execution and session isolation. Install in any AI coding agent host.',
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: ['gm', 'skill', 'harness', 'plugkit', 'orchestration', 'ai-coding', 'canonical'],
      homepage: 'https://github.com/AnEntrypoint/gm-skill#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-skill/issues' },
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-skill.git' },
      main: 'bin/bootstrap.js',
      bin: { 'gm-skill-bootstrap': './bin/bootstrap.js' },
      files: [
        'skills/',
        'agents/',
        'prompts/',
        'lib/',
        'lang/',
        'scripts/',
        'bin/',
        'gm-plugkit/',
        'AGENTS.md',
        'README.md',
        'gm.json'
      ],
      dependencies: {
        'gm-plugkit': `^${pluginSpec.version}`
      },
      engines: pluginSpec.engines || { node: '>=16.0.0' },
      publishConfig: { access: 'public' }
    }, null, 2);
  }

  generateReadme(pluginSpec) {
    return `# gm-skill — Canonical Universal Harness

The single shipped skill for gm. Install into any harness that loads Claude-style skill directories — Claude Code, OpenCode, Cursor, Zed, VS Code, Codex, Kilo, JetBrains, Copilot CLI, Antigravity, Windsurf, Gemini CLI — and plugkit serves every phase instruction, mutables row, and guardrail on demand via the spool.

## What this is

AI-native software engineering orchestrated as a state machine — PLAN → EXECUTE → EMIT → VERIFY → COMPLETE — backed by the \`plugkit\` WASM orchestrator. Spool-driven dispatch, no daemon, no native binaries.

## Install

\`\`\`bash
bun x skills add AnEntrypoint/gm-skill -y -g
\`\`\`

Then add this line to your agent's global memory / system prompt:

\`\`\`
always use the gm-skill skill for everything, always fan out subagents
\`\`\`

You need bun installed: \`curl -fsSL https://bun.sh/install | bash\`

## What's inside

- \`skills/gm-skill/\` — the canonical universal harness (\`SKILL.md\` is the ~12-line entry point)
- \`gm-plugkit/\` — WASM bootstrap and spool watcher wrapper
- \`lib/\` — skill-bootstrap, spool-dispatch, daemon-bootstrap, git, codeinsight modules
- \`bin/plugkit.wasm.sha256\` — pinned hash of the plugkit WASM artifact

## Architecture

All orchestration lives in \`rs-plugkit/src/orchestrator/\` as native Rust, compiled to a single \`plugkit.wasm\` (~<200KB). The agent dispatches verbs by writing to \`.gm/exec-spool/in/<verb>/<N>.txt\` and reading responses from \`.gm/exec-spool/out/\`. See [AGENTS.md](https://github.com/AnEntrypoint/gm/blob/main/AGENTS.md) for the full design.

An earlier generation fanned out fifteen per-platform downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-antigravity, gm-windsurf). Those are archived; \`gm-skill\` is the single source of truth.

## Version

\`${pluginSpec.version}\` — auto-bumped from the canonical \`gm\` repo. Every push to \`AnEntrypoint/gm\` (or any cascading sibling crate) republishes this package.

## Source of truth

This package is generated from [AnEntrypoint/gm](https://github.com/AnEntrypoint/gm) — do not edit files in this repo directly; they will be overwritten on next publish.
`;
  }
}

module.exports = SkillAdapter;
