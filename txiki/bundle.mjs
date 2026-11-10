import { parse } from 'acorn';

const EXTENSIONS = ['', '.mjs', '.js', '/index.mjs', '/index.js'];

function normalize(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

function exportName(node) {
  return node.type === 'Identifier' ? node.name : node.value;
}

function identifierOf(pattern) {
  if (pattern.type !== 'Identifier') throw new Error('an exported destructuring pattern is not bundled');
  return pattern.name;
}

function declaredNames(declaration) {
  if (declaration.type === 'VariableDeclaration') return declaration.declarations.map((d) => identifierOf(d.id));
  return [declaration.id.name];
}

function importLine(specifier, variable) {
  const local = specifier.local.name;
  if (specifier.type === 'ImportDefaultSpecifier') return 'const ' + local + ' = ' + variable + '.default;';
  if (specifier.type === 'ImportNamespaceSpecifier') return 'const ' + local + ' = ' + variable + ';';
  return 'const ' + local + ' = ' + variable + '[' + JSON.stringify(exportName(specifier.imported)) + '];';
}

function resolveSpecifier(specifier, referrer, read) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error('import ' + specifier + ' from ' + referrer + ' is not a project module');
  const base = normalize(referrer.slice(0, referrer.lastIndexOf('/')) + '/' + specifier);
  for (const suffix of EXTENSIONS) {
    const path = base + suffix;
    const text = read(path);
    if (text !== null) return { path, text };
  }
  throw new Error('cannot find ' + specifier + ' imported from ' + referrer);
}

function transform(path, text, load) {
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const edits = [];
  const exported = [];
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const dep = load(node.source.value, path);
      edits.push([node.start, node.end, node.specifiers.map((s) => importLine(s, dep.variable)).join(' ')]);
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      edits.push([node.start, node.declaration.start, '']);
      for (const name of declaredNames(node.declaration)) exported.push(JSON.stringify(name) + ': ' + name);
    } else if (node.type === 'ExportNamedDeclaration') {
      const dep = node.source ? load(node.source.value, path) : null;
      for (const s of node.specifiers) {
        const local = exportName(s.local);
        const value = dep ? dep.variable + '[' + JSON.stringify(local) + ']' : local;
        exported.push(JSON.stringify(exportName(s.exported)) + ': ' + value);
      }
      edits.push([node.start, node.end, '']);
    } else if (node.type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration;
      if ((declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') && declaration.id) {
        edits.push([node.start, declaration.start, '']);
        exported.push('"default": ' + declaration.id.name);
      } else {
        edits.push([node.start, declaration.start, 'const __default = ']);
        exported.push('"default": __default');
      }
    } else if (node.type === 'ExportAllDeclaration') {
      const dep = load(node.source.value, path);
      edits.push([node.start, node.end, '']);
      exported.push('...((({ default: skipped, ...rest }) => rest)(' + dep.variable + '))');
    }
  }
  let body = text;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) body = body.slice(0, start) + replacement + body.slice(end);
  return { body, exported: '{ ' + exported.join(', ') + ' }' };
}

export function bundle(entry, read) {
  const state = { modules: new Map(), loading: new Set(), out: [], counter: 0 };
  const load = (specifier, referrer) => {
    const found = resolveSpecifier(specifier, referrer, read);
    if (state.modules.has(found.path)) return state.modules.get(found.path);
    if (state.loading.has(found.path)) throw new Error('import cycle through ' + found.path);
    state.loading.add(found.path);
    const variable = '__m' + state.counter;
    state.counter += 1;
    const { body, exported } = transform(found.path, found.text, load);
    state.loading.delete(found.path);
    state.out.push('const ' + variable + ' = await (async () => {\n' + body + '\nreturn ' + exported + ';\n})();');
    const module = { variable };
    state.modules.set(found.path, module);
    return module;
  };
  const text = read(entry);
  if (text === null) throw new Error('entry ' + entry + ' not found');
  const { body } = transform(entry, text, load);
  return state.out.concat([body]).join('\n');
}
