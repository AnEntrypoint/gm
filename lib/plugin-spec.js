const defaultPluginSpec = {
  name: 'glootie',
  version: '2.0.9',
  description: 'gm state machine plugin',
  author: {
    name: 'AnEntrypoint',
    url: 'https://github.com/AnEntrypoint'
  },
  homepage: 'https://github.com/AnEntrypoint',
  keywords: ['glootie', 'plugin', 'automation', 'mcp'],
  license: 'MIT',
  engines: { node: '>=16.0.0' },
  publishConfig: { access: 'public' },
  agents: {
    gm: './agents/gm.md',
    codesearch: './agents/codesearch.md',
    websearch: './agents/websearch.md'
  },
  hooks: {
    'session-start': './session-start-hook.js',
    'pre-tool': './pre-tool-use-hook.js',
    'prompt-submit': './prompt-submit-hook.js',
    'stop': './stop-hook.js',
    'stop-git': './stop-hook-git.js'
  },
  mcp: {
    dev: {
      command: 'npx',
      args: ['-y', 'gxe@latest', 'AnEntrypoint/mcp-glootie'],
      timeout: 360000
    },
    'code-search': {
      command: 'npx',
      args: ['-y', 'gxe@latest', 'AnEntrypoint/code-search'],
      timeout: 360000
    }
  },
  verification: {
    file: '.glootie-stop-verified',
    gitignore: true
  },
  features: [
    'gm-state-machine',
    'mcp-integration',
    'hook-system',
    'verification-lifecycle',
    'hot-reload',
    'real-data-only'
  ]
};

const platformCompatibility = {
  'session-start': { cc: true, gc: true, oc: true },
  'pre-tool': { cc: true, gc: true, oc: 'partial' },
  'prompt-submit': { cc: true, gc: true, oc: 'partial' },
  'stop': { cc: true, gc: true, oc: true },
  'stop-git': { cc: true, gc: true, oc: true },
  'mcp-integration': { cc: true, gc: true, oc: true },
  'hot-reload': { cc: true, gc: true, oc: true },
  'real-data-only': { cc: true, gc: true, oc: true }
};

const validatePluginSpec = (spec) => {
  const errors = [];
  if (!spec.name) errors.push('name required');
  if (!spec.version) errors.push('version required');
  if (!spec.agents || typeof spec.agents !== 'object') errors.push('agents object required');
  if (!spec.hooks || typeof spec.hooks !== 'object') errors.push('hooks object required');
  if (!spec.mcp || typeof spec.mcp !== 'object') errors.push('mcp object required');
  return { valid: errors.length === 0, errors };
};

const checkPlatformCompatibility = (spec, platformId) => {
  const warnings = [];
  const partialFeatures = [];

  Object.entries(spec.hooks).forEach(([hookId, _]) => {
    const compat = platformCompatibility[hookId];
    if (compat && compat[platformId] === 'partial') {
      partialFeatures.push(hookId);
    }
  });

  spec.features?.forEach(feature => {
    const compat = platformCompatibility[feature];
    if (compat && compat[platformId] === 'partial') {
      partialFeatures.push(feature);
    }
  });

  if (partialFeatures.length > 0) {
    warnings.push(`Platform ${platformId}: Features with partial support: ${partialFeatures.join(', ')}`);
  }

  return { warnings };
};

const mergePluginSpec = (base, override) => {
  return {
    ...base,
    ...override,
    agents: { ...base.agents, ...override.agents },
    hooks: { ...base.hooks, ...override.hooks },
    mcp: { ...base.mcp, ...override.mcp },
    features: [...new Set([...base.features, ...(override.features || [])])]
  };
};

module.exports = {
  defaultPluginSpec,
  validatePluginSpec,
  checkPlatformCompatibility,
  platformCompatibility,
  mergePluginSpec
};
