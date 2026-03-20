#!/usr/bin/env bun

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();

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

function runLinters() {
  const issues = [];

  try {
    if (fs.existsSync(path.join(cwd, '.eslintrc.json')) ||
        fs.existsSync(path.join(cwd, '.eslintrc.js')) ||
        fs.existsSync(path.join(cwd, 'eslint.config.js')) ||
        hasPackageDependency('eslint')) {
      const eslintOutput = execSync('npx eslint . --format=json 2>/dev/null || true', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024
      }).trim();

      if (eslintOutput) {
        try {
          const results = JSON.parse(eslintOutput);
          const filtered = results.filter(r => r.messages?.length > 0);
          if (filtered.length > 0) {
            issues.push({ tool: 'ESLint', issues: filtered });
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  try {
    if (fs.existsSync(path.join(cwd, '.prettierrc')) ||
        fs.existsSync(path.join(cwd, '.prettierrc.json')) ||
        fs.existsSync(path.join(cwd, 'prettier.config.js')) ||
        hasPackageDependency('prettier')) {
      const prettierOutput = execSync('npx prettier . --check 2>&1 || true', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024
      }).trim();

      if (prettierOutput && !prettierOutput.includes('All matched files use Prettier code style')) {
        issues.push({ tool: 'Prettier', output: prettierOutput });
      }
    }
  } catch (e) {}

  return issues;
}

function reportIssues(issues) {
  if (!issues || issues.length === 0) return;

  let report = '\nLINTING ISSUES DETECTED:\n\n';

  issues.forEach(({ tool, issues: eslintIssues, output }) => {
    report += `## ${tool}\n`;

    if (eslintIssues) {
      eslintIssues.forEach(file => {
        if (file.messages.length > 0) {
          report += `\n**${file.filePath}**\n`;
          file.messages.forEach(msg => {
            const severity = msg.severity === 2 ? 'ERROR' : 'WARN';
            report += `  ${severity} (${msg.line}:${msg.column}) ${msg.message} [${msg.ruleId}]\n`;
          });
        }
      });
    } else if (output) {
      report += `\n${output}\n`;
    }

    report += '\n';
  });

  report += 'Fix these issues before marking work complete.\n';
  console.log(report);
}

function cleanupStoppedTasks() {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('pm2', ['jlist'], { encoding: 'utf-8', timeout: 5000 });
    if (!r.stdout) return;
    const list = JSON.parse(r.stdout);
    const stopped = list.filter(p => p.name?.startsWith('gm-exec-task-') && p.pm2_env?.status !== 'online');
    for (const p of stopped) {
      spawnSync('pm2', ['delete', p.name], { encoding: 'utf-8', timeout: 5000 });
    }
  } catch (e) {}
}

try {
  cleanupStoppedTasks();
  const issues = runLinters();
  reportIssues(issues);
} catch (e) {}
