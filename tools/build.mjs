#!/usr/bin/env node
// Builds the loadable extension into dist/: bundles each extension entry
// point (with its SDK imports inlined — MAIN-world content scripts can't
// load ESM on strict-CSP pages) and copies the static assets.
//   npm run build
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [
    join(ROOT, 'extension/background.js'),
    join(ROOT, 'extension/content.js'),
    join(ROOT, 'extension/page-agent.js'),
    join(ROOT, 'extension/popup.js')
  ],
  bundle: true,
  format: 'iife',
  target: ['chrome111'],
  outdir: DIST,
  logLevel: 'info'
});

for (const asset of ['extension/manifest.json', 'extension/popup.html', 'extension/popup.css']) {
  cpSync(join(ROOT, asset), join(DIST, asset.split('/').pop()));
}
cpSync(join(ROOT, 'icons'), join(DIST, 'icons'), { recursive: true });

console.log(`built extension → ${DIST}`);
