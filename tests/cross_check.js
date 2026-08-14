// Cross-check the JavaScript loader/model against the Python. Both sides run
// on the same synthetic export and produce the same aggregates; the browser
// build's numbers therefore land in the same place as the CLI's, or this
// test fails and says exactly where they parted ways.
//
//   python3 -c "from tests.synthetic import write_export; from pathlib import Path; write_export(Path('/tmp/synth.csv'))"
//   node tests/cross_check.js /tmp/synth.csv
//
// npm run test:cross wires both steps together.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const EXPECTED_PATH = path.join(REPO_ROOT, 'spec', 'expected.json');
// The pin test in Python hard-codes this too; keep both in step.
const AS_OF = '2026-07-02';

(async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('usage: node tests/cross_check.js <synthetic.csv>\n' +
      "first: python3 -c \"from tests.synthetic import write_export; from pathlib import Path; write_export(Path('/tmp/synth.csv'))\"");
    process.exit(2);
  }

  const { loadExport } = await import('../web/src/loader.js');
  const { buildGroup, yearFraction } = await import('../web/src/model.js');
  const { boardData } = await import('../web/src/board.js');
  const { BILLABLE_HOURS_DEFAULT } = await import('../web/src/rules.js');

  const text = fs.readFileSync(csvPath, 'utf8');
  const raw = loadExport(text);
  const group = buildGroup(raw, {
    as_of: AS_OF,
    billable_hours: BILLABLE_HOURS_DEFAULT,
  });

  const actual = snapshot(group, yearFraction, boardData);
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));

  const diffs = [];
  compare(expected, actual, '', diffs);

  if (!diffs.length) {
    console.log(`ok  cross-check: JS matches spec/expected.json across ` +
      `${Object.keys(expected).length} top-level keys`);
    process.exit(0);
  }
  console.error(`FAIL cross-check: ${diffs.length} difference(s) between JS and spec/expected.json`);
  const show = diffs.slice(0, 30);
  for (const d of show) console.error('  ' + d);
  if (diffs.length > show.length) {
    console.error(`  ... and ${diffs.length - show.length} more`);
  }
  process.exit(1);
})().catch(err => { console.error(err); process.exit(1); });

// ---------------- snapshot in the same shape as expected.json ----------------

const PRECISION = 6;
function round6(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  return Math.round(n * 1e6) / 1e6;
}
// Recursively round numeric leaves to match what the Python emitter wrote.
function roundLeaves(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number') return round6(v);
  if (Array.isArray(v)) return v.map(roundLeaves);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = roundLeaves(x);
    return out;
  }
  return v;
}

function snapshot(g, yearFraction, boardData) {
  const years = g.years;
  const personSummary = {};
  for (const y of years) personSummary[String(y)] = g.person_summary(y);
  const nonproject = {};
  for (const y of years) nonproject[String(y)] = g.nonproject_by_person_task(y);
  const yearFractions = {};
  for (const y of years) yearFractions[String(y)] = yearFraction(g.assumptions, y);

  return roundLeaves({
    as_of: AS_OF,
    billable_hours: g.assumptions.billable_hours,
    group_tag: g.group_tag,
    excluded: g.excluded,
    years,
    people: g.people,
    reporting_year: g.reporting_year,
    second_groups: g.second_groups(),
    year_fractions: yearFractions,
    budget: g.budget,
    registered: g.registered,
    person_summary: personSummary,
    project_summary: g.project_summary(),
    nonproject_by_person_task: nonproject,
    board: boardData(g),
  });
}

// ------------------------------ deep compare ---------------------------------
//
// Tolerance is per-number floating-point epsilon; anything larger than 1e-6
// means the models actually disagree. Order matters for arrays: the pin test
// on the Python side treats them positionally too.

const EPS_ABS = 1e-6;
const EPS_REL = 1e-9;

function compare(a, b, at, out) {
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a !== b) out.push(`${at || '<root>'}: expected ${json(a)}, got ${json(b)}`);
    return;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (Math.abs(x - y) > EPS_ABS + EPS_REL * Math.max(Math.abs(x), Math.abs(y))) {
        out.push(`${at}: expected ${x}, got ${y} (delta ${(y - x).toExponential(3)})`);
      }
    } else if (x !== y) {
      out.push(`${at}: expected ${json(a)}, got ${json(b)}`);
    }
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${at}: expected ${typeName(a)}, got ${typeName(b)}`); return;
    }
    if (a.length !== b.length) {
      out.push(`${at}: expected length ${a.length}, got ${b.length}`);
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) compare(a[i], b[i], `${at}[${i}]`, out);
    return;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = new Set(Object.keys(a)), kb = new Set(Object.keys(b));
    for (const k of ka) if (!kb.has(k)) out.push(`${at}.${k}: missing in JS output`);
    for (const k of kb) if (!ka.has(k)) out.push(`${at}.${k}: unexpected in JS output`);
    for (const k of ka) if (kb.has(k)) compare(a[k], b[k], `${at}.${k}`, out);
    return;
  }
  if (a !== b) out.push(`${at}: expected ${json(a)}, got ${json(b)}`);
}

function json(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function typeName(v) { return Array.isArray(v) ? 'array' : typeof v; }
