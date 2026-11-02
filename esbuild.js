const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

if (watch) {
  esbuild.context(options).then(ctx => ctx.watch()).catch(() => process.exit(1));
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
