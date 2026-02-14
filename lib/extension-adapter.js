const PlatformAdapter = require('../platforms/base');

class ExtensionAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.extensionConfig = {
      manifestType: config.manifestType || 'extension',
      ...(config.extensionConfig || {})
    };
  }

  createFileStructure(pluginSpec, sourceDir) {
    throw new Error('ExtensionAdapter.createFileStructure must be implemented by subclass');
  }

  generateExtensionManifest(pluginSpec) {
    throw new Error('generateExtensionManifest must be implemented by subclass');
  }
}

module.exports = ExtensionAdapter;
