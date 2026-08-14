// Entry point for the browser build.
//
// Loads a Timer budsjettert og registrert pr. medarbeider export from the
// local disk, runs it through the same loader/model the Python does, and
// renders the shell: header, editable as-of, KPI strip, tab nav, notes,
// footer. Figures land in Phase 6, the board in Phase 5; each tab is a
// placeholder for now so the layout is real even if the contents are not.
//
// Nothing leaves this page. There is no fetch, no analytics, no service
// worker: the file is read from the user's disk, parsed here, and shown.

import { loadExport } from './loader.js';
import { buildGroup, yearFraction } from './model.js';
import {
  BILLABLE_HOURS_DEFAULT,
  UNALLOCATED_PERSON,
} from './rules.js';

// -------------------------------------------------------------- state

const state = {
  raw: null,
  group: null,
  as_of: todayISO(),
  title: 'Climate Mitigation',
  decodeWarning: '',
};

const TABS = [
  ['overview', 'Overview'],
  ['people', 'People'],
  ['projects', 'Projects'],
  ['deepdive', 'One researcher'],
  ['matrix', 'Who is on what'],
  ['board', 'Allocation board'],
];

// ------------------------------------------------------------- boot

document.addEventListener('DOMContentLoaded', () => mount());

function mount() {
  const wrap = document.getElementById('wrap');
  if (!wrap) return;
  wrap.replaceChildren(emptyState());
}

// ------------------------------------------------------- empty state

function emptyState() {
  const root = el('div', { class: 'empty', id: 'empty' });
  root.appendChild(el('div', { class: 'eyebrow' }, 'CICERO group hours'));
  root.appendChild(el('h1', {}, 'Open a hours export to begin'));
  root.appendChild(paragraph(
    'This page reads the ',
    el('b', {}, 'Timer budsjettert og registrert pr. medarbeider'),
    " export you save out of CICERO's finance system, then shows the same six views the Python build does.",
  ));
  root.appendChild(paragraph(
    'Nothing leaves this page: the file is parsed in your browser, it is never uploaded, and this page never talks to the network. That is deliberate. The export is personal data about named staff.',
  ));

  const drop = el('div', { class: 'drop', id: 'drop', role: 'button', tabindex: '0' });
  drop.appendChild(el('button', { type: 'button', class: 'pick', id: 'pick' }, 'Choose file'));
  drop.appendChild(el('input', {
    type: 'file', id: 'file', accept: '.csv,text/csv,text/plain', hidden: '',
  }));
  drop.appendChild(el('p', { class: 'hint' }, 'or drop the CSV here'));
  drop.appendChild(el('p', { class: 'warn', id: 'err' }));
  root.appendChild(drop);

  drop.addEventListener('click', e => {
    if (e.target && e.target.id === 'pick') return;  // the pick button handles itself
    if (e.target && e.target.id === 'file') return;
    document.getElementById('file').click();
  });
  drop.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('file').click(); }
  });
  document.getElementById('pick', root)?.addEventListener?.('click', () => {});
  const pick = drop.querySelector('#pick');
  pick.addEventListener('click', e => { e.stopPropagation(); document.getElementById('file').click(); });
  const file = drop.querySelector('#file');
  file.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { stop(e); drop.classList.add('hot'); }));
  ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, e => { stop(e); drop.classList.remove('hot'); }));
  drop.addEventListener('drop', e => {
    stop(e);
    drop.classList.remove('hot');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  return root;
}

function showError(msg) {
  const err = document.getElementById('err');
  if (err) err.textContent = msg;
}

// ------------------------------------------------------------- load

async function handleFile(file) {
  showError('');
  const wrap = document.getElementById('wrap');
  const loading = el('div', { class: 'loading' }, `Reading ${file.name}…`);
  wrap.replaceChildren(loading);
  // Yield so the loading message paints before we block on parsing.
  await new Promise(r => setTimeout(r, 0));

  let text, warning = '';
  try {
    const buf = await readBytes(file);
    ({ text, warning } = decodeBytes(buf));
  } catch (err) {
    return backToEmpty(`Could not read ${file.name}: ${err.message}`);
  }

  let raw;
  try {
    raw = loadExport(text);
  } catch (err) {
    return backToEmpty(`That does not look like a Timer budsjettert export. ${err.message}`);
  }
  if (!raw.tables.budget || !raw.tables.registered) {
    const found = Object.keys(raw.tables).sort().join(', ') || 'none';
    return backToEmpty(
      `That does not look like a Timer budsjettert export: the file has no budget or registered table. Tables recognised: ${found}.`
    );
  }

  let group;
  try {
    group = buildGroup(raw, { as_of: state.as_of, billable_hours: BILLABLE_HOURS_DEFAULT });
  } catch (err) {
    return backToEmpty(`Could not tidy the export: ${err.message}`);
  }

  state.raw = raw;
  state.group = group;
  state.decodeWarning = warning;
  renderDashboard();
}

function backToEmpty(message) {
  const wrap = document.getElementById('wrap');
  wrap.replaceChildren(emptyState());
  showError(message);
}

// FileReader rather than Blob.arrayBuffer(): jsdom (the test environment)
// does not implement the newer method, and FileReader is a widely-supported
// fallback that returns the same bytes.
function readBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsArrayBuffer(file);
  });
}

// UTF-8 first (that's what the real exports are), Windows-1252 as a fallback
// with a visible warning. Mis-decoded Norwegian characters garble names
// silently rather than failing, so opt in to strict UTF-8 and only relax
// deliberately.
function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    return { text: dec.decode(bytes) };
  } catch {
    const dec = new TextDecoder('windows-1252');
    return {
      text: dec.decode(bytes),
      warning: 'This export is not valid UTF-8; opened as Windows-1252 instead. Norwegian characters may not render correctly. Ask for a UTF-8 export if you can.',
    };
  }
}

// --------------------------------------------------------- render

function renderDashboard() {
  const g = state.group;
  const year = g.reporting_year;
  const frac = yearFraction(g.assumptions, year);

  const wrap = document.getElementById('wrap');
  wrap.replaceChildren();

  wrap.appendChild(renderHeader(g, year, frac));
  wrap.appendChild(renderNav(TABS));
  const panels = el('div', { id: 'panels' });
  for (const [id, label] of TABS) panels.appendChild(renderPanel(id, label));
  wrap.appendChild(panels);
  wrap.appendChild(renderNotes(g, year, frac));
  wrap.appendChild(renderFooter(g));

  wireTabs();
  showTab(TABS[0][0]);
  wireAsOf();
}

function renderHeader(g, year, frac) {
  const header = el('header');
  const eye = el('div', { class: 'eyebrow' },
    'CICERO · reporting year ', String(year), ' · as of ',
  );
  const asOf = el('input', { type: 'date', id: 'as-of', value: state.as_of });
  eye.appendChild(asOf);
  header.appendChild(eye);
  header.appendChild(el('h1', {}, `${state.title}: hours and allocation`));
  header.appendChild(el('p', { class: 'standfirst' },
    "Where the group's time is committed, how much of it has been booked so far, and which hours are still waiting for a name.",
  ));
  header.appendChild(renderKpis(g, year));
  if (state.decodeWarning) {
    header.appendChild(el('p', { class: 'header-warn' }, state.decodeWarning));
  }
  return header;
}

function renderKpis(g, year) {
  const budget = g.budget.filter(r => r.category === 'Project');
  const summary = g.person_summary(year);
  const over = summary.filter(s => s.project_budget > g.assumptions.billable_hours);

  const budgetedThisYear = budget
    .filter(r => r.year === year)
    .reduce((s, r) => s + r.hours, 0);

  const registered = g.registered_by_category(year);
  let projectRegistered = 0, totalRegistered = 0;
  for (const cats of registered.values()) {
    for (const [k, v] of Object.entries(cats)) {
      totalRegistered += v;
      if (k === 'Project') projectRegistered += v;
    }
  }
  const projectShare = totalRegistered > 0 ? projectRegistered / totalRegistered : 0;

  const unallocNext = budget.filter(r => r.unallocated && r.year > year).reduce((s, r) => s + r.hours, 0);
  const namedNext = budget.filter(r => !r.unallocated && r.year > year).reduce((s, r) => s + r.hours, 0);
  const nextShare = unallocNext / Math.max(namedNext + unallocNext, 1);

  const cards = [
    ['', String(g.people.length), 'people with hours'],
    ['', fmt(Math.round(budgetedThisYear)), `hours budgeted for ${year}`],
    [over.length ? 'warn' : '', String(over.length),
      `over the ${fmt(g.assumptions.billable_hours)} h standard in ${year}`],
    ['', pct(projectShare), 'of registered time on projects'],
    ['gap', pct(nextShare), `of ${year + 1}+ budget unallocated`],
  ];

  const box = el('div', { class: 'kpis', id: 'kpis' });
  for (const [cls, value, label] of cards) {
    const kpi = el('div', { class: `kpi ${cls}`.trim() });
    kpi.appendChild(el('span', { class: 'value' }, value));
    kpi.appendChild(el('span', { class: 'label' }, label));
    box.appendChild(kpi);
  }
  return box;
}

function renderNav(tabs) {
  const nav = el('nav', { role: 'tablist' });
  for (const [id, label] of tabs) {
    const b = el('button', {
      role: 'tab', 'data-target': id, 'aria-selected': 'false',
    }, label);
    nav.appendChild(b);
  }
  return nav;
}

function renderPanel(id, label) {
  const panel = el('div', { class: 'panel', id, role: 'tabpanel' });
  panel.appendChild(el('div', { class: 'placeholder' },
    `${label} will populate in a later phase of the port.`,
  ));
  return panel;
}

function renderNotes(g, year, frac) {
  const notes = el('div', { class: 'notes-block' });

  notes.appendChild(note(
    boldLead('How to read this.'),
    ' Budgeted hours come from the budget table in the export; registered hours are what people have actually booked. The two cover different ground, so every comparison here uses project time only, with internal CICERO time and absence shown separately rather than folded in.',
  ));

  const unalloc = note(
    boldLead('Unallocated time.'),
    ' The export books unassigned group hours to a pseudo-employee, ',
    el('i', {}, UNALLOCATED_PERSON),
    ". Those hours are drawn hatched throughout and are never counted as a person's workload.",
  );
  notes.appendChild(unalloc);

  const seconds = g.second_groups();
  const secondPart = Object.keys(seconds).length
    ? ' Part of their time sits with another research group: ' +
      Object.entries(seconds)
        .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
        .map(([p, s]) => `${p} (${s.split(' / ').at(-1)})`)
        .join(', ') + '.'
    : '';
  notes.appendChild(note(
    boldLead('Dates.'),
    ' The export carries no timestamps, so progress is judged against a straight line: at ',
    state.as_of, `, ${pct(frac)} of ${year}'s working days have passed. Norwegian holiday leave is not spread evenly through the year, so an August reading will understate the summer months.`,
    secondPart,
  ));

  const excludedPart = g.excluded.length
    ? ' People outside the group appear in the export where projects are shared; ' +
      g.excluded.join(', ') + ' are filtered out by the group tag.'
    : '';
  notes.appendChild(note(
    boldLead('Who is counted.'),
    ' Membership comes from the group tag on each row rather than a list of names, so a new joiner or leaver needs no code change.',
    excludedPart,
    ` The billing standard of ${fmt(g.assumptions.billable_hours)} h is the project time expected from a full-time researcher in a year; the rest of the working year is internal time and absence, which is why the capacity rules apply to project hours only.`,
  ));

  return notes;
}

function renderFooter(g) {
  const foot = el('footer');
  foot.appendChild(document.createTextNode(
    `Generated ${todayISO()} · billing standard ${fmt(g.assumptions.billable_hours)} h per full-time year · figures are interactive: hover for values, click legend entries to isolate a series.`,
  ));
  return foot;
}

// -------------------------------------------------------- tab logic

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll('nav button'));
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.target)));
  window.addEventListener('hashchange', () => {
    const id = location.hash ? location.hash.slice(1) : TABS[0][0];
    if (TABS.some(([t]) => t === id)) showTab(id);
  });
  if (location.hash) {
    const id = location.hash.slice(1);
    if (TABS.some(([t]) => t === id)) showTab(id);
  }
}

function showTab(id) {
  const tabs = Array.from(document.querySelectorAll('nav button'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.target === id)));
  panels.forEach(p => p.setAttribute('data-active', String(p.id === id)));
  try { history.replaceState(null, '', '#' + id); } catch { /* file:// URLs */ }
}

function wireAsOf() {
  const input = document.getElementById('as-of');
  if (!input) return;
  input.addEventListener('change', () => {
    if (!input.value) return;
    state.as_of = input.value;
    // Reuse the same raw parse; only re-tidy and re-render.
    state.group = buildGroup(state.raw, {
      as_of: state.as_of, billable_hours: BILLABLE_HOURS_DEFAULT,
    });
    renderDashboard();
  });
}

// -------------------------------------------------------- helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k in node && typeof node[k] !== 'object') {
      try { node[k] = v; continue; } catch { /* fall through */ }
    }
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === '') continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function paragraph(...children) { return el('p', {}, ...children); }
function boldLead(text) { return el('b', {}, text); }
function note(...children) { return el('p', { class: 'note' }, ...children); }

function fmt(n) { return new Intl.NumberFormat('en-US').format(Math.round(n)); }
function pct(x) { return Math.round(x * 100) + '%'; }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
