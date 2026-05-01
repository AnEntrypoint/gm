const CANONICAL_SUBCOMMANDS = [
  'session-start',
  'session-end',
  'pre-tool-use',
  'post-tool-use',
  'prompt-submit',
  'pre-compact',
  'post-compact',
  'stop',
  'stop-git'
];

const PLUGKIT_PREFIXES = {
  node: (env) => `node \${${env}}/bin/plugkit.js hook`,
  binary: (env) => `\${${env}}/bin/plugkit hook`
};

const WRAP_MODES = {
  wrapped: (commands) => [{ matcher: '*', hooks: commands }],
  'flat-matchers': (commands) => commands.map(c => ({ matcher: '*', hooks: [c] }))
};

function buildCommand(cmd, ctx) {
  const env = ctx.envVar;
  if (cmd.kind === 'plugkit') {
    const prefix = PLUGKIT_PREFIXES[ctx.plugkitInvoker || 'node'](env);
    const sub = cmd.subcommandRename || cmd.subcommand;
    return { type: 'command', command: `${prefix} ${sub}`, timeout: cmd.timeout };
  }
  if (cmd.kind === 'js') {
    return { type: 'command', command: `node \${${env}}/hooks/${cmd.file}`, timeout: cmd.timeout };
  }
  throw new Error(`unknown hook command kind: ${cmd.kind}`);
}

function buildHooksJson(spec) {
  const ctx = { envVar: spec.envVar, plugkitInvoker: spec.plugkitInvoker };
  const wrap = WRAP_MODES[spec.wrapMode || 'wrapped'];
  if (!wrap) throw new Error(`unknown wrapMode: ${spec.wrapMode}`);
  const hooks = {};
  for (const ev of spec.events) {
    const cmds = ev.commands.map(c => buildCommand(c, ctx));
    const wrapMode = ev.wrapMode || spec.wrapMode || 'wrapped';
    const wrapper = WRAP_MODES[wrapMode];
    if (!wrapper) throw new Error(`unknown event wrapMode: ${wrapMode}`);
    hooks[ev.eventKey] = wrapper(cmds);
  }
  return { description: spec.description, hooks };
}

module.exports = { CANONICAL_SUBCOMMANDS, PLUGKIT_PREFIXES, WRAP_MODES, buildHooksJson };
