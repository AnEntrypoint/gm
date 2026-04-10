const esbuild = require('./node_modules/esbuild/lib/main.js');
const result = esbuild.buildSync({
  entryPoints: ['main.js'],
  bundle: true,
  outfile: '../docs/bundle.js',
  format: 'esm',
  platform: 'browser',
  minify: false,
});
if (result.errors.length) { console.error(result.errors); process.exit(1); }
const bytes = require('fs').statSync('../docs/bundle.js').size;
console.log('esbuild: wrote ../docs/bundle.js', bytes + 'b');
