const fs = require('fs');
const path = require('path');

/**
 * Auto-healing for common configuration mistakes
 * Fixes what it can, reports what needs manual intervention
 */
class AutoHealer {
  /**
   * Attempt to heal configuration issues
   * Returns { healed: [], fixable: [], unfixable: [] }
   */
  static attemptHeal(loaded) {
    const results = {
      healed: [],
      fixable: [],
      unfixable: [],
      warnings: []
    };

    // 1. Fix empty hook files
    this.healEmptyFiles(loaded.hooksDir, 'hooks', results);

    // 2. Fix empty agent files
    this.healEmptyFiles(loaded.agentsDir, 'agents', results);

    // 3. Fix missing required agents
    this.healMissingGmAgent(loaded, results);

    // 4. Fix glootie.json issues
    this.healGlootieJsonIssues(loaded, results);

    // 5. Fix hook naming inconsistencies
    this.healHookNaming(loaded, results);

    return results;
  }

  static healEmptyFiles(dir, type, results) {
    if (!fs.existsSync(dir)) return;

    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && stat.size === 0) {
        if (type === 'hooks') {
          // Create minimal hook template
          const hookName = path.basename(file, '.js');
          const template = `#!/usr/bin/env node
// ${hookName} hook - Generated auto-healer
// Please implement hook logic

console.log(JSON.stringify({
  decision: 'allow',
  reason: 'Hook not yet implemented'
}, null, 2));
`;
          fs.writeFileSync(filePath, template);
          results.healed.push(`${type}/${file}: Created minimal template`);
        } else if (type === 'agents') {
          // Create minimal agent template
          const agentName = path.basename(file, '.md');
          const template = `---
name: ${agentName}
description: Auto-generated agent
---

# ${agentName}

This agent was auto-created by plugforge auto-healer.
Please add meaningful content to this file.
`;
          fs.writeFileSync(filePath, template);
          results.healed.push(`${type}/${file}: Created minimal template`);
        }
      }
    });
  }

  static healMissingGmAgent(loaded, results) {
    if (loaded.agents.gm) return; // Already exists

    const gmPath = path.join(loaded.agentsDir, 'gm.md');
    const template = `---
name: gm
description: General agent
---

# gm Agent

This is the main agent for your plugin.
Define your agent's behavior and capabilities here.
`;

    fs.writeFileSync(gmPath, template);
    results.healed.push(`agents/gm.md: Created required agent`);
  }

  static healGlootieJsonIssues(loaded, results) {
    const spec = loaded.spec;
    let modified = false;

    // Fix name casing
    if (spec.name && spec.name !== spec.name.toLowerCase()) {
      spec.name = spec.name.toLowerCase();
      modified = true;
      results.healed.push(`glootie.json: Converted name to lowercase`);
    }

    // Add default values if missing but recommended
    if (!spec.description && spec.name) {
      spec.description = `The ${spec.name} plugin`;
      modified = true;
      results.warnings.push(`glootie.json: Added placeholder description`);
    }

    if (!spec.keywords) {
      spec.keywords = ['plugin', 'assistant'];
      modified = true;
      results.warnings.push(`glootie.json: Added default keywords`);
    }

    if (modified) {
      const glootieJsonPath = path.join(loaded.baseDir, 'glootie.json');
      fs.writeFileSync(glootieJsonPath, JSON.stringify(spec, null, 2));
      results.healed.push(`glootie.json: Updated with auto-healer changes`);
    }
  }

  static healHookNaming(loaded, results) {
    const hooksDir = loaded.hooksDir;
    if (!fs.existsSync(hooksDir)) return;

    const expectedNames = [
      'pre-tool-use-hook.js',
      'session-start-hook.js',
      'prompt-submit-hook.js',
      'stop-hook.js',
      'stop-hook-git.js'
    ];

    fs.readdirSync(hooksDir).forEach(file => {
      if (file === 'hooks.json') return;

      // Check for variant names like "pre-tool.js" instead of "pre-tool-use-hook.js"
      const variantMap = {
        'pre-tool.js': 'pre-tool-use-hook.js',
        'session-start.js': 'session-start-hook.js',
        'prompt-submit.js': 'prompt-submit-hook.js',
        'stop.js': 'stop-hook.js',
        'stop-git.js': 'stop-hook-git.js'
      };

      if (variantMap[file]) {
        const oldPath = path.join(hooksDir, file);
        const newPath = path.join(hooksDir, variantMap[file]);

        fs.renameSync(oldPath, newPath);
        results.healed.push(`hooks/${file}: Renamed to ${variantMap[file]}`);
      }
    });
  }

  /**
   * Generate report of healing actions
   */
  static generateHealingReport(results) {
    let report = '\n' + '='.repeat(60) + '\n';
    report += 'AUTO-HEALER REPORT\n';
    report += '='.repeat(60) + '\n\n';

    if (results.healed.length === 0 && results.warnings.length === 0 && results.fixable.length === 0) {
      report += '✅ No issues detected - configuration is clean\n\n';
      return report;
    }

    if (results.healed.length > 0) {
      report += '✅ HEALED ISSUES:\n';
      results.healed.forEach(h => report += `   ✓ ${h}\n`);
      report += '\n';
    }

    if (results.warnings.length > 0) {
      report += '⚠️  WARNINGS:\n';
      results.warnings.forEach(w => report += `   ⚠️  ${w}\n`);
      report += '\n';
    }

    if (results.fixable.length > 0) {
      report += '🔧 MANUALLY FIXABLE ISSUES:\n';
      results.fixable.forEach(f => report += `   • ${f}\n`);
      report += '\n';
    }

    if (results.unfixable.length > 0) {
      report += '❌ UNFIXABLE ISSUES:\n';
      results.unfixable.forEach(u => report += `   ✗ ${u}\n`);
      report += '\n';
    }

    report += '='.repeat(60) + '\n\n';
    return report;
  }
}

module.exports = AutoHealer;
