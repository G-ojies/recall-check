/**
 * Bundles the serverless entry into dist/recall-check.mjs. The recall data and the pages in public/ are built
 * in, so the function needs no file beside it.
 */
import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const pages = {};
for (const name of await readdir('public')) {
  const type = TYPES[extname(name)];
  if (type) pages[`/${name}`] = { type, body: (await readFile(join('public', name))).toString('base64') };
}

await build({
  entryPoints: ['src/vercel.ts'], outfile: 'dist/recall-check.mjs',
  bundle: true, platform: 'node', target: 'node20', format: 'esm', logLevel: 'warning',
  loader: { '.gz': 'binary' },
  // express and its dependencies are CommonJS and call require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'pages',
    setup(b) {
      b.onResolve({ filter: /^virtual:pages$/ }, () => ({ path: 'pages', namespace: 'pages' }));
      b.onLoad({ filter: /.*/, namespace: 'pages' }, () => ({ contents: JSON.stringify(pages), loader: 'json' }));
    },
  }],
});
console.log(`built dist/recall-check.mjs with ${Object.keys(pages).length} pages`);
