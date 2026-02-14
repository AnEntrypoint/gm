const tools = require('./copilot-cli-tools');
const templates = require('./copilot-cli-templates');
const content = require('./copilot-cli-content');

module.exports = {
  generateAgentProfile(pluginSpec) {
    return templates.agentProfile(pluginSpec);
  },

  generateToolsJson(pluginSpec) {
    return JSON.stringify({
      name: 'glootie',
      version: pluginSpec.version,
      description: pluginSpec.description,
      tools,
      mcp_servers: pluginSpec.mcp || {}
    }, null, 2);
  },

  generateManifest(pluginSpec) {
    return templates.manifest(pluginSpec);
  },

  generateCliJs() {
    return templates.cliJs();
  },

  generateReadme() {
    return content.readme();
  }
};
