const CLIAdapter = require('../lib/cli-adapter');
const { cc: ccConfig, gc: gcConfig, oc: ocConfig, codex: codexConfig, kilo: kiloConfig, qwen: qwenConfig, hermes: hermesConfig } = require('./cli-config-shared');

const config = [ccConfig, gcConfig, ocConfig, codexConfig, kiloConfig, qwenConfig, hermesConfig];

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

    buildHooksMap(pluginSpec) {
      return cfg.buildHooksMap ? cfg.buildHooksMap.call(this, pluginSpec) : super.buildHooksMap(pluginSpec);
    }

    loadSkillsFromSource(sourceDir) {
      return cfg.loadSkillsFromSource ? cfg.loadSkillsFromSource(sourceDir) : super.loadSkillsFromSource(sourceDir);
    }

    loadLangFromSource(sourceDir) {
      return cfg.loadLangFromSource ? cfg.loadLangFromSource(sourceDir) : {};
    }
  }

  return DynamicCLIAdapter;
}

module.exports = { config, createAdapterClass };
