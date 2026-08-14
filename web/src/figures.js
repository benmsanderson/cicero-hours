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
    // automargin: plotly.py enables this by default, plotly.js does not.
    // Without it the horizontal bars sit on top of the y-axis labels
    // (margin.l is only 10). Turning it on lets the tick labels push the
    // plotting area over as they need to.
    xaxis: { gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE, automargin: true },
    yaxis: { gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE, automargin: true },
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
// ---------------------------------------------------------- overview

// Project hours budgeted per year, assigned vs unallocated stacked, with
// a capacity ceiling drawn as the whole team billing at the standard.
export function figGroupCapacity(group) {
  const b = group.budget.filter(r => r.category === 'Project');
  const years = group.years;
  const named = new Map(years.map(y => [y, 0]));
  const unalloc = new Map(years.map(y => [y, 0]));
  for (const r of b) {
    (r.unallocated ? unalloc : named).set(r.year, (r.unallocated ? unalloc : named).get(r.year) + r.hours);
  }
  const headcount = group.people.length;
  const capacity = headcount * group.assumptions.billable_hours;

  const x = years.map(String);
  const traces = [
    {
      type: 'bar', name: 'Assigned to a person',
      x, y: years.map(y => named.get(y)),
      marker: { color: CATEGORY_COLOURS.Project },
      hovertemplate: '%{x}: %{y:,.0f} h assigned<extra></extra>',
    },
    {
      type: 'bar', name: 'Unallocated',
      x, y: years.map(y => unalloc.get(y)),
      // bgcolor has to be given: plotly.js does not compose a pattern with
      // marker.color the way plotly.py does, so the hatch would otherwise
      // draw white lines on nothing and the bar body would disappear.
      marker: {
        color: UNALLOCATED_COLOUR,
        pattern: { shape: '/', bgcolor: UNALLOCATED_COLOUR, fgcolor: '#FFFFFF', size: 6 },
      },
      hovertemplate: '%{x}: %{y:,.0f} h unallocated<extra></extra>',
    },
  ];

  const layout = {
    ...baseLayout(
      'Project hours budgeted, by year',
      `Hatched bars are hours booked to the group but not yet assigned to a named person. ` +
      `Rule is ${headcount} researchers at the ${enThousands(group.assumptions.billable_hours)} h billing standard.`,
      420,
    ),
    barmode: 'stack',
  };
  layout.yaxis = { ...layout.yaxis, title: { text: 'hours' } };
  addCapacityZone(layout, capacity, {
    horizontal: false, label: `${enThousands(capacity)} h billable`,
  });
  return { traces, layout };
}

// Hours registered in one year, split by category, one row per person.
export function figRegisteredComposition(group, year) {
  const bins = group.registered_by_category(year);  // Map<person, {Project, Internal, Absence, Other}>
  const totals = new Map();
  for (const [p, c] of bins) totals.set(p, CATEGORY_ORDER.reduce((s, k) => s + (c[k] || 0), 0));
  // sort ascending so the biggest sits at the top of the horizontal bar
  const order = [...bins.keys()].sort((a, b) => totals.get(a) - totals.get(b));

  const traces = [];
  for (const cat of CATEGORY_ORDER) {
    const values = order.map(p => bins.get(p)[cat] || 0);
    if (values.reduce((s, v) => s + v, 0) === 0) continue;
    traces.push({
      type: 'bar', orientation: 'h', name: cat,
      y: order, x: values,
      marker: { color: CATEGORY_COLOURS[cat] },
      hovertemplate: '%{y}<br>' + cat + ': %{x:,.0f} h<extra></extra>',
    });
  }

  const frac = yearFraction(group.assumptions, year);
  const expected = group.assumptions.billable_hours * frac;
  const height = Math.max(380, 34 * order.length + 130);
  const layout = {
    ...baseLayout(
      `Hours registered in ${year}, by type`,
      'Project time is stacked first, so the rule reads directly against it. ' +
      `Billing standard pro-rated to ${Math.round(frac * 100)}% of the working year.`,
      height,
    ),
    barmode: 'stack',
  };
  layout.xaxis = { ...layout.xaxis, title: { text: 'hours registered' } };
  addCapacityZone(layout, expected, { label: `${enThousands(Math.round(expected))} h billable to date` });
  return { traces, layout };
}

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
      marker: {
        color: colour,
        pattern: { shape: '/', bgcolor: colour, fgcolor: '#FFFFFF', size: 5 },
      },
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
      if (isUnalloc) {
        marker.pattern = { shape: '/', bgcolor: UNALLOCATED_COLOUR, fgcolor: '#FFFFFF', size: 6 };
      }
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

// ---------------------------------------------------------- matrix

// Who is on what: a heatmap of budgeted hours, projects down and people
// across (there are far more projects than people, and a tall grid stays
// readable where a wide one does not).
export function figMatrix(group, year, { minHours = 1.0 } = {}) {
  const rows = group.budget_by_person_project(year).filter(r => r.hours >= minHours);
  const people = new Set();
  const projects = new Set();
  const perPP = new Map();
  for (const r of rows) {
    people.add(r.person);
    projects.add(r.project);
    perPP.set(`${r.project}|${r.person}`, r.hours);
  }
  const projectTotals = new Map();
  for (const p of projects) {
    let s = 0;
    for (const per of people) s += perPP.get(`${p}|${per}`) ?? 0;
    projectTotals.set(p, s);
  }
  const personTotals = new Map();
  for (const per of people) {
    let s = 0;
    for (const p of projects) s += perPP.get(`${p}|${per}`) ?? 0;
    personTotals.set(per, s);
  }
  // Projects sorted ascending (small at bottom), people sorted descending.
  const yLabels = [...projects].sort((a, b) => projectTotals.get(a) - projectTotals.get(b));
  const xLabels = [...people].sort((a, b) => personTotals.get(b) - personTotals.get(a));

  const z = yLabels.map(proj =>
    xLabels.map(per => perPP.get(`${proj}|${per}`) ?? null),
  );
  const text = z.map(row => row.map(v =>
    v == null ? '' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v),
  ));

  const traces = [{
    type: 'heatmap',
    z, x: xLabels, y: yLabels,
    text, texttemplate: '%{text}', textfont: { size: 10 },
    colorscale: [[0, '#F2F6F7'], [0.25, '#BBD3D8'], [0.6, '#4E8794'], [1, '#173F47']],
    hovertemplate: '%{x}<br>%{y}: %{z:,.0f} h<extra></extra>',
    colorbar: { title: { text: 'hours' }, thickness: 12, len: 0.4, y: 1, yanchor: 'top' },
    xgap: 2, ygap: 2,
  }];

  const height = Math.max(560, 22 * yLabels.length + 220);
  const layout = {
    ...baseLayout(
      `Who is on what, ${year}`,
      'Budgeted hours. Reading down a column shows one person\'s spread; ' +
      'reading across a row shows a project\'s team.',
      height,
    ),
    margin: { l: 10, r: 20, t: 210, b: 30 },
  };
  layout.xaxis = { ...layout.xaxis, tickangle: -90, side: 'top', showgrid: false };
  layout.yaxis = { ...layout.yaxis, showgrid: false, tickfont: { size: 11 } };
  return { traces, layout };
}

// -------------------------------------------------------- one researcher

function restHeading(mine, year) {
  if (!mine.length) return `The rest of ${year}: nothing booked outside projects`;
  const byCat = new Map();
  for (const r of mine) byCat.set(r.category, (byCat.get(r.category) || 0) + r.hours);
  const bits = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, h]) => `${enThousands(Math.round(h))} h ${cat.toLowerCase()}`);
  return `The rest of ${year}: ${bits.join(' · ')}, by task`;
}

// The reader's deep dive: budget vs booked on the left, commitments over
// years on the right, everything else the person booked (internal, absence,
// with the task string labelled from Norwegian to English) along the bottom.
export function figPersonDeepDive(group, year) {
  const summary = group.person_summary(year);
  const people = summary.map(r => r.person);
  const budgetRows = group.budget_by_person_project(year);
  const regRows = group.registered_by_person_project(year);
  const forwardRows = group.budget.filter(r => r.category === 'Project');
  const colours = projectColours(group);
  const frac = yearFraction(group.assumptions, year);
  const years = group.years;

  const rest = group.nonproject_by_person_task(year).map(r => ({ ...r, label: taskLabel(r.task) }));
  const taskCount = new Map();
  for (const r of rest) taskCount.set(r.person, (taskCount.get(r.person) || 0) + 1);
  const maxTasks = taskCount.size ? Math.max(...taskCount.values()) : 0;
  const bottom = Math.max(130, 21 * maxTasks);

  const traces = [];
  const owner = [];

  for (const person of people) {
    const visible = person === people[0];

    // Left panel: budget for this person, sorted ascending
    const bp = budgetRows.filter(r => r.person === person).slice()
      .sort((a, b) => a.hours - b.hours);
    const rmap = new Map(
      regRows.filter(r => r.person === person).map(r => [r.project, r.hours])
    );
    const projs = bp.map(r => r.project);
    const budgetVals = bp.map(r => r.hours);
    const bookedVals = projs.map(p => rmap.get(p) ?? 0);
    const onPlan = budgetVals.map(v => v * frac);

    traces.push({
      type: 'bar', orientation: 'h', name: 'Budgeted',
      y: projs, x: budgetVals,
      marker: { color: BUDGET_COLOUR }, visible,
      legendgroup: 'budget', offsetgroup: 'budget',
      hovertemplate: '%{y}<br>budgeted: %{x:,.0f} h<extra></extra>',
      xaxis: 'x', yaxis: 'y',
    });
    owner.push(person);
    traces.push({
      type: 'bar', orientation: 'h', name: 'Booked',
      y: projs, x: bookedVals,
      marker: { color: REGISTERED_COLOUR }, visible,
      legendgroup: 'booked', offsetgroup: 'booked',
      hovertemplate: '%{y}<br>booked: %{x:,.0f} h<extra></extra>',
      xaxis: 'x', yaxis: 'y',
    });
    owner.push(person);
    traces.push({
      type: 'scatter', mode: 'markers', name: 'On plan',
      y: projs, x: onPlan,
      marker: { symbol: 'line-ns', size: 13, line: { color: ALARM, width: 2 } },
      visible, legendgroup: 'onplan',
      hovertemplate: '%{y}<br>on plan: %{x:,.0f} h<extra></extra>',
      xaxis: 'x', yaxis: 'y',
    });
    owner.push(person);

    // Right panel: commitments by year, one trace per project, sorted by total desc.
    const perProj = new Map();
    for (const r of forwardRows) {
      if (r.person !== person) continue;
      if (!perProj.has(r.project)) perProj.set(r.project, new Map(years.map(y => [y, 0])));
      const m = perProj.get(r.project);
      m.set(r.year, m.get(r.year) + r.hours);
    }
    const projTotals = new Map();
    for (const [p, m] of perProj) projTotals.set(p, [...m.values()].reduce((s, v) => s + v, 0));
    const sortedProjs = [...perProj.keys()].sort((a, b) => projTotals.get(b) - projTotals.get(a));
    for (const proj of sortedProjs) {
      const series = years.map(y => perProj.get(proj).get(y));
      traces.push({
        type: 'bar', name: proj,
        x: years.map(String), y: series,
        marker: { color: colours[proj] || '#8899A6' },
        visible, showlegend: false, offsetgroup: 'forward',
        text: years.map(() => shorten(proj, 18)),
        textposition: 'inside', insidetextanchor: 'middle',
        insidetextfont: { color: '#FFFFFF', size: 10 },
        textangle: 0, constraintext: 'inside',
        hovertemplate: '%{x}<br>' + proj + ': %{y:,.0f} h<extra></extra>',
        xaxis: 'x2', yaxis: 'y2',
      });
      owner.push(person);
    }

    // Bottom panel: the rest of the year by task. Only the categories this
    // person actually booked to, so the legend does not promise absence they
    // never took. CATEGORY_ORDER without the first entry ("Project").
    const mine = rest.filter(r => r.person === person);
    for (const cat of CATEGORY_ORDER.slice(1)) {
      const sub = mine.filter(r => r.category === cat).slice().sort((a, b) => a.hours - b.hours);
      if (!sub.length) continue;
      traces.push({
        type: 'bar', orientation: 'h', name: cat,
        y: sub.map(r => r.label), x: sub.map(r => r.hours),
        marker: { color: CATEGORY_COLOURS[cat] }, visible, legendgroup: cat,
        customdata: sub.map(r => r.task ?? 'no task on the row'),
        hovertemplate: '%{customdata}<br>' + cat + ': %{x:,.0f} h<extra></extra>',
        xaxis: 'x3', yaxis: 'y3',
      });
      owner.push(person);
    }
  }

  const seconds = group.second_groups();
  const buttons = people.map(person => {
    const row = summary.find(r => r.person === person);
    const second = seconds[person];
    const tail = second ? ` · part-time in ${second.split(' / ').at(-1)}` : '';
    const mine = rest.filter(r => r.person === person);
    const nprj = row.n_projects;
    const projWord = nprj === 1 ? 'project' : 'projects';
    return {
      label: person, method: 'update',
      args: [
        { visible: owner.map(o => o === person) },
        {
          'title.text':
            `<b>${person}</b><br>` +
            `<span style="font-size:12px;color:${MUTED}">` +
            `${enThousands(Math.round(row.project_budget))} h budgeted across ${nprj} ${projWord} in ${year} · ` +
            `${enThousands(Math.round(row.Project))} h booked · ` +
            `${enThousands(Math.round(row.Absence))} h absence · ` +
            `${enThousands(Math.round(row.Internal))} h internal${tail}</span>`,
          'annotations[2].text': restHeading(mine, year),
          'yaxis3.categoryarray': mine.slice().sort((a, b) => a.hours - b.hours).map(r => r.label),
          'xaxis3.visible': mine.length > 0,
          'yaxis3.visible': mine.length > 0,
        },
      ],
    };
  });

  const first = summary[0];
  const firstRest = rest.filter(r => r.person === first.person);
  const firstNprj = first.n_projects;
  const firstProjWord = firstNprj === 1 ? 'project' : 'projects';
  const height = 130 + 90 + Math.round((400 + bottom) / (1 - 0.12));

  // 2×2 subplot layout with the bottom row spanning both columns. plotly.js has
  // no make_subplots equivalent; the domains are hand-set to leave room for
  // the subplot titles and the legend under the panels. The trace routing
  // (xaxis/yaxis on each trace) is what the cross-check pins.
  const guide = group.assumptions.billable_hours;
  const layout = {
    ...baseLayout(
      first.person,
      `${enThousands(Math.round(first.project_budget))} h budgeted across ${firstNprj} ${firstProjWord} in ${year}`,
      height,
    ),
    barmode: 'stack',
    uniformtext: { mode: 'hide', minsize: 9 },
    margin: { l: 10, r: 20, t: 130, b: 90 },
    legend: { orientation: 'h', yanchor: 'top', y: -0.1, xanchor: 'left', x: 0, font: { size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
    updatemenus: [dropdown(buttons, height, 130, { bottom: 90, gap: 92, active: 0 })],
  };

  const topBottom = 0.42;  // where row 1 begins (fraction of plot area from bottom)
  const bottomTop = 0.28;  // where row 2 ends
  layout.xaxis = { ...layout.xaxis, domain: [0, 0.56], title: { text: 'hours' } };
  layout.yaxis = { ...layout.yaxis, domain: [topBottom, 1], tickfont: { size: 11 } };
  layout.xaxis2 = { domain: [0.69, 1], anchor: 'y2', gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE };
  layout.yaxis2 = { domain: [topBottom, 1], anchor: 'x2', gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE, title: { text: 'hours budgeted' } };
  layout.xaxis3 = { domain: [0, 1], anchor: 'y3', gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE, title: { text: 'hours registered' }, visible: firstRest.length > 0 };
  layout.yaxis3 = {
    domain: [0, bottomTop], anchor: 'x3', gridcolor: HAIRLINE, zerolinecolor: HAIRLINE, linecolor: HAIRLINE,
    tickfont: { size: 10.5 }, automargin: true,
    categoryorder: 'array', categoryarray: firstRest.slice().sort((a, b) => a.hours - b.hours).map(r => r.label),
    visible: firstRest.length > 0,
  };

  // Subplot titles as annotations. Kept in this order so the picker's
  // `annotations[2].text` targets the bottom panel title.
  layout.annotations.push(
    { xref: 'x domain', yref: 'y domain', x: 0.5, y: 1.06, xanchor: 'center', yanchor: 'bottom',
      text: `${year}: budget against hours booked`, showarrow: false, font: { size: 13 } },
    { xref: 'x2 domain', yref: 'y2 domain', x: 0.5, y: 1.06, xanchor: 'center', yanchor: 'bottom',
      text: 'Commitments by year', showarrow: false, font: { size: 13 } },
    { xref: 'x3 domain', yref: 'y3 domain', x: 0.5, y: 1.06, xanchor: 'center', yanchor: 'bottom',
      text: restHeading(firstRest, year), showarrow: false, font: { size: 13 } },
  );
  // Capacity hline on the right panel; keep as one more shape+annotation.
  layout.shapes.push({
    type: 'line', xref: 'x2 domain', yref: 'y2',
    x0: 0, x1: 1, y0: guide, y1: guide,
    line: { color: ALARM, width: 1.4, dash: 'dot' },
  });
  layout.annotations.push({
    xref: 'x2 domain', yref: 'y2',
    x: 0, y: guide, xanchor: 'left', yanchor: 'bottom',
    text: `${enThousands(guide)} h`, showarrow: false,
    font: { size: 11, color: ALARM },
  });

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
