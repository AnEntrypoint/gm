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

The single canonical body of the gm skill-driven orchestration harness. All 15 platform-specific \`gm-<platform>\` packages re-export this surface; this is the source of truth.

## What this is

AI-native software engineering orchestrated as a continuous chain — PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS — bootstrapped on top of \`plugkit\` for task execution and session isolation. Spool-driven, daemonize-by-default, end-to-end chained.

## Install

\`\`\`bash
npm install gm-skill
\`\`\`

Then point your AI coding agent host (Claude Code, OpenCode, Cursor, Zed, VS Code, Codex, Kilo, JetBrains, Copilot CLI, Hermes, etc.) at the included \`skills/\` directory, or invoke the bootstrap directly:

\`\`\`bash
npx gm-skill-bootstrap
\`\`\`

## What's inside

- \`skills/\` — every shared skill (gm, gm-execute, gm-emit, gm-complete, planning, update-docs, browser, code-search, create-lang-plugin, governance, pages, research, ssh, textprocessing, gm-skill itself)
- \`bin/bootstrap.js\` — plugkit downloader + daemon launcher
- \`gm-plugkit/\` — spool watcher and WASM wrapper
- \`lib/\` — daemon-bootstrap, skill-bootstrap, spool-dispatch, git, codeinsight modules
- \`agents/\`, \`prompts/\`, \`scripts/\`, \`lang/\` — supporting surface

## Version

\`${pluginSpec.version}\` — auto-bumped from the canonical \`gm\` repo. Every push to \`AnEntrypoint/gm\` republishes this package alongside all 15 platform packages.

## Source of truth

This package is generated from [AnEntrypoint/gm](https://github.com/AnEntrypoint/gm) — do not edit files in this repo directly; they will be overwritten on next publish.
`;
  }
}

module.exports = SkillAdapter;
