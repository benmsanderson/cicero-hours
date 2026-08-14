// The payload the allocation board runs on, plus the HTML skeleton the
// runtime binds to. Ported from board_data() and board_html() in
// cicero_hours/board.py. The interactive runtime itself lives in
// spec/board.js, shared verbatim with the Python build; importing it here
// runs its top-level assignment and registers window.__cicero_boardInit.

import { UNALLOCATED_PERSON } from './rules.js';
import { yearFraction } from './model.js';
import { projectColours } from './palette.js';

// Side-effect import: registers window.__cicero_boardInit(DATA).
import '../../spec/board.js';

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

// ------------------------------------------------ HTML skeleton and mount

// Port of board_html() in cicero_hours/board.py, without the trailing
// window.BOARD_DATA <script>: the browser build sets that on the window
// directly. Keep the two in sync; the id and class names here are the seams
// spec/board.js binds to.
export function boardHtml(data) {
  const guide = enThousands(data.billable_hours);
  const years = data.years.map(y =>
    `<button id="year-${y}" aria-pressed="false">${y}<span class="badge"></span></button>`,
  ).join('');
  const chartYears = data.years.map(y => `<option value="${y}">${y}</option>`).join('');
  return `
<div class="board">
  <p class="hint">Every budgeted hour is a block here, including hours that already have a
  name against them. Drag one onto another researcher, or click it and then click a card;
  split a block first if only part of it should move. The × sends a block back to
  unassigned. <b>Defer</b> pushes a block into a later year of the same project, which
  changes the grant's spending profile and so needs NFR approval; those moves are listed
  separately at the bottom, ready to go in the request. Hours are never pulled earlier
  than they were budgeted.
  The ${guide} h line is a guide rather than a limit, so each card also shows that
  person's own current billing rate, and the thin vertical mark is where they started.
  Nothing is written back to the budget system, and the plan is gone on a refresh unless
  you put it in a file: <b>Save plan file</b> names one and keeps it up to date as you
  work, and <b>Open plan file</b> picks a reallocation up in a later session.</p>
  <div class="board-controls">
    <div class="seg" role="group" aria-label="Budget year">${years}</div>
    <span class="newperson">
      <input id="board-newname" placeholder="New researcher" aria-label="Name for a new card">
      <button class="btn" id="board-add">Add card</button>
    </span>
    <span class="spacer"></span>
    <button class="btn" id="board-undo">Undo</button>
    <button class="btn" id="board-show">Show plan as text</button>
    <button class="btn" id="board-csv">Download CSV</button>
    <button class="btn" id="board-reset">Reset</button>
  </div>
  <div class="filerow">
    <button class="btn" id="board-save">Save plan file</button>
    <button class="btn" id="board-open">Open plan file</button>
    <input type="file" id="board-plan-input" accept=".txt,text/plain" style="display:none"
           aria-label="A plan file saved earlier">
    <span class="status" id="board-save-status"></span>
    <span class="warn" id="board-save-warn"></span>
  </div>
  <div class="board-chart" id="board-chart">
    <div class="head">
      <h3>Proposed allocation</h3>
      <label for="chart-year">Year</label>
      <select id="chart-year">
        <option value="follow" selected>Board year</option>
        ${chartYears}
        <option value="all">All years</option>
      </select>
      <label for="chart-view">Show</label>
      <select id="chart-view">
        <option value="projects" selected>Stacked by project</option>
        <option value="baseline">Proposed against budget</option>
      </select>
      <span class="spacer"></span>
      <button class="btn" id="chart-toggle">Hide chart</button>
    </div>
    <div class="plot" id="board-chart-plot"></div>
  </div>
  <div class="board-grid">
    <div class="pool" id="pool">
      <h3>Unassigned</h3>
      <div class="sub" id="pool-sub"></div>
      <div class="chips" id="pool-chips"></div>
    </div>
    <div class="people" id="people-grid"></div>
  </div>
  <div class="board-total" id="board-total"></div>
  <div class="changes" id="board-changes"></div>
  <div class="defers" id="board-defers" style="display:none"></div>
  <textarea id="plan-text" readonly aria-label="The plan as tab-separated text"></textarea>
</div>
`;
}

// Fill a panel with the board skeleton and hand its payload to the runtime.
// Called once per new file drop; as-of changes deliberately do not re-mount,
// so a proposal-in-progress survives the user nudging the date.
export function mountBoard(panel, data) {
  panel.innerHTML = boardHtml(data);
  window.BOARD_DATA = data;
  if (typeof window.__cicero_boardInit === 'function') {
    window.__cicero_boardInit(data);
  }
}
