#!/usr/bin/env node

/**
 * Post-tool-use hook: Eager linting report
 *
 * If linting is available (eslint, prettier, etc.), run it on modified files.
 * If linting issues found, report them to agent immediately.
 * If no issues or no linter available, silent (do nothing).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();

/**
 * Detect available linters and run them
 * Returns array of issue reports
 */
function runLinters() {
  const issues = [];

  // Detect ESLint
  try {
    if (fs.existsSync(path.join(cwd, '.eslintrc.json')) ||
        fs.existsSync(path.join(cwd, '.eslintrc.js')) ||
        fs.existsSync(path.join(cwd, 'eslint.config.js')) ||
        hasPackageDependency('eslint')) {
      const eslintOutput = execSync('npx eslint . --format=json 2>/dev/null || true', {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      }).trim();

      if (eslintOutput) {
        try {
          const results = JSON.parse(eslintOutput);
          const filtered = results.filter(r => r.messages?.length > 0);
          if (filtered.length > 0) {
            issues.push({
              tool: 'ESLint',
              issues: filtered
            });
          }
        } catch (e) {
          // JSON parse failed, skip
        }
      }
    }
  } catch (e) {
    // ESLint not available, continue
  }

  // Detect Prettier
  try {
    if (fs.existsSync(path.join(cwd, '.prettierrc')) ||
        fs.existsSync(path.join(cwd, '.prettierrc.json')) ||
        fs.existsSync(path.join(cwd, 'prettier.config.js')) ||
        hasPackageDependency('prettier')) {
      const prettierOutput = execSync('npx prettier . --check 2>&1 || true', {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      }).trim();

      if (prettierOutput && !prettierOutput.includes('All matched files use Prettier code style')) {
        issues.push({
          tool: 'Prettier',
          output: prettierOutput
        });
      }
    }
  } catch (e) {
    // Prettier not available, continue
  }

  return issues;
}

/**
 * Check if package has a dependency (in package.json)
 */
function hasPackageDependency(pkg) {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const content = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return !!(
        content.dependencies?.[pkg] ||
        content.devDependencies?.[pkg] ||
        content.optionalDependencies?.[pkg]
      );
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * Format and report linting issues
 */
function reportIssues(issues) {
  if (!issues || issues.length === 0) {
    return; // Silent if no issues
  }

  let report = '\n⚠️  LINTING ISSUES DETECTED:\n\n';

  issues.forEach(({ tool, issues: eslintIssues, output }) => {
    report += `## ${tool}\n`;

    if (eslintIssues) {
      // ESLint format
      eslintIssues.forEach(file => {
        if (file.messages.length > 0) {
          report += `\n**${file.filePath}**\n`;
          file.messages.forEach(msg => {
            const severity = msg.severity === 2 ? '❌ ERROR' : '⚠️  WARN';
            report += `  ${severity} (${msg.line}:${msg.column}) ${msg.message} [${msg.ruleId}]\n`;
          });
        }
      });
    } else if (output) {
      // Prettier format
      report += `\n${output}\n`;
    }

    report += '\n';
  });

  report += 'Fix these issues before marking work complete.\n';
  console.log(report);
}

// Main
try {
  const issues = runLinters();
  reportIssues(issues);
} catch (e) {
  // Silent on errors - don't break the workflow
}
