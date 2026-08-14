// Bundle the browser build into one self-contained HTML file.
//
// esbuild inlines every import, the spec/*.css files are pulled in as-is,
// and the whole page is written to dist/hours_dashboard.html. Nothing
// external: the file opens by double-click, from a Downloads folder, with
// no network.
//
//   node web/build.js
//   node web/build.js --pretty     # skip the minify pass, for local reading
//   node web/build.js --out=path.html

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const outArg = args.find(a => a.startsWith('--out='));
  const outPath = outArg
    ? path.resolve(outArg.slice('--out='.length))
    : path.join(root, 'dist', 'hours_dashboard.html');

  const jsResult = await esbuild.build({
    entryPoints: [path.join(here, 'src', 'app.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: !pretty,
    // JSON imports (spec/rules.json) are inlined into the bundle.
    loader: { '.json': 'json' },
    logLevel: 'warning',
  });
  const js = jsResult.outputFiles[0].text;

  const shellCss = await readFile(path.join(root, 'spec', 'shell.css'), 'utf8');
  const boardCss = await readFile(path.join(root, 'spec', 'board.css'), 'utf8');
  const dropCss = await readFile(path.join(here, 'src', 'drop.css'), 'utf8');

  // Plotly's cartesian bundle: only bar/scatter/heatmap etc, ~1.4 MB minified,
  // vs 4.9 MB for the full one. That is the difference between an emailable
  // dashboard and one that bounces off attachment size limits. Inlined so
  // the page opens offline with no network at all.
  const plotly = await readFile(
    path.join(root, 'node_modules', 'plotly.js-cartesian-dist-min', 'plotly-cartesian.min.js'),
    'utf8',
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CICERO group hours</title>
<style>${shellCss}${boardCss}${dropCss}</style>
</head>
<body>
<div class="wrap" id="wrap"></div>
<script>${plotly}</script>
<script>${js}</script>
</body>
</html>`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(1)} KiB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
