export function resolvePath(text) {
  const parts = [];
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function filesProject(files) {
  const encoder = new TextEncoder();
  const dirs = new Set(['/']);
  for (const path of Object.keys(files)) {
    let parent = path;
    while (parent.lastIndexOf('/') > 0) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      dirs.add(parent);
    }
  }
  return {
    stat(path) {
      if (dirs.has(path)) return { dir: true, size: 0, mtimeMs: 0 };
      const text = Object.hasOwn(files, path) ? files[path] : undefined;
      if (text === undefined) return null;
      return { dir: false, size: encoder.encode(text).length, mtimeMs: 0 };
    },
    bytes(path) {
      return encoder.encode(files[path]);
    },
    names(path) {
      if (!dirs.has(path)) return null;
      const prefix = path === '/' ? '/' : path + '/';
      const names = new Set();
      for (const file of Object.keys(files)) if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0]);
      for (const dir of dirs) if (dir !== path && dir.startsWith(prefix)) names.add(dir.slice(prefix.length).split('/')[0]);
      return [...names];
    },
  };
}
