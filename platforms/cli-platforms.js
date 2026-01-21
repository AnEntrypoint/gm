const CLIAdapter = require('../lib/cli-adapter');
const ccConfig = require('./cli-config-cc');
const gcConfig = require('./cli-config-gc');
const ocConfig = require('./cli-config-oc');

const config = [ccConfig, gcConfig, ocConfig];

function createAdapterClass(cfg) {
  class DynamicCLIAdapter extends CLIAdapter {
    constructor() {
      super(cfg);
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
  }

  return DynamicCLIAdapter;
}

module.exports = { config, createAdapterClass };
