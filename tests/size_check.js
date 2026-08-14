// Guard the built dashboard's size, since the whole point of the browser
// build is that it fits in an email attachment. Fails if the file breaks
// the budget below, so nobody accidentally reintroduces the full plotly
// bundle or forgets the minifier.

const fs = require('node:fs');
const path = require('node:path');

const BUDGET_MB = 2.5;

const target = process.argv[2] ||
  path.join(__dirname, '..', 'dist', 'hours_dashboard.html');
const bytes = fs.statSync(target).size;
const mb = bytes / (1024 * 1024);

if (mb > BUDGET_MB) {
  console.error(
    `FAIL ${target} is ${mb.toFixed(2)} MiB; budget is ${BUDGET_MB} MiB. ` +
    `Something big landed in the bundle — check for the full plotly, an ` +
    `unminified build, or a large asset.`
  );
  process.exit(1);
}
console.log(`ok  ${path.basename(target)} is ${mb.toFixed(2)} MiB (budget ${BUDGET_MB} MiB)`);
