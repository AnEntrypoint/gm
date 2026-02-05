const fs = require('fs');
const path = require('path');

class TemplateBuilder {
  static loadSkillsFromSource(sourceDir, baseOutputPath = 'skills') {
    const skillsDir = path.join(sourceDir, 'skills');
    const skills = {};

    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    try {
      fs.readdirSync(skillsDir).forEach(skillName => {
        const skillPath = path.join(skillsDir, skillName);
        const stat = fs.statSync(skillPath);
        if (stat.isDirectory()) {
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            skills[`${baseOutputPath}/${skillName}/SKILL.md`] = content;
          }
        }
      });
    } catch (e) {}

    return skills;
  }

  static loadScriptsFromSource(sourceDir, baseOutputPath = 'scripts') {
    const scriptsDir = path.join(sourceDir, 'scripts');
    const scripts = {};

    if (!fs.existsSync(scriptsDir)) {
      return scripts;
    }

    try {
      fs.readdirSync(scriptsDir).forEach(fileName => {
        const filePath = path.join(scriptsDir, fileName);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          scripts[`${baseOutputPath}/${fileName}`] = content;
        }
      });
    } catch (e) {}

    return scripts;
  }

  static generatePackageJson(pluginSpec, adapterName, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-${adapterName}`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: pluginSpec.keywords,
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }),
      repository: {
        type: 'git',
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}.git`
      },
      homepage: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}#readme`,
      bugs: {
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}/issues`
      },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      ...extraFields
    }, null, 2);
  }

  static generateMcpJson(pluginSpec) {
    return JSON.stringify({
      $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
      mcpServers: pluginSpec.mcp
    }, null, 2);
  }

  static generatePluginJson(pluginSpec) {
    return JSON.stringify({
      name: pluginSpec.name,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: {
        name: pluginSpec.author,
        url: 'https://github.com/AnEntrypoint'
      },
      homepage: pluginSpec.homepage,
      hooks: './hooks/hooks.json',
      mcpServers: pluginSpec.mcp
    }, null, 2);
  }

  static generateMarketplaceJson(pluginSpec) {
    return JSON.stringify({
      name: 'gm',
      owner: {
        name: pluginSpec.author
      },
      description: pluginSpec.description,
      version: pluginSpec.version,
      metadata: {
        description: pluginSpec.description
      },
      plugins: [
        {
          name: 'gm',
          source: './'
        }
      ]
    }, null, 2);
  }

  static buildHooksMap(hookEventNames, hookOutputFormat = 'wrapped') {
    const hooks = {};
    const hookDefs = [
      { event: 'preTool', file: 'pre-tool-use-hook.js', timeout: 3600 },
      { event: 'sessionStart', file: 'session-start-hook.js', timeout: 10000 },
      { event: 'promptSubmit', file: 'prompt-submit-hook.js', timeout: 3600 },
      { event: 'stop', files: [
        { file: 'stop-hook.js', timeout: 300000 },
        { file: 'stop-hook-git.js', timeout: 60000 }
      ]}
    ];

    hookDefs.forEach(def => {
      const eventKey = hookEventNames[def.event];
      if (def.files) {
        const cmds = def.files.map(f => this.createCommand(f.file, f.timeout));
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmds : [{ matcher: '*', hooks: cmds }];
      } else {
        const cmd = [this.createCommand(def.file, def.timeout)];
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmd[0] : [{ matcher: '*', hooks: cmd }];
      }
    });

    return hooks;
  }

  static createCommand(hookFile, timeout) {
    return {
      type: 'command',
      command: `node \${__dirname}/${hookFile}`,
      timeout
    };
  }

  static buildHookCommandWithEnv(hookFile, envVar) {
    return `node \${${envVar}}/${hookFile}`;
  }

  static getGenericFiles() {
    return {
      '.gitignore': this.generateGitignore(),
      'LICENSE': this.generateLicense(),
      '.editorconfig': this.generateEditorConfig(),
      'CONTRIBUTING.md': this.generateContributing(),
      '.github/workflows/publish-npm.yml': this.generatePublishNpmWorkflow()
    };
  }

  static generateGitignore() {
    return `node_modules/
*.log
*.swp
*.swo
.DS_Store
dist/
build/
*.tmp
.env
.env.local
.vscode/
.idea/
*.iml
`;
  }

  static generateLicense() {
    return `MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  }

  static generateEditorConfig() {
    return `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`;
  }

  static generateContributing() {
    return `# Contributing

Please ensure all code follows the conventions established in this project.

## Before Committing

Run the build to verify everything is working:

\`\`\`bash
npm run build plugforge-starter [output-dir]
\`\`\`

## Platform Conventions

- Each platform adapter in \`platforms/\` extends PlatformAdapter or CLIAdapter
- File generation logic goes in \`createFileStructure()\`
- Use TemplateBuilder methods for shared generation logic
- Skills are auto-discovered from plugforge-starter/skills/

## Testing

Build all 9 platform outputs:

\`\`\`bash
node cli.js plugforge-starter /tmp/test-build
\`\`\`
`;
  }

  static generatePublishNpmWorkflow() {
    return `name: Publish to npm

on:
  push:
    branches:
      - main

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: \${{ secrets.GITHUB_TOKEN }}

      - uses: oven-sh/setup-bun@v1

      - name: Bump version
        run: |
          VERSION=\$(jq -r '.version' package.json)
          IFS='.' read -r MAJOR MINOR PATCH <<< "\$VERSION"
          NEW_VERSION="\$MAJOR.\$MINOR.\$((PATCH + 1))"
          jq --arg v "\$NEW_VERSION" '.version = \$v' package.json > package.json.tmp && mv package.json.tmp package.json
          echo "NEW_VERSION=\$NEW_VERSION" >> \$GITHUB_ENV
          echo "VERSION_BUMPED=true" >> \$GITHUB_ENV

      - name: Configure git
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"

      - name: Commit version bump
        run: |
          git add package.json
          git commit -m "chore: bump version to \${{ env.NEW_VERSION }}"
          git push

      - name: Setup npm credentials
        run: |
          npm config set //registry.npmjs.org/:_authToken=\${{ secrets.NPM_TOKEN }}

      - name: Publish to npm
        run: npm publish
`;
  }
}

module.exports = TemplateBuilder;
