const fs = require('fs');
const path = require('path');

class ConventionLoader {
  static load(pluginDir) {
    const resolvedDir = path.resolve(pluginDir);
    const glootieJsonPath = path.join(resolvedDir, 'glootie.json');
    if (!fs.existsSync(glootieJsonPath)) {
      throw new Error(`glootie.json not found in ${resolvedDir}`);
    }

    const glootieJson = JSON.parse(fs.readFileSync(glootieJsonPath, 'utf-8'));
    const agentsDir = path.join(resolvedDir, 'agents');
    const hooksDir = path.join(resolvedDir, 'hooks');
    const skillsDir = path.join(resolvedDir, 'skills');

    const agents = this.loadAgents(agentsDir);
    const hooks = this.loadHooks(hooksDir);
    const skills = this.loadSkills(skillsDir);

    return {
      spec: glootieJson,
      agents,
      hooks,
      skills,
      baseDir: resolvedDir,
      agentsDir,
      hooksDir,
      skillsDir
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

  static loadSkills(skillsDir) {
    const skills = {};
    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    fs.readdirSync(skillsDir).forEach(skillName => {
      const skillPath = path.join(skillsDir, skillName);
      const stat = fs.statSync(skillPath);
      if (stat.isDirectory()) {
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          skills[skillName] = {
            name: skillName,
            file: 'SKILL.md',
            path: skillMdPath,
            content
          };
        }
      }
    });

    return skills;
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
      errors,
      hasSkills: Object.keys(loaded.skills).length > 0
    };
  }
}

module.exports = ConventionLoader;
