// Exercises the browser build's shell in jsdom: the empty state, the file
// pick, the tidy pipeline behind it, the KPI numbers, the tab machinery,
// and the editable as-of.
//
//   node web/build.js --out=/tmp/shell.html
//   python3 -c "from tests.synthetic import write_export; from pathlib import Path; write_export(Path('/tmp/cicero_synth.csv'))"
//   node tests/shell_check.js /tmp/shell.html /tmp/cicero_synth.csv

const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const [, , htmlPath, csvPath] = process.argv;
if (!htmlPath || !csvPath) {
  console.error('usage: node tests/shell_check.js <shell.html> <synthetic.csv>');
  process.exit(2);
}

// Strip the inlined Plotly bundle: over a megabyte of canvas code jsdom
// cannot run, and the shell exercises the layout not the pixels.
const html = fs.readFileSync(htmlPath, 'utf8')
  .replace(/<script>[\s\S]*?Plotly[\s\S]*?<\/script>/, '<script></script>');
const csv = fs.readFileSync(csvPath, 'utf8');

const vc = new VirtualConsole();
vc.sendTo(console);
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  // jsdom 26 does not expose TextDecoder on window; real browsers do. Polyfill
  // it so the shell's UTF-8 decode path runs the same code it will in Chrome.
  beforeParse(window) {
    if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  },
});
const { window } = dom;
const doc = window.document;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  ok   ' + name);
  else { console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); failures++; }
}

// -------------------------------------------------------------- empty state

(async function main() {
  await tick();
  check('empty state renders', !!doc.getElementById('empty'));
  check('drop zone is present', !!doc.getElementById('drop'));
  check('file input is present', !!doc.getElementById('file'));
  check('empty state explains where the file comes from',
    /Timer budsjettert/.test(doc.getElementById('empty').textContent));
  check('empty state promises nothing leaves the page',
    /leaves this page/i.test(doc.getElementById('empty').textContent));

  // ---------------------------------------------------------- feed the file

  const file = new window.File([csv], 'export.csv', { type: 'text/csv' });
  const input = doc.getElementById('file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));

  // The shell decodes and parses asynchronously; wait for the KPI box to appear.
  await waitFor(() => doc.getElementById('kpis'), 2000);

  // -------------------------------------------------------- shell rendered

  const nav = doc.querySelector('nav');
  check('tab nav renders', !!nav);
  check('one tab per view', nav && nav.querySelectorAll('button').length === 6);

  const panels = Array.from(doc.querySelectorAll('.panel'));
  check('one panel per tab', panels.length === 6);
  const expectedTabs = ['overview', 'people', 'projects', 'deepdive', 'matrix', 'board'];
  const ids = panels.map(p => p.id);
  check('panel ids in Python order', JSON.stringify(ids) === JSON.stringify(expectedTabs),
    `got ${JSON.stringify(ids)}`);
  const active = panels.filter(p => p.getAttribute('data-active') === 'true');
  check('overview is the initially active panel',
    active.length === 1 && active[0].id === 'overview');

  // ------------------------------------------------------------------ KPIs

  // Expected against the synthetic export at as_of = today (whatever today is
  // the test runs). Values depending on the as-of are re-checked below with a
  // pinned date; the ones we can pin without the date are hard-asserted here.
  const kpis = doc.querySelectorAll('#kpis .kpi');
  check('five KPI cards', kpis.length === 5);
  const value = i => kpis[i].querySelector('.value').textContent.trim();
  const label = i => kpis[i].querySelector('.label').textContent.trim();

  check('KPI 0 headcount value',   value(0) === '2');
  check('KPI 0 headcount label',   /people with hours/.test(label(0)));
  check('KPI 1 budget total',      value(1) === '1,300');
  check('KPI 1 budget label',      /hours budgeted for 2026/.test(label(1)));
  check('KPI 2 over-standard value', value(2) === '0');
  check('KPI 2 over-standard label', /over the 1,250 h standard in 2026/.test(label(2)));
  check('KPI 4 unallocated share', value(4) === '60%');
  check('KPI 4 unallocated label', /of 2027\+ budget unallocated/.test(label(4)));

  // ------------------------------------------------------ tabs are wired

  const clickTab = id => {
    const btn = Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.target === id);
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  clickTab('board');
  const boardOnly = Array.from(doc.querySelectorAll('.panel'))
    .filter(p => p.getAttribute('data-active') === 'true');
  check('clicking a tab switches which panel shows',
    boardOnly.length === 1 && boardOnly[0].id === 'board');
  const selected = doc.querySelector('nav button[aria-selected="true"]');
  check('the clicked tab is aria-selected', selected && selected.dataset.target === 'board');

  // ---------------------------------------------------- editable as-of

  const asOf = doc.getElementById('as-of');
  check('as-of control is present', !!asOf);
  const startedAt = doc.querySelectorAll('#kpis .kpi')[3].querySelector('.value').textContent.trim();
  asOf.value = '2026-01-08';  // early in the year: project_share pinned by that
  asOf.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const after = doc.querySelectorAll('#kpis .kpi')[3].querySelector('.value').textContent.trim();
  // project_share does not depend on as_of, so KPI 3 stays constant; what
  // moves is the notes' "X% of Y's working days have passed" line.
  check('changing as-of re-renders without losing panels', doc.querySelectorAll('.panel').length === 6);
  check('changing as-of re-renders the notes',
    /(0|1|2|3|4|5|6|7|8)% of 2026/.test(doc.querySelector('.notes-block').textContent),
    `notes: ${doc.querySelector('.notes-block').textContent.slice(0, 200)}`);
  check('project_share is not moved by the as-of', after === startedAt);

  // ---------------------------------------------------------- report

  if (failures) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall shell checks passed');
})().catch(err => { console.error(err); process.exit(1); });

// ---------------------------------------------------------- helpers

function tick() { return new Promise(r => setTimeout(r, 0)); }

async function waitFor(fn, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms waiting for condition`);
}
