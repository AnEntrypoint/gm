const fs = require('fs');
const path = require('path');
const ConventionLoader = require('./convention-loader');
const StrictValidator = require('./strict-validator');
const BuildReporter = require('./build-reporter');
const TemplateBuilder = require('./template-builder');
const PLATFORMS = {
  'skill': () => require('../platforms/skill')
};

class AutoGenerator {
  constructor(pluginDir, outputDir) {
    this.pluginDir = pluginDir;
    this.outputDir = outputDir;
    this.loaded = null;
    this.results = {};
  }

  async generate() {
    this.loaded = ConventionLoader.load(this.pluginDir);

    const validation = StrictValidator.validate(this.loaded);
    console.log(StrictValidator.generateReport(validation));

    if (!validation.valid) {
      throw new Error(`Plugin validation failed. Fix the errors above and try again.`);
    }

    this.ensureDir(this.outputDir);
    this.results = {};

    const sharedSkills = TemplateBuilder.loadSharedSkills(this.pluginDir);

    for (const [platformName, AdapterFactory] of Object.entries(PLATFORMS)) {
      try {
        const platformDir = path.join(this.outputDir, `gm-${platformName}`);
        const AdapterClass = AdapterFactory();
        const config = TemplateBuilder.selectBundledSkills(platformName) ? { skillsCache: sharedSkills } : {};
        const adapter = new AdapterClass(config);

        this.cleanBuildDir(platformDir);
        adapter.generate(this.loaded.spec, this.pluginDir, platformDir);

        this.results[platformName] = {
          success: true,
          platform: platformName,
          dir: platformDir,
          files: this.getPlatformFiles(platformDir)
        };
      } catch (error) {
        this.results[platformName] = {
          success: false,
          platform: platformName,
          error: error.message,
          stack: error.stack
        };
      }
    }

    return this.results;
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  cleanBuildDir(platformDir) {
    if (!fs.existsSync(platformDir)) return;
    const entries = fs.readdirSync(platformDir, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(platformDir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    });
  }

  getPlatformFiles(platformDir) {
    const files = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        const relative = path.relative(platformDir, fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          files.push(relative);
        }
      });
    };
    walk(platformDir);
    return files;
  }

  validateGeneratedFiles() {
    const validation = {};
    const platformRequirements = {
      'skill': { hasPackageJson: true, hasReadme: true }
    };

    Object.keys(PLATFORMS).forEach(platform => {
      const result = this.results[platform];
      if (!result || !result.success) {
        validation[platform] = { status: 'failed', error: result?.error || 'No result' };
        return;
      }

      const files = result.files || [];
      const fileSet = new Set(files);
      const hasPackageJson = fileSet.has('package.json');
      const hasReadme = fileSet.has('README.md');
      const hasAgents = files.some(f => f.startsWith('agents/'));
      const hasSkills = files.some(f => f.startsWith('skills/') || f.startsWith('docs/skills/'));

      const reqs = platformRequirements[platform] || {};
      let criticalFilesValid = true;
      if (reqs.hasPackageJson !== undefined && reqs.hasPackageJson !== hasPackageJson) criticalFilesValid = false;
      if (reqs.hasReadme !== undefined && reqs.hasReadme !== hasReadme) criticalFilesValid = false;
      if (reqs.hasAgents !== undefined && reqs.hasAgents !== hasAgents) criticalFilesValid = false;

      validation[platform] = {
        status: criticalFilesValid ? 'valid' : 'missing-critical',
        fileCount: files.length,
        hasPackageJson,
        hasReadme,
        hasAgents,
        hasSkills
      };
    });
    return validation;
  }

  logResults() {
    const detailedReport = BuildReporter.generateDetailedReport(this.results, this.outputDir);
    console.log(detailedReport);

    const issues = BuildReporter.checkCommonIssues(this.results, this.outputDir);
    if (issues.length > 0) {
      console.log('POTENTIAL ISSUES:\n');
      issues.forEach(issue => console.log(`  ${issue}`));
      console.log();
    }

    const successfulPlatforms = Object.entries(this.results)
      .filter(([, r]) => r.success)
      .map(([name]) => name);

    if (successfulPlatforms.length > 0) {
      console.log('HOOK VALIDATION:\n');
      successfulPlatforms.forEach(platform => {
        const platformDir = path.join(this.outputDir, `gm-${platform}`);
        const hookIssues = BuildReporter.validateHookFileContent(platform, platformDir);
        hookIssues.forEach(issue => console.log(`  ${platform}: ${issue}`));
      });
      console.log();
    }
  }
}

module.exports = AutoGenerator;
