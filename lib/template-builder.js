const fs = require('fs');
const path = require('path');
const { generateGitHubPage, getPlatformPageConfig } = require('./page-generator');

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

  static loadLangFromSource(sourceDir, baseOutputPath = 'lang') {
    const langDir = path.join(sourceDir, 'lang');
    const langs = {};

    if (!fs.existsSync(langDir)) {
      return langs;
    }

    try {
      fs.readdirSync(langDir).forEach(fileName => {
        const filePath = path.join(langDir, fileName);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          langs[`${baseOutputPath}/${fileName}`] = content;
        }
      });
    } catch (e) {}

    return langs;
  }

  static loadLibFilesFromSource(sourceDir, baseOutputPath = 'lib') {
    const libDir = path.join(sourceDir, 'lib');
    const libFiles = {};

    if (!fs.existsSync(libDir)) {
      return libFiles;
    }

    try {
      fs.readdirSync(libDir).forEach(fileName => {
        const filePath = path.join(libDir, fileName);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          libFiles[`${baseOutputPath}/${fileName}`] = content;
        }
      });
    } catch (e) {}

    return libFiles;
  }

  static selectBundledSkills(platformName) {
    return platformName === 'skill';
  }

  static loadSharedSkills(sourceDir) {
    const skillsDir = path.join(sourceDir, 'skills');
    const shared = new Map();

    if (!fs.existsSync(skillsDir)) {
      return shared;
    }

    try {
      fs.readdirSync(skillsDir).forEach(skillName => {
        const skillPath = path.join(skillsDir, skillName);
        const stat = fs.statSync(skillPath);
        if (stat.isDirectory()) {
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            shared.set(skillName, content);
          }
        }
      });
    } catch (e) {}

    return shared;
  }

  static mergeSkillMetadata(skillContent, platformName) {
    return skillContent;
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
      mcpServers: pluginSpec.mcp || {}
    }, null, 2);
  }

  static getGenericFiles(platformName = null) {
    return {
      '.gitignore': this.generateGitignore(platformName),
      'LICENSE': this.generateLicense(),
      '.editorconfig': this.generateEditorConfig(),
      'CONTRIBUTING.md': this.generateContributing()
    };
  }

  static getCliGenericFiles(platformName = null) {
    return {
      ...this.getGenericFiles(platformName),
      '.github/workflows/pages.yml': this.generatePagesWorkflow()
    };
  }

  static generateGitignore(platformName = null) {
    const wasmPlatforms = ['vscode', 'cursor', 'zed', 'jetbrains', 'antigravity', 'windsurf', 'thebird'];
    const isWasmPlatform = wasmPlatforms.includes(platformName);

    const baseIgnore = `node_modules/
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
*.iml`;

    if (isWasmPlatform) {
      return `${baseIgnore}
`;
    }

    return `${baseIgnore}
bin/
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
npm run build gm-starter [output-dir]
\`\`\`

## Conventions

- The single platform adapter \`platforms/skill.js\` extends PlatformAdapter
- File generation logic goes in \`createFileStructure()\`
- Use TemplateBuilder methods for shared generation logic
- Skills are auto-discovered from gm-starter/skills/

## Testing

Build the gm-skill output:

\`\`\`bash
node cli.js gm-starter /tmp/test-build
\`\`\`
`;
  }

  static generatePublishNpmWorkflow() {
    return `name: Publish to npm

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Publish to npm
        run: |
          PACKAGE=\$(jq -r '.name' package.json)
          VERSION=\$(jq -r '.version' package.json)
          echo "Package: \$PACKAGE@\$VERSION"

          # Skip if this exact version is already on npm
          PUBLISHED=\$(npm view "\$PACKAGE@\$VERSION" version 2>/dev/null || echo "")
          if [ "\$PUBLISHED" = "\$VERSION" ]; then
            echo "✅ \$PACKAGE@\$VERSION already published - skipping"
            exit 0
          fi

          echo "Publishing \$PACKAGE@\$VERSION..."
          npm publish --access public 2>&1 | tee /tmp/npm-out.log; EXIT=\${PIPESTATUS[0]}
          if [ "\$EXIT" != "0" ]; then
            if grep -q "cannot publish over\\|previously published" /tmp/npm-out.log; then
              echo "⚠️  Version already published, skipping"
            else
              exit "\$EXIT"
            fi
          fi
          echo "✅ Published \$PACKAGE@\$VERSION"
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
  }

  static generatePagesWorkflow() {
    return `name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .

  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;
  }

  static getPlatformPageConfig(adapterName, pluginSpec) {
    return getPlatformPageConfig(adapterName, pluginSpec);
  }

  static generateGitHubPage(config) {
    return generateGitHubPage(config);
  }
}

module.exports = TemplateBuilder;
