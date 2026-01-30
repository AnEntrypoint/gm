const CLIAdapter = require('../lib/cli-adapter');
const ccConfig = require('./cli-config-cc');
const gcConfig = require('./cli-config-gc');
const ocConfig = require('./cli-config-oc');
const codexConfig = require('./cli-config-codex');

const config = [ccConfig, gcConfig, ocConfig, codexConfig];

function createAdapterClass(cfg) {
  class DynamicCLIAdapter extends CLIAdapter {
    constructor() {
      super(cfg);
      this.shouldAlwaysGeneratePackageJson = !!cfg.generatePackageJson;
    }

    formatConfigJson(config, pluginSpec) {
      return cfg.formatConfigJson.call(this, config, pluginSpec);
    }

    getPackageJsonMain() {
      return cfg.getPackageJsonMain ? cfg.getPackageJsonMain() : 'cli.js';
    }

    getPackageJsonFields() {
      return cfg.getPackageJsonFields ? cfg.getPackageJsonFields() : { files: [] };
    }

    getAdditionalFiles(pluginSpec, readFile) {
      return cfg.getAdditionalFiles ? cfg.getAdditionalFiles(pluginSpec, readFile) : {};
    }

    generateReadme(pluginSpec) {
      return cfg.generateReadme ? cfg.generateReadme(pluginSpec) : super.generateReadme(pluginSpec);
    }

    generatePackageJson(pluginSpec, extraFields = {}) {
      return cfg.generatePackageJson ? cfg.generatePackageJson(pluginSpec, extraFields) : super.generatePackageJson(pluginSpec, extraFields);
    }

    buildHookCommand(hookFile) {
      return cfg.buildHookCommand ? cfg.buildHookCommand(hookFile) : null;
    }
  }

  return DynamicCLIAdapter;
}

module.exports = { config, createAdapterClass };
