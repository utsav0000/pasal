// Bundles the React frontend with esbuild: code-split ES modules, hashed filenames, gzip, manifest.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'build');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const options = {
  entryPoints: { app: path.join(ROOT, 'web/src/main.jsx') },
  bundle: true, splitting: true, format: 'esm', outdir: OUT, metafile: true,
  entryNames: dev ? '[name]' : '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
  jsx: 'automatic', loader: { '.js': 'jsx' }, target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
  minify: !dev, sourcemap: dev ? 'inline' : 'linked', legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  external: ['/fonts/*'],
  logLevel: 'info',
};

function writeManifest(meta) {
  const outs = Object.entries(meta.outputs);
  const js = outs.find(([f, o]) => o.entryPoint && f.endsWith('.js'))?.[0];
  const css = outs.find(([f]) => f.endsWith('.css') && path.basename(f).startsWith('app'))?.[0];
  const rel = (f) => '/' + path.relative(path.join(ROOT, 'public'), path.resolve(ROOT, f)).split(path.sep).join('/');
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ js: rel(js), css: rel(css) }, null, 2));
  if (!dev) for (const [f] of outs) if (/\.(js|css)$/.test(f)) fs.writeFileSync(path.resolve(ROOT, f) + '.gz', zlib.gzipSync(fs.readFileSync(path.resolve(ROOT, f)), { level: 9 }));
}

fs.rmSync(OUT, { recursive: true, force: true });
if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [{ name: 'manifest', setup(b) { b.onEnd((r) => r.metafile && writeManifest(r.metafile)); } }] });
  await ctx.watch();
  console.log('Watching web/src for changes…');
} else {
  const r = await esbuild.build(options);
  writeManifest(r.metafile);
  const sizes = Object.entries(r.metafile.outputs).filter(([f]) => /\.(js|css)$/.test(f)).map(([f, o]) => [path.basename(f), (o.bytes / 1024).toFixed(1) + ' kB', (zlib.gzipSync(fs.readFileSync(path.resolve(ROOT, f))).length / 1024).toFixed(1) + ' kB gz']);
  console.table(sizes);
}
