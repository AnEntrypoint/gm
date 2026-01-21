const fs = require('fs');
const path = require('path');

class ConventionLoader {
  static load(pluginDir) {
    const glootieJsonPath = path.join(pluginDir, 'glootie.json');
    if (!fs.existsSync(glootieJsonPath)) {
      throw new Error(`glootie.json not found in ${pluginDir}`);
    }

    const glootieJson = JSON.parse(fs.readFileSync(glootieJsonPath, 'utf-8'));
    const agentsDir = path.join(pluginDir, 'agents');
    const hooksDir = path.join(pluginDir, 'hooks');

    const agents = this.loadAgents(agentsDir);
    const hooks = this.loadHooks(hooksDir);

    return {
      spec: glootieJson,
      agents,
      hooks,
      baseDir: pluginDir,
      agentsDir,
      hooksDir
    };
  }

  static loadAgents(agentsDir) {
    const agents = {};
    if (!fs.existsSync(agentsDir)) {
      return agents;
    }

    fs.readdirSync(agentsDir).forEach(file => {
      if (file.endsWith('.md')) {
        const agentName = path.basename(file, '.md');
        const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
        agents[agentName] = {
          name: agentName,
          file: file,
          path: path.join(agentsDir, file),
          content
        };
      }
    });

    return agents;
  }

  static loadHooks(hooksDir) {
    const hooks = {};
    if (!fs.existsSync(hooksDir)) {
      return hooks;
    }

    fs.readdirSync(hooksDir).forEach(file => {
      if (file.endsWith('.js')) {
        const hookName = path.basename(file, '.js');
        const content = fs.readFileSync(path.join(hooksDir, file), 'utf-8');
        hooks[hookName] = {
          name: hookName,
          file: file,
          path: path.join(hooksDir, file),
          content
        };
      }
    });

    return hooks;
  }

  static validate(loaded) {
    const errors = [];

    if (!loaded.spec.name) errors.push('glootie.json must have name');
    if (!loaded.spec.version) errors.push('glootie.json must have version');
    if (!loaded.spec.author) errors.push('glootie.json must have author');
    if (!loaded.spec.license) errors.push('glootie.json must have license');

    if (Object.keys(loaded.agents).length === 0) {
      errors.push('No agents found in agents/ directory');
    }

    if (Object.keys(loaded.hooks).length === 0) {
      errors.push('No hooks found in hooks/ directory');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = ConventionLoader;
