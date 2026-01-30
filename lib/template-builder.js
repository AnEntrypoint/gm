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

  static generatePackageJson(pluginSpec, adapterName, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-${adapterName}`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: pluginSpec.keywords,
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

  static buildHooksMap(hookEventNames, hookOutputFormat = 'wrapped') {
    const hooks = {};
    const format = hookOutputFormat;

    if (format === 'bare') {
      hooks[hookEventNames.preTool] = this.createCommand('pre-tool-use-hook.js', 3600);
      hooks[hookEventNames.sessionStart] = this.createCommand('session-start-hook.js', 10000);
      hooks[hookEventNames.promptSubmit] = this.createCommand('prompt-submit-hook.js', 3600);
      hooks[hookEventNames.stop] = [
        this.createCommand('stop-hook.js', 300000),
        this.createCommand('stop-hook-git.js', 60000)
      ];
    } else {
      hooks[hookEventNames.preTool] = [
        {
          matcher: '*',
          hooks: [this.createCommand('pre-tool-use-hook.js', 3600)]
        }
      ];
      hooks[hookEventNames.sessionStart] = [
        {
          matcher: '*',
          hooks: [this.createCommand('session-start-hook.js', 10000)]
        }
      ];
      hooks[hookEventNames.promptSubmit] = [
        {
          matcher: '*',
          hooks: [this.createCommand('prompt-submit-hook.js', 3600)]
        }
      ];
      hooks[hookEventNames.stop] = [
        {
          matcher: '*',
          hooks: [
            this.createCommand('stop-hook.js', 300000),
            this.createCommand('stop-hook-git.js', 60000)
          ]
        }
      ];
    }

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
      'CONTRIBUTING.md': this.generateContributing()
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
}

module.exports = TemplateBuilder;
