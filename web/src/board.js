// The payload the allocation board runs on. Ported from board_data() in
// cicero_hours/board.py; the interactive board itself (drag-and-drop, chips,
// undo, plan file, chart) lands in Phase 5. This module is just the pure
// function that turns a Group into the JSON the board consumes, so the
// cross-check test can compare its output to expected.json.

import { UNALLOCATED_PERSON } from './rules.js';
import { yearFraction } from './model.js';

// Same palette as figures.py, so the two builds colour identical projects
// identically. Ochre is reserved for unallocated hours (a hatched block, not
// a project), so leave that colour out of the project sort here.
const PROJECT_PALETTE = [
  '#1F5F6B', '#C98F2B', '#6B4A72', '#4C7A3F', '#B4552F',
  '#3D6BA5', '#8C7B4B', '#A0466B', '#2E8C8C', '#7A6FA8',
  '#5E7B8B', '#9C6B3F', '#4F8F6B', '#B07F9B', '#365E4A',
];

// Stable colour per project, ordered by total budgeted hours descending. Same
// tie-break as pandas' sort_values ascending=False on the summed hours: it is
// not stable in the general case, but our sums are unique in practice, and
// the order is the same as the Python's on the fixture.
export function projectColours(group) {
  const totals = new Map();
  for (const r of group.budget) {
    if (r.category !== 'Project') continue;
    totals.set(r.project, (totals.get(r.project) || 0) + r.hours);
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const out = {};
  ordered.forEach(([p], i) => { out[p] = PROJECT_PALETTE[i % PROJECT_PALETTE.length]; });
  return out;
}

export function boardData(group, planFile = 'allocation_plan.txt') {
  const projectRows = group.budget.filter(r => r.category === 'Project' && r.hours > 0);

  // Several budget lines can share (person, project, year); merge before we
  // hand a block to the user, then let them split by hand rather than showing
  // four cards for one grant.
  const merged = new Map();
  for (const r of projectRows) {
    const k = JSON.stringify([r.person, r.project, r.year]);
    const cur = merged.get(k);
    if (cur) {
      cur.hours += r.hours;
      if (cur.pm === null && r.pm !== null) cur.pm = r.pm;
    } else {
      merged.set(k, {
        person: r.person, project: r.project, year: r.year,
        hours: r.hours, pm: r.pm, unallocated: r.unallocated,
      });
    }
  }
  const groups = [...merged.values()].sort(cmpBy(['person', 'project', 'year']));

  const blocks = groups.map(g => {
    const owner = g.unallocated ? null : String(g.person);
    return {
      id: `${owner ?? '~pool'}|${g.project}|${g.year}`,
      project: String(g.project),
      year: g.year,
      hours: round1(g.hours),
      pm: g.pm === null ? null : String(g.pm),
      owner,
      origin: owner,
      oyear: g.year,
    };
  });

  // Which years each project actually has budget in, so the interactive board
  // can flag a deferral into a year the project does not run.
  const projectYearSets = new Map();
  for (const r of projectRows) {
    let ys = projectYearSets.get(r.project);
    if (!ys) { ys = new Set(); projectYearSets.set(r.project, ys); }
    ys.add(r.year);
  }
  const projectYears = {};
  for (const p of [...projectYearSets.keys()].sort()) {
    projectYears[p] = [...projectYearSets.get(p)].sort((a, b) => a - b);
  }

  // What each named person was budgeted before any drag on the board.
  const baseline = {};
  for (const b of blocks) {
    if (b.origin === null) continue;
    const per = baseline[b.origin] || (baseline[b.origin] = {});
    per[b.year] = round1((per[b.year] || 0) + b.hours);
  }

  // Each person's own billing rate, annualised from what they have booked. Too
  // early in the year the ratio is noise, so guard.
  const year = group.reporting_year;
  const frac = yearFraction(group.assumptions, year);
  const rate = {};
  if (frac > 0.15) {
    for (const row of group.person_summary(year)) {
      if (row.Project > 0) rate[row.person] = roundTo(row.Project / frac, -1);
    }
  }

  const unassignedByYear = new Map();
  for (const b of blocks) {
    if (b.origin === null) {
      unassignedByYear.set(b.year, (unassignedByYear.get(b.year) || 0) + b.hours);
    }
  }
  let defaultYear = group.reporting_year;
  if (unassignedByYear.size) {
    let best = -Infinity;
    for (const [y, h] of unassignedByYear) if (h > best) { best = h; defaultYear = y; }
  }

  const totalHours = blocks.reduce((s, b) => s + b.hours, 0);
  const fingerprint = `${blocks.length} blocks / ${enThousands(Math.round(totalHours))} h`;

  const secondsFull = group.second_groups();
  const seconds = {};
  for (const [p, g] of Object.entries(secondsFull)) {
    const parts = g.split(' / ');
    seconds[p] = parts[parts.length - 1];
  }

  return {
    years: group.years.map(y => Number(y)),
    default_year: Number(defaultYear),
    people: group.people,
    baseline,
    rate,
    second_groups: seconds,
    blocks,
    project_years: projectYears,
    project_colour: projectColours(group),
    billable_hours: group.assumptions.billable_hours,
    unallocated_person: UNALLOCATED_PERSON,
    fingerprint,
    plan_file: planFile,
  };
}

// ---------------------------------------------------------- small helpers

function round1(x) { return Math.round(x * 10) / 10; }

// Python's round(x, -1) rounds to the nearest 10 using banker's rounding.
// The values here (annualised hours) are never on the .5 boundary between
// tens in practice, so half-away-from-zero and banker's agree on this data.
function roundTo(x, ndigits) {
  const f = Math.pow(10, -ndigits);
  return Math.round(x / f) * f;
}

function enThousands(n) {
  return new Intl.NumberFormat('en-US', { useGrouping: true }).format(n);
}

function cmpBy(keys) {
  return (a, b) => {
    for (const k of keys) {
      const x = a[k], y = b[k];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  };
}
