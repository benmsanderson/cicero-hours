// Tidy the raw export tables and roll them up into everything the dashboard
// needs. Mirror of cicero_hours/model.py; the cross-check test compares this
// module's output against spec/expected.json row by row, so keep the shape
// and the sort orders here in step with what the Python does.

import { requireTable } from './loader.js';
import {
  ABSENCE_JOBS,
  BILLABLE_HOURS_DEFAULT,
  CATEGORY_ORDER,
  EXTERNAL_PROJECT_LABEL,
  INTERNAL_JOBS,
  INTERNAL_PROJECT_ACTIVITY,
  INTERNAL_PROJECT_LABEL,
  PROJECT_JOB_FLOOR,
  TYPE_ORDER,
  UNALLOCATED_PERSON,
} from './rules.js';

// ---------------------------------------------------------------- assumptions

export function makeAssumptions({
  as_of,
  billable_hours = BILLABLE_HOURS_DEFAULT,
  holidays = [],
} = {}) {
  return { as_of, billable_hours, holidays: holidays.slice() };
}

export function yearFraction(a, year) {
  const start = utcDate(year, 1, 1);
  const end = utcDate(year + 1, 1, 1);
  const asOf = a.as_of instanceof Date ? a.as_of : parseISO(a.as_of);
  if (asOf <= start) return 0.0;
  if (asOf >= end) return 1.0;
  const total = busdayCount(start, end, a.holidays);
  const done = busdayCount(start, asOf, a.holidays);
  return total ? done / total : 0.0;
}

// Weekdays in [start, end) that are not in the holiday list. Mirror of
// numpy.busday_count so year_fraction lines up to the day with the Python.
function busdayCount(start, end, holidays) {
  const holSet = new Set((holidays || []).map(h => (h instanceof Date ? h : parseISO(h)).toISOString().slice(0, 10)));
  let n = 0;
  const d = new Date(start.getTime());
  while (d < end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holSet.has(d.toISOString().slice(0, 10))) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return utcDate(y, m, d);
}
function utcDate(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }

// ---------------------------------------------------------- cell helpers

// A blank string, undefined, or null becomes null. Otherwise trim.
function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// pandas' pd.to_numeric with errors="coerce": unparseable becomes null. An
// empty string is null; Number("") is 0 in JS but the Python treats it as NaN.
function toNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'nan') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

function categoryOf(jobNo) {
  if (jobNo === null || jobNo === undefined || Number.isNaN(jobNo)) return 'Other';
  const j = Math.trunc(jobNo);
  if (ABSENCE_JOBS.has(j)) return 'Absence';
  if (INTERNAL_JOBS.has(j)) return 'Internal';
  if (j >= PROJECT_JOB_FLOOR) return 'Project';
  return 'Other';
}

// '31679 - FUTURA' becomes 'FUTURA'. Falls back to the raw string.
function projectLabel(prosjekt) {
  if (typeof prosjekt !== 'string') return 'Unknown';
  const at = prosjekt.indexOf(' - ');
  return at >= 0 ? prosjekt.slice(at + 3).trim() : prosjekt.trim();
}

// ------------------------------------------------------------------- tidy

export function tidyBudget(raw) {
  const table = requireTable(raw, 'budget');
  const out = [];
  for (const row of table.rows) {
    const year = toInt(row['Budget Type']);
    if (year === null) continue;  // pandas' dropna(subset=['year'])
    const person = cleanStr(row['Medarbeider']);
    const projectFull = cleanStr(row['Prosjekt']);
    const projectNo = toNum(row['Job No.']);
    out.push({
      person,
      project_no: projectNo,
      project_full: projectFull,
      task: cleanStr(row['Oppgave']),
      year,
      hours: toNum(row['Quantity - Hours']) ?? 0,
      value: toNum(row['Total Billing Price - Company']),
      pm: cleanStr(row['Project Manager Name']),
      department: cleanStr(row['Avdeling']),
      group_tag: cleanStr(row['Specification5Description']),
      second_group: cleanStr(row['Specification6Description']),
      project: projectFull === null ? 'Unknown' : projectLabel(projectFull),
      category: categoryOf(projectNo),
      unallocated: person === UNALLOCATED_PERSON,
    });
  }
  return out;
}

export function tidyRegistered(raw) {
  const table = requireTable(raw, 'registered');
  const rows = [];
  for (const row of table.rows) {
    const year = toInt(row['Year str']);
    if (year === null) continue;
    const projectFull = cleanStr(row['Prosjekt']);
    const projectNo = toNum(row['Job No.']);
    rows.push({
      person: cleanStr(row['Medarbeider']),
      project_no: projectNo,
      project_full: projectFull,
      task: cleanStr(row['Oppgave']),
      year,
      hours: toNum(row['Hours - Reg.']) ?? 0,
      value: toNum(row['Billing Price Reg. - Company']),
      activity: toInt(row['Activity No.']),
      department: cleanStr(row['Avdeling']),
      group_tag: cleanStr(row['Employee Specification 5 Descr.']),
      project: projectFull === null ? 'Unknown' : projectLabel(projectFull),
      category: categoryOf(projectNo),
    });
  }
  // Where the money comes from is a property of the project rather than of the
  // row, so a job is internally funded if any of its rows carry the code —
  // otherwise a cost-only row on the same job would land on the other side of
  // the split from the hours. Mirror of _internal_projects in model.py.
  const internalJobs = new Set();
  for (const r of rows) {
    if (r.activity === INTERNAL_PROJECT_ACTIVITY && r.project_no !== null) internalJobs.add(r.project_no);
  }
  for (const r of rows) {
    r.internal_project = r.category === 'Project' && internalJobs.has(r.project_no);
  }

  // Collapse activity codes: several rows per key, one per activity, including
  // pure cost rows with zero hours. Group by the analysis key, sum hours and
  // value, drop rows that carry neither hours nor value.
  const keys = ['person', 'project_no', 'project', 'project_full', 'task', 'year', 'category', 'internal_project', 'group_tag'];
  const groups = new Map();
  for (const r of rows) {
    const k = JSON.stringify(keys.map(c => r[c]));
    const cur = groups.get(k);
    if (cur) {
      cur.hours += r.hours;
      cur.value = sumNullable(cur.value, r.value);
    } else {
      groups.set(k, { ...pick(r, keys), hours: r.hours, value: r.value });
    }
  }
  const collapsed = [...groups.values()].filter(r => r.hours !== 0 || (r.value !== null && r.value !== 0));
  // pandas groupby(sort=True): sort by the key tuple lexicographically.
  collapsed.sort(compareBy(keys));
  return collapsed;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
function sumNullable(a, b) {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

// A generic tuple comparator that mimics pandas' groupby-sort: nulls sort
// after real values, strings and numbers compare in the usual way.
function compareBy(keys) {
  return (a, b) => {
    for (const k of keys) {
      const cmp = cmpValue(a[k], b[k]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}
function cmpValue(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

// ----------------------------------------------------------------- Group

export function buildGroup(raw, options = {}) {
  const assumptions = makeAssumptions(options);
  const budget0 = tidyBudget(raw);
  const registered0 = tidyRegistered(raw);

  let tag = options.group_tag;
  if (tag === undefined) {
    const tags = budget0.map(r => r.group_tag).filter(t => t !== null);
    tag = tags.length ? mode(tags) : null;
  }

  const before = new Set([
    ...budget0.map(r => r.person),
    ...registered0.map(r => r.person),
  ].filter(p => p !== null));

  let budget = budget0, registered = registered0;
  if (tag !== null && tag !== undefined) {
    budget = budget.filter(r => r.group_tag === tag);
    registered = registered.filter(r => r.group_tag === tag);
  }
  if (options.exclude && options.exclude.length) {
    const excl = new Set(options.exclude);
    budget = budget.filter(r => !excl.has(r.person));
    registered = registered.filter(r => !excl.has(r.person));
  }

  const after = new Set([
    ...budget.map(r => r.person),
    ...registered.map(r => r.person),
  ].filter(p => p !== null));

  const excluded = [...before].filter(p => !after.has(p)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

  return new Group(budget, registered, assumptions, tag ?? null, excluded);
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  // Match pandas Series.mode().iloc[0]: highest count, break ties by natural sort.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
}

export class Group {
  constructor(budget, registered, assumptions, groupTag, excluded) {
    this.budget = budget;
    this.registered = registered;
    this.assumptions = assumptions;
    this.group_tag = groupTag;
    this.excluded = excluded;
  }

  get years() {
    const s = new Set();
    for (const r of this.budget) if (r.year !== null) s.add(r.year);
    for (const r of this.registered) if (r.year !== null) s.add(r.year);
    return [...s].sort((a, b) => a - b);
  }

  get reporting_year() {
    const ys = this.registered.map(r => r.year).filter(y => y !== null);
    if (ys.length) return Math.max(...ys);
    const all = this.years;
    return all[all.length - 1];
  }

  get people() {
    const s = new Set();
    for (const r of this.budget) if (!r.unallocated && r.person !== null) s.add(r.person);
    for (const r of this.registered) if (r.person !== null) s.add(r.person);
    return [...s].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }

  second_groups() {
    const bins = new Map();
    for (const r of this.budget) {
      if (r.second_group === null || r.person === null) continue;
      const m = bins.get(r.person) || new Map();
      m.set(r.second_group, (m.get(r.second_group) || 0) + 1);
      bins.set(r.person, m);
    }
    const out = {};
    for (const [p, m] of bins) {
      out[p] = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
    }
    return out;
  }

  // ------------------------------------------------------------- rollups

  // {person: {Project, Internal, Absence, Other}} for a year (or all years).
  registered_by_category(year = null) {
    const rows = year === null ? this.registered : this.registered.filter(r => r.year === year);
    const bins = new Map();
    for (const r of rows) {
      const p = r.person;
      if (p === null) continue;
      let cats = bins.get(p);
      if (!cats) { cats = zeroCategories(); bins.set(p, cats); }
      cats[r.category] = (cats[r.category] || 0) + r.hours;
    }
    return bins;  // Map<person, {Project, Internal, Absence, Other}>
  }

  // As registered_by_category, but with project time split by its funding.
  // Externally funded work and CICERO's own strategic projects are both project
  // time and both count against the billing standard; they are simply worth
  // telling apart, since only one of them raises an invoice.
  registered_by_type(year = null) {
    const rows = year === null ? this.registered : this.registered.filter(r => r.year === year);
    const bins = new Map();
    for (const r of rows) {
      const p = r.person;
      if (p === null) continue;
      let kinds = bins.get(p);
      if (!kinds) { kinds = zeroTypes(); bins.set(p, kinds); }
      const kind = r.internal_project
        ? INTERNAL_PROJECT_LABEL
        : r.category === 'Project' ? EXTERNAL_PROJECT_LABEL : r.category;
      kinds[kind] = (kinds[kind] || 0) + r.hours;
    }
    return bins;  // Map<person, {External projects, Towards2040, Internal, Absence, Other}>
  }

  budget_by_person_project(year, { include_unallocated = true } = {}) {
    const rows = this.budget.filter(r =>
      r.year === year && r.category === 'Project' && (include_unallocated || !r.unallocated),
    );
    return sumBy(rows, ['person', 'project'], 'hours').filter(r => r.hours > 0);
  }

  registered_by_person_project(year) {
    const rows = this.registered.filter(r => r.year === year && r.category === 'Project');
    return sumBy(rows, ['person', 'project'], 'hours').filter(r => r.hours > 0);
  }

  nonproject_by_person_task(year) {
    const rows = this.registered.filter(r => r.year === year && r.category !== 'Project');
    const acc = new Map();
    for (const r of rows) {
      const k = JSON.stringify([r.person, r.category, r.task]);
      const cur = acc.get(k);
      if (cur) cur.hours += r.hours;
      else acc.set(k, { person: r.person, category: r.category, task: r.task, hours: r.hours });
    }
    return [...acc.values()]
      .filter(r => r.hours > 0)
      .sort((a, b) => b.hours - a.hours);
  }

  person_summary(year) {
    // The index is the union of two sets: people with any budget in this year
    // (Project category), and people with any registered hours in this year
    // (any category). UNALLOCATED_PERSON is dropped at the end.
    const projectBudget = new Map();
    for (const r of this.budget) {
      if (r.year !== year || r.category !== 'Project' || r.person === null) continue;
      projectBudget.set(r.person, (projectBudget.get(r.person) || 0) + r.hours);
    }
    const cats = this.registered_by_category(year);
    const names = new Set([...projectBudget.keys(), ...cats.keys()]);
    names.delete(UNALLOCATED_PERSON);

    const nProjects = new Map();
    for (const r of this.budget) {
      if (r.year !== year || r.category !== 'Project' || !(r.hours > 0) || r.person === null) continue;
      let s = nProjects.get(r.person);
      if (!s) { s = new Set(); nProjects.set(r.person, s); }
      s.add(r.project);
    }

    const frac = yearFraction(this.assumptions, year);
    const guide = this.assumptions.billable_hours;
    const out = [];
    for (const person of names) {
      const budget = projectBudget.get(person) || 0;
      const c = cats.get(person) || zeroCategories();
      const registeredTotal = CATEGORY_ORDER.reduce((s, k) => s + (c[k] || 0), 0);
      out.push({
        person,
        project_budget: budget,
        Project: c.Project || 0,
        Internal: c.Internal || 0,
        Absence: c.Absence || 0,
        Other: c.Other || 0,
        registered_total: registeredTotal,
        expected_to_date: budget * frac,
        variance: (c.Project || 0) - budget * frac,
        billable_target: guide,
        n_projects: (nProjects.get(person) || new Set()).size,
      });
    }
    // sort_values("project_budget", ascending=False), then stable secondary
    // by insertion order to keep this reproducible without depending on
    // pandas' particular quicksort. Python's sort is stable; JS is stable
    // since ES2019; pandas' isn't in general, but for this data the tie
    // pattern is trivial.
    out.sort((a, b) => b.project_budget - a.project_budget);
    return out;
  }

  project_summary() {
    // Named budget per (project, year), unallocated budget per (project, year),
    // registered per (project, year). Outer-joined. Missing filled with 0.
    const named = sumBy(
      this.budget.filter(r => r.category === 'Project' && !r.unallocated),
      ['project', 'year'], 'hours',
    );
    const unalloc = sumBy(
      this.budget.filter(r => r.category === 'Project' && r.unallocated),
      ['project', 'year'], 'hours',
    );
    const reg = sumBy(
      this.registered.filter(r => r.category === 'Project'),
      ['project', 'year'], 'hours',
    );

    const pm = new Map();
    for (const r of this.budget) {
      if (r.pm === null) continue;
      let bins = pm.get(r.project);
      if (!bins) { bins = new Map(); pm.set(r.project, bins); }
      bins.set(r.pm, (bins.get(r.pm) || 0) + 1);
    }
    const pmOf = project => {
      const bins = pm.get(project);
      if (!bins) return null;
      return [...bins.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
    };

    const keys = new Set();
    for (const list of [named, unalloc, reg]) for (const r of list) keys.add(`${r.project} ${r.year}`);
    const nMap = index(named, ['project', 'year']);
    const uMap = index(unalloc, ['project', 'year']);
    const rMap = index(reg, ['project', 'year']);

    const out = [];
    for (const k of keys) {
      const [project, yearStr] = k.split(' ');
      const year = Number(yearStr);
      const b = nMap.get(k)?.hours || 0;
      const u = uMap.get(k)?.hours || 0;
      const registered = rMap.get(k)?.hours || 0;
      out.push({
        project, year,
        budget_named: b,
        budget_unallocated: u,
        registered,
        pm: pmOf(project),
        budget_total: b + u,
      });
    }
    out.sort(compareBy(['project', 'year']));
    return out;
  }

  project_team(project) {
    const rows = this.budget.filter(r => r.project === project && r.category === 'Project');
    return sumBy(rows, ['person', 'year'], 'hours').filter(r => r.hours > 0);
  }
}

// ----------------------------------------------------------- small helpers

function zeroCategories() {
  const c = {};
  for (const k of CATEGORY_ORDER) c[k] = 0;
  return c;
}

function zeroTypes() {
  const c = {};
  for (const k of TYPE_ORDER) c[k] = 0;
  return c;
}

// pandas' groupby(...as_index=False)[col].sum(): sum a numeric column across
// rows sharing a tuple of key columns, and return an array of records ordered
// by the key tuple.
function sumBy(rows, keys, numericCol) {
  const acc = new Map();
  for (const r of rows) {
    const k = JSON.stringify(keys.map(c => r[c]));
    const cur = acc.get(k);
    if (cur) cur[numericCol] += r[numericCol];
    else {
      const rec = pick(r, keys);
      rec[numericCol] = r[numericCol];
      acc.set(k, rec);
    }
  }
  return [...acc.values()].sort(compareBy(keys));
}

function index(records, keys) {
  const m = new Map();
  for (const r of records) m.set(keys.map(k => r[k]).join(' '), r);
  return m;
}
