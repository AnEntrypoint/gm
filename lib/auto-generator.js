const fs = require('fs');
const path = require('path');
const ConventionLoader = require('./convention-loader');
const { config: cliConfig, createAdapterClass } = require('../platforms/cli-platforms');

const PLATFORMS = {
  'cc': () => createAdapterClass(cliConfig[0]),
  'gc': () => createAdapterClass(cliConfig[1]),
  'oc': () => createAdapterClass(cliConfig[2]),
  'codex': () => createAdapterClass(cliConfig[3]),
  'vscode': () => require('../platforms/vscode'),
  'cursor': () => require('../platforms/cursor'),
  'zed': () => require('../platforms/zed'),
  'jetbrains': () => require('../platforms/jetbrains'),
  'copilot-cli': () => require('../platforms/copilot-cli')
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

    const validation = ConventionLoader.validate(this.loaded);
    if (!validation.valid) {
      throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`);
    }

    this.ensureDir(this.outputDir);

    for (const [platformName, AdapterFactory] of Object.entries(PLATFORMS)) {
      try {
        const platformDir = path.join(this.outputDir, `glootie-${platformName}`);
        const AdapterClass = AdapterFactory();
        const adapter = new AdapterClass();

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
          error: error.message
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

  logResults() {
    console.log('\nGeneration Results:');
    console.log('==================\n');

    Object.keys(PLATFORMS).forEach(platform => {
      const result = this.results[platform];
      if (result.success) {
        console.log(`✓ ${result.platform}: ${result.files.length} files`);
        result.files.slice(0, 3).forEach(f => console.log(`  - ${f}`));
        if (result.files.length > 3) {
          console.log(`  ... and ${result.files.length - 3} more`);
        }
      } else {
        console.log(`✗ ${result.platform}: ${result.error}`);
      }
    });

    console.log('\nOutput directories:');
    Object.keys(PLATFORMS).forEach(platform => {
      if (this.results[platform].success) {
        console.log(`  ${path.join(this.outputDir, `glootie-${platform}`)}`);
      }
    });
  }
}

module.exports = AutoGenerator;
