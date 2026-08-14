// Plotly figures for the group hours dashboard. Ported from
// cicero_hours/figures.py; each builder returns { traces, layout } that
// Plotly.newPlot accepts unchanged. Names, colours, capacity-zone treatment
// and layout constants stay identical between the two builds so a semantic
// cross-check on the trace data catches the moment they part company.

import { CATEGORY_ORDER, UNALLOCATED_PERSON } from './rules.js';
import { yearFraction } from './model.js';
import {
  BUDGET_COLOUR,
  CATEGORY_COLOURS,
  FONT,
  HAIRLINE,
  INK,
  MUTED,
  OVER_ZONE,
  REGISTERED_COLOUR,
  UNALLOCATED_COLOUR,
  personColours,
  projectColours,
  yearColours,
} from './palette.js';

// -------------------------------------------------------- layout helpers

const ALARM = '#C75A3C';

export function baseLayout(title, subtitle = '', height = 520) {
  const heading = subtitle
    ? `<b>${title}</b><br><span style="font-size:12px;color:${MUTED}">${subtitle}</span>`
    : `<b>${title}</b>`;
  return {
    title: { text: heading, x: 0, xanchor: 'left', font: { size: 16 } },
    font: FONT,
    height,
    margin: { l: 10, r: 20, t: subtitle ? 70 : 56, b: 44 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    hoverlabel: { font_size: 12 },
    legend: {
      orientation: 'h', yanchor: 'bottom', y: 1.0, xanchor: 'right', x: 1,
      font: { size: 11 }, bgcolor: 'rgba(0,0,0,0)',
    },
    xaxis: { gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE },
    yaxis: { gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE },
    shapes: [],
    annotations: [],
  };
}

// The signature element: a hard capacity rule with the overrun side tinted.
export function addCapacityZone(layout, capacity, { horizontal = true, label = '' } = {}) {
  layout.shapes ||= [];
  layout.annotations ||= [];
  const text = label || `${enThousands(Math.round(capacity))} h`;
  if (horizontal) {
    layout.shapes.push({
      type: 'rect', xref: 'x', yref: 'paper',
      x0: capacity, x1: capacity * 2.2, y0: 0, y1: 1,
      fillcolor: OVER_ZONE, line: { width: 0 }, layer: 'below',
    });
    layout.shapes.push({
      type: 'line', xref: 'x', yref: 'paper',
      x0: capacity, x1: capacity, y0: 0, y1: 1,
      line: { color: ALARM, width: 1.4, dash: 'dot' },
    });
    layout.annotations.push({
      x: capacity, y: 1, xref: 'x', yref: 'paper', showarrow: false,
      xanchor: 'left', yanchor: 'bottom', text,
      font: { size: 11, color: ALARM },
    });
  } else {
    layout.shapes.push({
      type: 'rect', xref: 'paper', yref: 'y',
      x0: 0, x1: 1, y0: capacity, y1: capacity * 2.2,
      fillcolor: OVER_ZONE, line: { width: 0 }, layer: 'below',
    });
    layout.shapes.push({
      type: 'line', xref: 'paper', yref: 'y',
      x0: 0, x1: 1, y0: capacity, y1: capacity,
      line: { color: ALARM, width: 1.4, dash: 'dot' },
    });
    layout.annotations.push({
      x: 1, y: capacity, xref: 'paper', yref: 'y', showarrow: false,
      xanchor: 'left', yanchor: 'middle', text,
      font: { size: 11, color: ALARM },
    });
  }
}

// Fraction to float the picker above the plotting area by `gap` pixels.
// Menu coordinates are fractions of the plotting area, so a constant y
// drifts further from the plot the taller the figure gets.
export function menuY(height, top, bottom = 44, gap = 46) {
  return 1 + gap / Math.max(height - top - bottom, 1);
}

export function dropdown(buttons, height, top, { bottom = 44, active = 0, gap = 46 } = {}) {
  return {
    buttons, direction: 'down', showactive: true, active,
    x: 1, xanchor: 'right', y: menuY(height, top, bottom, gap), yanchor: 'top',
    bgcolor: '#FFFFFF', bordercolor: HAIRLINE, font: { size: 12 },
  };
}

export function titleHtml(title, subtitle) {
  return `<b>${title}</b><br><span style="font-size:12px;color:${MUTED}">${subtitle}</span>`;
}

// '92 - Ferie/Vacation' becomes 'Vacation'. Match the Python's _task_label.
export function taskLabel(task) {
  if (typeof task !== 'string' || !task.trim()) return 'Unspecified';
  const firstSlash = task.indexOf('/');
  const beforeSlash = firstSlash >= 0 ? task.slice(0, firstSlash) : task;
  const at = beforeSlash.indexOf(' - ');
  const body = at >= 0 ? task.slice(at + 3) : task;
  const parts = body.split('/');
  const label = parts[parts.length - 1].trim();
  return label || task.trim();
}

export function shorten(label, width = 22) {
  return label.length <= width ? label : label.slice(0, width - 1) + '…';
}

// A person's largest top_n projects, the rest rolled into 'Other (N)'.
export function stackWithRollup(rows, topN) {
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.person)) byPerson.set(r.person, []);
    byPerson.get(r.person).push(r);
  }
  const out = [];
  for (const [person, projects] of byPerson) {
    const sorted = [...projects].sort((a, b) => b.hours - a.hours);
    const head = sorted.slice(0, topN);
    const tail = sorted.slice(topN);
    out.push(...head);
    if (tail.length) {
      out.push({
        person, project: `Other (${tail.length})`,
        hours: tail.reduce((s, r) => s + r.hours, 0),
      });
    }
  }
  return out;
}

// -------------------------------------------------------- small helpers

function enThousands(n) {
  return new Intl.NumberFormat('en-US', { useGrouping: true }).format(n);
}

// Years with at least one budgeted project entry, in ascending order.
function budgetedYears(group) {
  return group.years.filter(y => group.budget_by_person_project(y).length > 0);
}

// A person's project budget for one year, keyed by person, summing hours.
function sumByPersonProject(rows) {
  const acc = new Map();
  for (const r of rows) {
    const cur = acc.get(r.person);
    acc.set(r.person, (cur || 0) + r.hours);
  }
  return acc;
}

// ============================================================= figures
//
// One export per Python figure. Each returns { traces, layout } that
// plot() below hands to Plotly.newPlot. The trace list and the layout
// bits that carry meaning (categoryarray, menu masks) are snapshotted
// into spec/expected.json and cross-checked against the Python.

// ------------------------------------------------------------ people

// Hours budgeted per person for one year, with the other years a click away.
export function figPersonBudgetStack(group, year, { topN = 6 } = {}) {
  const years = budgetedYears(group);
  if (!years.includes(year)) year = years[years.length - 1];
  const colours = projectColours(group);
  const subtitle =
    `Largest ${topN} projects each, labelled where they fit; the rest pooled in grey. ` +
    `'${UNALLOCATED_PERSON}' is unassigned group time.`;

  const traces = [];
  const owner = [];
  const orderOf = {};
  for (const y of years) {
    const df = group.budget_by_person_project(y);
    const perPerson = sumByPersonProject(df);
    orderOf[y] = [...perPerson.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
    const rolled = stackWithRollup(df, topN);
    // Sort projects by total hours descending, so the stacking order is stable.
    const projectTotals = new Map();
    for (const r of rolled) projectTotals.set(r.project, (projectTotals.get(r.project) || 0) + r.hours);
    const projects = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    for (const proj of projects) {
      const sub = rolled.filter(r => r.project === proj);
      const isRollup = proj.startsWith('Other (');
      traces.push({
        type: 'bar', orientation: 'h', name: proj,
        y: sub.map(r => r.person), x: sub.map(r => r.hours),
        visible: y === year,
        marker: { color: isRollup ? '#B9C2C9' : (colours[proj] || '#8899A6') },
        hovertemplate: '%{y}<br>' + proj + ': %{x:,.0f} h<extra></extra>',
        text: sub.map(() => shorten(proj)),
        textposition: 'inside', insidetextanchor: 'middle',
        insidetextfont: { color: isRollup ? INK : '#FFFFFF', size: 11 },
        textangle: 0, constraintext: 'inside',
        showlegend: false,
      });
      owner.push(y);
    }
  }

  const heightFor = (y) => Math.max(280, 36 * orderOf[y].length + 180);

  const buttons = years.map(y => ({
    label: String(y), method: 'update',
    args: [
      { visible: owner.map(o => o === y) },
      {
        'title.text': titleHtml(`Hours budgeted per person, ${y}`, subtitle),
        'yaxis.categoryarray': orderOf[y],
        height: heightFor(y),
        'updatemenus[0].y': menuY(heightFor(y), 124),
      },
    ],
  }));

  const layout = {
    ...baseLayout(`Hours budgeted per person, ${year}`, subtitle, heightFor(year)),
    barmode: 'stack',
    margin: { l: 10, r: 20, t: 124, b: 44 },
    uniformtext: { mode: 'hide', minsize: 9 },
    updatemenus: [dropdown(buttons, heightFor(year), 124, { active: years.indexOf(year) })],
  };
  layout.yaxis = { ...layout.yaxis, categoryorder: 'array', categoryarray: orderOf[year] };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours budgeted' } };
  addCapacityZone(layout, group.assumptions.billable_hours, {
    label: `${enThousands(group.assumptions.billable_hours)} h billing standard`,
  });
  return { traces, layout };
}

// Project time against plan for one year, other years a click away.
export function figPersonBurn(group, year) {
  const rows = new Map();
  for (const y of group.years) {
    const s = group.person_summary(y)
      .filter(r => r.project_budget > 0 || r.Project > 0)
      // sort_values("project_budget") ascending
      .sort((a, b) => a.project_budget - b.project_budget);
    if (s.length) rows.set(y, s);
  }
  const years = [...rows.keys()];
  if (!years.includes(year)) year = years[years.length - 1];

  const subtitleFor = (y) => {
    const frac = yearFraction(group.assumptions, y);
    if (frac === 0) {
      return 'Absence and internal time excluded. Nothing is booked to ' +
             `${y} yet, so the bars are the budget as it stands.`;
    }
    return 'Absence and internal time excluded. Tick marks the straight-line ' +
           `expectation at ${Math.round(frac * 100)}% of ${y}'s working year.`;
  };

  const traces = [];
  const owner = [];
  for (const [y, s] of rows) {
    const visible = y === year;
    const yaxis = s.map(r => r.person);
    traces.push({
      type: 'bar', orientation: 'h', name: `Budgeted for ${y}`,
      y: yaxis, x: s.map(r => r.project_budget),
      marker: { color: BUDGET_COLOUR }, visible, legendgroup: 'budget',
      hovertemplate: '%{y}<br>budgeted: %{x:,.0f} h<extra></extra>',
    });
    traces.push({
      type: 'bar', orientation: 'h', name: 'Registered so far',
      y: yaxis, x: s.map(r => r.Project),
      marker: { color: REGISTERED_COLOUR }, width: 0.42, visible, legendgroup: 'registered',
      hovertemplate: '%{y}<br>registered: %{x:,.0f} h<extra></extra>',
    });
    traces.push({
      type: 'scatter', mode: 'markers', name: 'On plan at this date',
      y: yaxis, x: s.map(r => r.expected_to_date),
      marker: { symbol: 'line-ns', size: 16, line: { color: ALARM, width: 2.2 } },
      visible, legendgroup: 'onplan',
      hovertemplate: '%{y}<br>on plan: %{x:,.0f} h<extra></extra>',
    });
    owner.push(y, y, y);
  }

  const heightFor = (y) => Math.max(280, 34 * rows.get(y).length + 180);

  const buttons = years.map(y => ({
    label: String(y), method: 'update',
    args: [
      { visible: owner.map(o => o === y) },
      {
        'title.text': titleHtml(`Project time against plan, ${y}`, subtitleFor(y)),
        'yaxis.categoryarray': rows.get(y).map(r => r.person),
        height: heightFor(y),
        'updatemenus[0].y': menuY(heightFor(y), 124),
      },
    ],
  }));

  const layout = {
    ...baseLayout(`Project time against plan, ${year}`, subtitleFor(year), heightFor(year)),
    barmode: 'overlay',
    margin: { l: 10, r: 20, t: 124, b: 44 },
    // The picker takes the top right; move the legend out from under it.
    legend: {
      orientation: 'h', yanchor: 'bottom', y: 1.0, xanchor: 'left', x: 0,
      font: { size: 11 }, bgcolor: 'rgba(0,0,0,0)',
    },
    updatemenus: [dropdown(buttons, heightFor(year), 124, { active: years.indexOf(year) })],
  };
  layout.yaxis = {
    ...layout.yaxis, categoryorder: 'array', categoryarray: rows.get(year).map(r => r.person),
  };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours' } };
  return { traces, layout };
}

// Committed hours ahead per person, one bar per year.
export function figPersonForward(group) {
  const rows = group.budget.filter(r => r.category === 'Project' && !r.unallocated);
  // Pivot: index=person, columns=year, values=sum(hours), fillna(0)
  const persons = new Set();
  const yearsSet = new Set();
  for (const r of rows) { persons.add(r.person); yearsSet.add(r.year); }
  const years = [...yearsSet].sort((a, b) => a - b);
  const piv = new Map();
  for (const p of persons) {
    const row = new Map();
    for (const y of years) row.set(y, 0);
    piv.set(p, row);
  }
  for (const r of rows) piv.get(r.person).set(r.year, piv.get(r.person).get(r.year) + r.hours);

  // Sort persons by total budget ascending, so the biggest sits at the top in a
  // horizontal bar (plotly draws index 0 at the bottom).
  const totals = new Map();
  for (const [p, row] of piv) totals.set(p, [...row.values()].reduce((s, v) => s + v, 0));
  const order = [...piv.keys()].sort((a, b) => totals.get(a) - totals.get(b));

  const colours = yearColours(years);
  const traces = years.map(y => ({
    type: 'bar', orientation: 'h', name: String(y),
    y: order, x: order.map(p => piv.get(p).get(y)),
    marker: { color: colours[y] },
    hovertemplate: '%{y}<br>' + y + ': %{x:,.0f} h<extra></extra>',
  }));

  const height = Math.max(420, 44 * order.length + 140);
  const layout = {
    ...baseLayout(
      'Committed hours ahead, by person',
      'Named budget only. Short bars in later years show where funding runs out first.',
      height,
    ),
    barmode: 'group',
  };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours budgeted' } };
  addCapacityZone(layout, group.assumptions.billable_hours, {
    label: `${enThousands(group.assumptions.billable_hours)} h billing standard`,
  });
  return { traces, layout };
}

// ---------------------------------------------------------- projects

// Budgeted hours per project, one row per project. Two bars per year: the
// named budget in solid colour, the unallocated portion hatched, and both
// share a legend group so a click toggles them together.
export function figProjectTotals(group, { minHours = 100.0 } = {}) {
  const ps = group.project_summary();
  // totals per project
  const totals = new Map();
  for (const r of ps) totals.set(r.project, (totals.get(r.project) || 0) + r.budget_total);
  // Keep projects with total >= minHours, sort ascending so the largest sits at
  // the top of the horizontal bar.
  const keep = [...totals.entries()]
    .filter(([, t]) => t >= minHours)
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);

  const years = [...new Set(ps.map(r => r.year))].sort((a, b) => a - b);
  const colours = yearColours(years);

  // Index (project, year) -> row
  const idx = new Map();
  for (const r of ps) idx.set(`${r.project} ${r.year}`, r);
  const named = (proj, y) => idx.get(`${proj} ${y}`)?.budget_named ?? 0;
  const unalloc = (proj, y) => idx.get(`${proj} ${y}`)?.budget_unallocated ?? 0;

  const traces = [];
  for (const y of years) {
    const colour = colours[y];
    traces.push({
      type: 'bar', orientation: 'h', name: String(y),
      y: keep, x: keep.map(p => named(p, y)),
      marker: { color: colour }, legendgroup: String(y),
      hovertemplate: '%{y}<br>' + y + ' assigned: %{x:,.0f} h<extra></extra>',
    });
    traces.push({
      type: 'bar', orientation: 'h', name: `${y} unallocated`,
      y: keep, x: keep.map(p => unalloc(p, y)),
      marker: { color: colour, pattern: { shape: '/', fgcolor: '#FFFFFF', size: 5 } },
      legendgroup: String(y), showlegend: false,
      hovertemplate: '%{y}<br>' + y + ' unallocated: %{x:,.0f} h<extra></extra>',
    });
  }

  const height = Math.max(500, 26 * keep.length + 150);
  const layout = {
    ...baseLayout(
      'Budgeted hours per project',
      `Projects above ${Math.round(minHours)} h in total. Hatched segments are hours ` +
      'with no name against them yet.',
      height,
    ),
    barmode: 'stack',
  };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours budgeted' } };
  return { traces, layout };
}

// One project at a time, chosen from a dropdown: who is on it, by year.
export function figProjectTeam(group, { minHours = 100.0 } = {}) {
  const ps = group.project_summary();
  const totals = new Map();
  for (const r of ps) totals.set(r.project, (totals.get(r.project) || 0) + r.budget_total);
  const projects = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, t]) => t >= minHours)
    .map(([p]) => p);
  const years = group.years;
  const yearStr = years.map(String);
  const colours = personColours(group, UNALLOCATED_PERSON);

  const traces = [];
  const traceOwner = [];
  for (const proj of projects) {
    const team = group.project_team(proj);
    // People sorted by total on the project, descending
    const totalsPerson = new Map();
    for (const r of team) totalsPerson.set(r.person, (totalsPerson.get(r.person) || 0) + r.hours);
    const people = [...totalsPerson.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    for (const person of people) {
      const perYear = new Map();
      for (const y of years) perYear.set(y, 0);
      for (const r of team) if (r.person === person) perYear.set(r.year, (perYear.get(r.year) || 0) + r.hours);
      const isUnalloc = person === UNALLOCATED_PERSON;
      const marker = { color: isUnalloc ? UNALLOCATED_COLOUR : (colours[person] || '#8899A6') };
      if (isUnalloc) marker.pattern = { shape: '/', fgcolor: '#FFFFFF', size: 6 };
      traces.push({
        type: 'bar', name: isUnalloc ? 'Unallocated' : person,
        x: yearStr, y: years.map(y => perYear.get(y)),
        visible: proj === projects[0],
        marker,
        hovertemplate: '%{x}<br>%{fullData.name}: %{y:,.0f} h<extra></extra>',
      });
      traceOwner.push(proj);
    }
  }

  // Project manager as read from the summary (mode within project).
  const pmOf = new Map();
  for (const r of ps) {
    if (r.pm !== null && !pmOf.has(r.project)) pmOf.set(r.project, r.pm);
  }
  const buttons = projects.map(proj => {
    const pm = pmOf.get(proj);
    const pmLabel = pm ? ` · led by ${pm}` : '';
    return {
      label: proj.slice(0, 46), method: 'update',
      args: [
        { visible: traceOwner.map(o => o === proj) },
        {
          'title.text': `<b>Team on ${proj}</b><br>` +
            `<span style="font-size:12px;color:${MUTED}">` +
            `Budgeted hours per person per year${pmLabel}</span>`,
        },
      ],
    };
  });

  const layout = {
    ...baseLayout('Team on a project', 'Budgeted hours per person per year', 520),
    barmode: 'stack',
    margin: { l: 10, r: 20, t: 140, b: 44 },
    updatemenus: [{
      buttons, direction: 'down', showactive: true,
      x: 1, xanchor: 'right', y: 1.28, yanchor: 'top',
      bgcolor: '#FFFFFF', bordercolor: HAIRLINE, font: { size: 12 },
    }],
  };
  layout.yaxis = { ...layout.yaxis, title: { text: 'hours budgeted' } };
  return { traces, layout };
}

// Delivery against budget by project for one year. Sorted by shortfall,
// so the projects furthest behind their plan sit at the top.
export function figProjectBurn(group, year, { minHours = 50.0 } = {}) {
  const ps = group.project_summary().filter(r => r.year === year && r.budget_total >= minHours);
  const frac = yearFraction(group.assumptions, year);
  const withGap = ps.map(r => ({ ...r, expected: r.budget_total * frac, gap: r.registered - r.budget_total * frac }));
  withGap.sort((a, b) => a.gap - b.gap);

  const yaxis = withGap.map(r => r.project);
  const traces = [
    {
      type: 'bar', orientation: 'h', name: 'Budgeted',
      y: yaxis, x: withGap.map(r => r.budget_total),
      marker: { color: BUDGET_COLOUR },
      hovertemplate: '%{y}<br>budgeted: %{x:,.0f} h<extra></extra>',
    },
    {
      type: 'bar', orientation: 'h', name: 'Registered',
      y: yaxis, x: withGap.map(r => r.registered),
      marker: { color: REGISTERED_COLOUR }, width: 0.42,
      hovertemplate: '%{y}<br>registered: %{x:,.0f} h<extra></extra>',
    },
    {
      type: 'scatter', mode: 'markers', name: 'On plan at this date',
      y: yaxis, x: withGap.map(r => r.expected),
      marker: { symbol: 'line-ns', size: 14, line: { color: ALARM, width: 2.2 } },
      hovertemplate: '%{y}<br>on plan: %{x:,.0f} h<extra></extra>',
    },
  ];

  const height = Math.max(520, 24 * withGap.length + 150);
  const layout = {
    ...baseLayout(
      `Delivery against budget by project, ${year}`,
      'Sorted by shortfall. The projects at the top are furthest behind their plan.',
      height,
    ),
    barmode: 'overlay',
  };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours' } };
  return { traces, layout };
}

// ============================================================ plot()

// Turn a { traces, layout } spec into a live plotly plot inside `element`.
// Guarded: if Plotly failed to load, the placeholder stays.
export function plot(element, spec) {
  if (typeof window === 'undefined' || !window.Plotly) return;
  window.Plotly.newPlot(element, spec.traces, spec.layout, {
    displaylogo: false, responsive: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
  });
}

// Plotly cannot lay out into a hidden container: call this when a tab is shown.
export function resizeAll(root = document) {
  if (typeof window === 'undefined' || !window.Plotly) return;
  root.querySelectorAll('.js-plotly-plot').forEach(el => window.Plotly.Plots.resize(el));
}
