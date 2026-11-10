import { resolvePath } from './project.mjs';

const decoder = new TextDecoder();

export function createVerbs(project) {
  const failure = (error) => ({ ok: false, error });
  const pathOf = (args) => (typeof args.path === 'string' ? resolvePath(args.path) : null);
  const verbs = {
    async stat_file(args) {
      const path = pathOf(args);
      const info = path === null ? null : project.stat(path);
      if (info === null) return failure('ENOENT: no such file or directory, stat ' + String(args.path));
      return { ok: true, output: JSON.stringify({ type: info.dir ? 'dir' : 'file', size: info.size, mtime: new Date(info.mtimeMs).toISOString() }) };
    },
    async read_file(args) {
      const path = pathOf(args);
      const info = path === null ? null : project.stat(path);
      if (info === null || info.dir) return failure('ENOENT: no such file, open ' + String(args.path));
      return { ok: true, output: decoder.decode(project.bytes(path)) };
    },
    async list_dir(args) {
      const path = typeof args.path === 'string' ? resolvePath(args.path) : '/';
      const names = project.names(path);
      if (names === null) return failure('ENOENT: no such directory, scandir ' + String(args.path));
      const entries = names.map((name) => (project.stat(resolvePath(path + '/' + name))?.dir ? name + '/' : name)).sort();
      return { ok: true, output: entries.map((entry) => entry + '\n').join('') };
    },
  };
  return {
    async call(name, args) {
      if (!Object.hasOwn(verbs, name)) return failure('unknown verb ' + name);
      try {
        return await verbs[name](args);
      } catch (error) {
        return failure(error.message);
      }
    },
  };
}
