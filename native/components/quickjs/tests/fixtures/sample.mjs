import { label } from './helper.mjs';

export const verbs = [
  {
    name: 'sample_value',
    description: 'Returns the fixture value.',
    inputSchema: { type: 'object', properties: { who: { type: 'string' } } },
    call: async (args) => ({ ok: true, value: 1, label: label(args.who) }),
  },
  {
    name: 'sample_host',
    description: 'Reads a file and runs a shell through the host.',
    inputSchema: { type: 'object' },
    call: async (args) => {
      const file = await host.read_file({ path: args.path });
      const shell = await host.shell({ command: 'echo hi' });
      return { ok: true, content: file.content, shell: shell.output };
    },
  },
  {
    name: 'sample_throw',
    description: 'Throws.',
    inputSchema: { type: 'object' },
    call: () => {
      throw new Error('leaf failed on purpose');
    },
  },
  {
    name: 'sample_paths',
    description: 'Returns the host paths as data.',
    inputSchema: { type: 'object' },
    call: () => ({ workspace: host.workspace, runDir: host.runDir, kinds: [typeof host.workspace, typeof host.runDir] }),
  },
  {
    name: 'sample_host_shape',
    description: 'Describes the names the host global provides.',
    inputSchema: { type: 'object' },
    call: () => ({
      missing: typeof host.no_such_verb,
      deleteFile: typeof host.delete_file,
      missingIn: 'no_such_verb' in host,
      keys: Object.keys(host).sort(),
      kinds: Object.fromEntries(['read_file', 'shell', 'logAppend', 'workspace', 'runDir'].map((name) => [name, typeof host[name]])),
    }),
  },
  {
    name: 'sample_missing_host',
    description: 'Calls a host verb that does not exist.',
    inputSchema: { type: 'object' },
    call: async () => host.no_such_verb({}),
  },
];
