const fs = require('fs');
const path = require('path');

/**
 * Comprehensive build report generation for debugging and verification
 */
class BuildReporter {
  /**
   * Generate detailed build report showing all generated files per platform
   */
  static generateDetailedReport(results, outputDir) {
    let report = '\n' + '='.repeat(70) + '\n';
    report += 'DETAILED BUILD REPORT\n';
    report += '='.repeat(70) + '\n\n';

    const successful = Object.values(results).filter(r => r.success);
    const failed = Object.values(results).filter(r => !r.success);

    // Summary statistics
    report += `Build Results: ${successful.length} succeeded, ${failed.length} failed\n`;
    report += `Output Directory: ${outputDir}\n\n`;

    // Successful builds
    if (successful.length > 0) {
      report += 'SUCCESSFUL BUILDS:\n';
      report += '-'.repeat(70) + '\n\n';

      successful.forEach(result => {
        report += `📦 ${result.platform.padEnd(15)} | ${result.files.length} files\n`;

        const filesByType = this.categorizeFiles(result.files);
        for (const [category, files] of Object.entries(filesByType)) {
          if (files.length > 0) {
            report += `   ${category}:\n`;
            files.slice(0, 5).forEach(f => report += `     • ${f}\n`);
            if (files.length > 5) {
              report += `     ... and ${files.length - 5} more\n`;
            }
          }
        }
        report += '\n';
      });
    }

    // Failed builds
    if (failed.length > 0) {
      report += 'FAILED BUILDS:\n';
      report += '-'.repeat(70) + '\n\n';

      failed.forEach(result => {
        report += `❌ ${result.platform}\n`;
        report += `   Error: ${result.error}\n`;
        if (result.stack) {
          report += `   Stack:\n`;
          result.stack.split('\n').slice(0, 3).forEach(line => {
            report += `     ${line}\n`;
          });
        }
        report += '\n';
      });
    }

    report += '='.repeat(70) + '\n\n';

    return report;
  }

  /**
   * Categorize files for better visualization
   */
  static categorizeFiles(files) {
    const categories = {
      'Config Files': [],
      'Agents': [],
      'Hooks': [],
      'Skills': [],
      'Documentation': [],
      'Other': []
    };

    files.forEach(file => {
      if (file.includes('package.json') || file.includes('.json') || file.includes('.yml') || file.includes('.yaml')) {
        categories['Config Files'].push(file);
      } else if (file.startsWith('agents/')) {
        categories['Agents'].push(file);
      } else if (file.startsWith('hooks/')) {
        categories['Hooks'].push(file);
      } else if (file.startsWith('skills/') || file.startsWith('docs/skills/')) {
        categories['Skills'].push(file);
      } else if (file.includes('README') || file.includes('CONTRIBUTING') || file.includes('LICENSE') || file.includes('.md')) {
        categories['Documentation'].push(file);
      } else {
        categories['Other'].push(file);
      }
    });

    return Object.fromEntries(Object.entries(categories).filter(([, files]) => files.length > 0));
  }

  /**
   * Generate platform-specific detailed report
   */
  static generatePlatformDetailReport(platformName, platformDir) {
    if (!fs.existsSync(platformDir)) {
      return `Platform directory not found: ${platformDir}`;
    }

    let report = `\nDETAILED REPORT FOR ${platformName.toUpperCase()}\n`;
    report += '='.repeat(50) + '\n\n';

    const walkDir = (dir, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort();
      entries.forEach((entry, index) => {
        const isLast = index === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const relativePath = path.relative(platformDir, path.join(dir, entry.name));

        if (entry.isDirectory()) {
          report += `${prefix}${connector}${entry.name}/\n`;
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          walkDir(path.join(dir, entry.name), newPrefix);
        } else {
          const stats = fs.statSync(path.join(dir, entry.name));
          const sizeKb = (stats.size / 1024).toFixed(1);
          report += `${prefix}${connector}${entry.name} (${sizeKb}KB)\n`;
        }
      });
    };

    walkDir(platformDir);
    report += '\n';
    return report;
  }

  /**
   * Validate hook file content across all platforms
   */
  static validateHookFileContent(platformName, platformDir) {
    const hooksDir = path.join(platformDir, 'hooks');
    const issues = [];

    if (!fs.existsSync(hooksDir)) {
      issues.push(`⚠️  No hooks directory found`);
      return issues;
    }

    // Check for hooks.json
    const hooksJsonPath = path.join(hooksDir, 'hooks.json');
    if (!fs.existsSync(hooksJsonPath)) {
      issues.push(`❌ Missing hooks.json`);
      return issues;
    }

    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));

      // Verify hook file references
      const hookNames = Object.keys(hooksJson.hooks || {});
      hookNames.forEach(eventName => {
        const eventHooks = hooksJson.hooks[eventName];
        if (Array.isArray(eventHooks)) {
          eventHooks.forEach(hookGroup => {
            if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
              hookGroup.hooks.forEach(hook => {
                if (hook.command && (hook.command.includes('${__dirname}') || hook.command.match(/\$\{[A-Z_]+\}/))) {
                  const match = hook.command.match(/(?:\$\{[A-Z_]+\}|(?:\$\{__dirname\}))\/(?:hooks\/|bin\/)?(.*?)(?:\s|$)/);
                  if (match) {
                    const pathPart = match[1];
                    const hooksPath = path.join(hooksDir, pathPart);
                    const platformDir = path.dirname(hooksDir);
                    const binPath = path.join(platformDir, 'bin', pathPart);
                    const resolved = fs.existsSync(hooksPath) ? hooksPath : (fs.existsSync(binPath) ? binPath : null);
                    if (!resolved) {
                      issues.push(`❌ Referenced hook file missing: ${pathPart}`);
                    }
                  }
                } else if (hook.command && !hook.command.match(/\$\{[A-Z_]*__dirname[A-Z_]*\}/) && !hook.command.match(/\$\{[a-zA-Z_]+\}/)) {
                  issues.push(`⚠️  Hook "${eventName}" doesn't use path variables: ${hook.command}`);
                }
              });
            }
          });
        }
      });

      if (issues.length === 0) {
        issues.push(`✅ hooks.json valid with ${hookNames.length} event types`);
      }
    } catch (e) {
      issues.push(`❌ Failed to parse hooks.json: ${e.message}`);
    }

    return issues;
  }

  /**
   * Check for common configuration issues across outputs
   */
  static checkCommonIssues(results, outputDir) {
    const issues = [];

    // Check file count consistency
    const successfulResults = Object.values(results).filter(r => r.success);
    if (successfulResults.length > 1) {
      const fileCounts = successfulResults.map(r => r.files.length);
      const avgCount = Math.round(fileCounts.reduce((a, b) => a + b, 0) / fileCounts.length);
      const outliers = fileCounts.filter(count => Math.abs(count - avgCount) > 5);

      if (outliers.length > 0) {
        issues.push(
          `⚠️  Some platforms have unusual file counts (avg: ${avgCount}). ` +
          `This might indicate platform-specific issues.`
        );
      }
    }

    // Check for required files in all platforms
    const requiredFiles = {
      'README.md': 'Missing README documentation',
      'hooks/hooks.json': 'Missing hooks configuration',
      'agents/gm.md': 'Missing gm agent'
    };

    successfulResults.forEach(result => {
      const normalizedFiles = result.files.map(f => f.replace(/\\/g, '/'));
      Object.entries(requiredFiles).forEach(([file, message]) => {
        if (!normalizedFiles.includes(file)) {
          issues.push(`⚠️  ${result.platform}: ${message}`);
        }
      });
    });

    // Check for orphaned platform builds
    if (successfulResults.length < 8) {
      issues.push(`ℹ️  Only ${successfulResults.length}/9 platforms were built successfully`);
    }

    return issues;
  }
}

module.exports = BuildReporter;
