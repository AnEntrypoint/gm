function buildHooksMapCustom(hookEventNames, hookOutputFormat, createCustomCommand, createBootstrap) {
  const hooks = {};
  const hookDefs = [
    { event: 'preTool', hookEvent: 'pre-tool-use', timeout: 3600 },
    { event: 'sessionStart', hookEvent: 'session-start', timeout: 180000 },
    { event: 'promptSubmit', hookEvent: 'prompt-submit', timeout: 60000 },
    { event: 'preCompact', hookEvent: 'pre-compact', timeout: 30000 },
    { event: 'stop', hookEvents: [
      { hookEvent: 'stop', timeout: 300000 },
      { hookEvent: 'stop-git', timeout: 60000 }
    ]}
  ];
  hookDefs.forEach(def => {
    const eventKey = hookEventNames[def.event];
    if (!eventKey) return;
    if (def.hookEvents) {
      const cmds = def.hookEvents.map(h => createCustomCommand(h.hookEvent, h.timeout));
      hooks[eventKey] = hookOutputFormat === 'bare' ? cmds : [{ matcher: '*', hooks: cmds }];
    } else {
      const cmds = [];
      if (def.bootstrap) cmds.push(createBootstrap());
      cmds.push(createCustomCommand(def.hookEvent, def.timeout));
      hooks[eventKey] = hookOutputFormat === 'bare' ? cmds[0] : [{ matcher: '*', hooks: cmds }];
    }
  });
  return hooks;
}

function replaceHookDirVar(hooksMap, envVar) {
  const replace = (cmd) => cmd
    .replace(/\$\{__dirname\}/g, `\${${envVar}}/hooks`)
    .replace(/\$\{__pluginroot__\}/g, `\${${envVar}}`);
  Object.values(hooksMap).forEach(hookArray => {
    if (Array.isArray(hookArray)) {
      hookArray.forEach(hookGroup => {
        if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
          hookGroup.hooks.forEach(hook => { if (hook.command) hook.command = replace(hook.command); });
        }
      });
    } else if (hookArray.command) {
      hookArray.command = replace(hookArray.command);
    }
  });
}

module.exports = { buildHooksMapCustom, replaceHookDirVar };
