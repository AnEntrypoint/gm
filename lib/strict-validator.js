const fs = require('fs');
const path = require('path');

class StrictValidator {
  /**
   * Comprehensive validation that makes bad configuration impossible
   * Returns detailed report instead of simple true/false
   */
  static validate(loaded) {
    const report = {
      valid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {}
    };

    // 1. Validate gm.json structure
    this.validateSpec(loaded.spec, report);

    // 2. Validate agents
    this.validateAgents(loaded, report);

    // 3. Validate hooks
    this.validateHooks(loaded, report);

    // 4. Validate skills
    this.validateSkills(loaded, report);

    // 5. Validate MCP configuration
    this.validateMcp(loaded.spec.mcp || {}, report);

    // 6. Validate file paths and integrity
    this.validateFileIntegrity(loaded, report);

    // Summary
    report.valid = report.errors.length === 0;
    report.summary = {
      agents: Object.keys(loaded.agents).length,
      hooks: Object.keys(loaded.hooks).length,
      skills: Object.keys(loaded.skills).length,
      errorCount: report.errors.length,
      warningCount: report.warnings.length
    };

    return report;
  }

  static validateSpec(spec, report) {
    // Required fields
    const required = ['name', 'version', 'author', 'license'];
    required.forEach(field => {
      if (!spec[field]) {
        report.errors.push(`CRITICAL: gm.json missing required field: "${field}"`);
      }
    });

    // Name validation
    if (spec.name && !/^[a-z0-9-]+$/.test(spec.name)) {
      report.errors.push(`CRITICAL: name must be lowercase alphanumeric with hyphens: "${spec.name}"`);
    }

    // Version validation (semver)
    if (spec.version && !/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(spec.version)) {
      report.errors.push(`CRITICAL: version must be semantic version (e.g., 1.0.0): "${spec.version}"`);
    }

    // License validation
    const validLicenses = ['MIT', 'Apache-2.0', 'GPL-3.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause'];
    if (spec.license && !validLicenses.includes(spec.license)) {
      report.errors.push(`CRITICAL: license must be one of: ${validLicenses.join(', ')}`);
    }

    // Description length
    if (spec.description && spec.description.length < 10) {
      report.warnings.push(`Description is very short (${spec.description.length} chars), consider adding more detail`);
    }

    // Homepage format
    if (spec.homepage && !spec.homepage.startsWith('http')) {
      report.errors.push(`CRITICAL: homepage must be a valid URL: "${spec.homepage}"`);
    }

    // Engines validation
    if (spec.engines?.node) {
      const supportedVersions = ['>=14.0.0', '>=16.0.0', '>=18.0.0', '>=20.0.0'];
      if (!supportedVersions.includes(spec.engines.node)) {
        report.warnings.push(`Node version requirement "${spec.engines.node}" is unusual, consider using >=18.0.0`);
      }
    }

    report.info.push(`✓ gm.json spec validated: ${spec.name}@${spec.version}`);
  }

  static validateAgents(loaded, report) {
    const agents = loaded.agents;
    const agentNames = Object.keys(agents);

    if (agentNames.length === 0) {
      report.errors.push('CRITICAL: No agents found in agents/ directory. Must have at least agents/gm.md');
      return;
    }

    // Check for required gm agent
    if (!agents.gm) {
      report.errors.push('CRITICAL: agents/gm.md is required but not found');
    } else {
      // Validate gm.md structure
      if (!agents.gm.content || agents.gm.content.trim().length === 0) {
        report.errors.push('CRITICAL: agents/gm.md is empty');
      }
    }

    // Validate other agents
    agentNames.forEach(agentName => {
      const agent = agents[agentName];
      if (!agent.content || agent.content.trim().length === 0) {
        report.errors.push(`CRITICAL: agents/${agent.file} is empty`);
      }
      if (agent.content.length < 50) {
        report.warnings.push(`agents/${agent.file} is very short (${agent.content.length} chars)`);
      }
    });

    report.info.push(`✓ Agents validated: ${agentNames.join(', ')}`);
  }

  static validateHooks(loaded, report) {
    const hooks = loaded.hooks;
    const hookNames = Object.keys(hooks);

    if (hookNames.length === 0) {
      report.errors.push('CRITICAL: No hooks found in hooks/ directory. Must have at least one hook file');
      return;
    }

    // Required hook naming pattern
    const requiredPatterns = [
      'pre-tool-use-hook',
      'session-start-hook',
      'prompt-submit-hook',
      'stop-hook'
    ];

    const foundRequired = requiredPatterns.filter(pattern =>
      hookNames.some(name => name === pattern || name === pattern + '.js')
    );

    if (foundRequired.length === 0) {
      report.warnings.push(`No standard hooks detected. Expected one of: ${requiredPatterns.join(', ')}`);
    }

    // Validate hook file content
    hookNames.forEach(hookName => {
      const hook = hooks[hookName];

      if (!hook.content || hook.content.trim().length === 0) {
        report.errors.push(`CRITICAL: hooks/${hook.file} is empty`);
      }

      // Hooks can be either executable scripts (with #!/usr/bin/env) or modules (with module.exports)
      const isExecutableScript = hook.content.includes('#!/usr/bin/env') || hook.content.includes('#!/bin/');
      const isModule = hook.content.includes('module.exports') || hook.content.includes('export ');

      if (!isExecutableScript && !isModule) {
        report.warnings.push(`hooks/${hook.file} should either be an executable script (#!/usr/bin/env) or export a module`);
      }

      // Check for old-style paths (before __dirname fix)
      if (hook.content.includes('hooks/') || hook.content.includes('./hooks')) {
        report.warnings.push(`hooks/${hook.file} contains relative hook directory paths - use ${__dirname} instead`);
      }
    });

    // Check for naming inconsistencies
    const inconsistentNames = hookNames.filter(name =>
      name !== 'pre-tool-use-hook' &&
      name !== 'session-start-hook' &&
      name !== 'prompt-submit-hook' &&
      name !== 'stop-hook' &&
      name !== 'stop-hook-git' &&
      !name.includes('-hook')
    );

    if (inconsistentNames.length > 0) {
      report.warnings.push(`Non-standard hook names: ${inconsistentNames.join(', ')}. Use pattern: {name}-hook.js`);
    }

    report.info.push(`✓ Hooks validated: ${hookNames.join(', ')}`);
  }

  static validateSkills(loaded, report) {
    const skills = loaded.skills;
    const skillNames = Object.keys(skills);

    if (skillNames.length === 0) {
      report.info.push('ℹ No skills found (optional)');
      return;
    }

    skillNames.forEach(skillName => {
      const skill = skills[skillName];

      if (!skill.content || skill.content.trim().length === 0) {
        report.errors.push(`CRITICAL: skills/${skillName}/SKILL.md is empty`);
      }

      if (skill.content.length < 100) {
        report.warnings.push(`skills/${skillName}/SKILL.md is very short (${skill.content.length} chars)`);
      }

      // Validate YAML frontmatter
      if (!skill.content.startsWith('---')) {
        report.warnings.push(`skills/${skillName}/SKILL.md should start with YAML frontmatter (---)`);
      }

      // Check for name in frontmatter
      if (!skill.content.includes(`name: ${skillName}`) && !skill.content.includes(`name: "${skillName}"`)) {
        report.warnings.push(`skills/${skillName}/SKILL.md frontmatter should include name: ${skillName}`);
      }
    });

    report.info.push(`✓ Skills validated: ${skillNames.join(', ')}`);
  }

  static validateMcp(mcp, report) {
    if (!mcp || Object.keys(mcp).length === 0) {
      report.info.push('ℹ No MCP servers configured (optional)');
      return;
    }

    const serverNames = Object.keys(mcp);

    serverNames.forEach(serverName => {
      const config = mcp[serverName];

      if (!config.command) {
        report.errors.push(`CRITICAL: MCP server "${serverName}" missing required field: command`);
      }

      if (typeof config.args !== 'undefined' && !Array.isArray(config.args)) {
        report.errors.push(`CRITICAL: MCP server "${serverName}" args must be an array`);
      }

      if (typeof config.timeout !== 'undefined') {
        if (typeof config.timeout !== 'number' || config.timeout < 1000) {
          report.errors.push(`CRITICAL: MCP server "${serverName}" timeout must be >= 1000ms`);
        }
        if (config.timeout > 3600000) {
          report.warnings.push(`MCP server "${serverName}" timeout is very long (${config.timeout}ms)`);
        }
      }

      // Warn about common mistakes
      if (serverName.includes('_')) {
        report.warnings.push(`MCP server name "${serverName}" contains underscore, consider using hyphens`);
      }
    });

    report.info.push(`✓ MCP servers validated: ${serverNames.join(', ')}`);
  }

  static validateFileIntegrity(loaded, report) {
    // Check that all loaded files actually exist
    const allFiles = [
      ...Object.values(loaded.agents).map(a => a.path),
      ...Object.values(loaded.hooks).map(h => h.path),
      ...Object.values(loaded.skills).map(s => s.path)
    ];

    const missing = allFiles.filter(filePath => !fs.existsSync(filePath));

    if (missing.length > 0) {
      report.errors.push(`CRITICAL: ${missing.length} loaded files no longer exist: ${missing.slice(0, 3).join(', ')}`);
    }

    // Check for empty directories that should have content
    if (fs.existsSync(loaded.agentsDir)) {
      const agentFiles = fs.readdirSync(loaded.agentsDir).filter(f => f.endsWith('.md'));
      if (agentFiles.length === 0) {
        report.errors.push('CRITICAL: agents/ directory exists but is empty');
      }
    }

    if (fs.existsSync(loaded.hooksDir)) {
      const hookFiles = fs.readdirSync(loaded.hooksDir).filter(f => f.endsWith('.js'));
      if (hookFiles.length === 0) {
        report.errors.push('CRITICAL: hooks/ directory exists but is empty');
      }
    }

    report.info.push(`✓ File integrity check passed (${allFiles.length} files exist)`);
  }

  /**
   * Generate human-readable validation report
   */
  static generateReport(report) {
    let output = '\n' + '='.repeat(60) + '\n';
    output += 'PLUGFORGE VALIDATION REPORT\n';
    output += '='.repeat(60) + '\n\n';

    // Summary
    output += `Summary: ${report.summary.agents} agents, ${report.summary.hooks} hooks, ${report.summary.skills} skills\n`;
    output += `Errors: ${report.summary.errorCount}, Warnings: ${report.summary.warningCount}\n\n`;

    // Errors
    if (report.errors.length > 0) {
      output += '🔴 ERRORS:\n';
      report.errors.forEach(err => output += `   ${err}\n`);
      output += '\n';
    }

    // Warnings
    if (report.warnings.length > 0) {
      output += '⚠️  WARNINGS:\n';
      report.warnings.forEach(warn => output += `   ${warn}\n`);
      output += '\n';
    }

    // Info
    if (report.info.length > 0) {
      output += '✅ INFO:\n';
      report.info.forEach(info => output += `   ${info}\n`);
      output += '\n';
    }

    // Status
    output += '='.repeat(60) + '\n';
    if (report.valid) {
      output += '✅ CONFIGURATION VALID - Ready to build!\n';
    } else {
      output += '❌ CONFIGURATION INVALID - Fix errors before building\n';
    }
    output += '='.repeat(60) + '\n';

    return output;
  }
}

module.exports = StrictValidator;
