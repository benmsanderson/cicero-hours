"""A what-if board for matching unallocated hours to researchers.

This is a planning aid for group meetings, not a system of record. Nothing is
written back to the finance system: the board holds a proposal in memory and
exports it as CSV or as text to paste into meeting notes. Refreshing the page
clears it, which is deliberate, because a half-remembered browser state is worse
than none when the numbers matter.
"""

from __future__ import annotations

import json

from .model import UNALLOCATED_PERSON, Group

BOARD_CSS = """
.board { margin-top: 18px; }
.board-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
                  margin-bottom: 18px; }
.seg { display: inline-flex; border: 1px solid var(--hairline); background: var(--card); }
.seg button { appearance: none; border: 0; background: none; font: inherit; font-size: 14px;
              padding: 7px 15px; cursor: pointer; color: var(--muted);
              border-right: 1px solid var(--hairline); }
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed="true"] { background: var(--teal); color: #fff; font-weight: 600; }
.board-controls .spacer { flex: 1; }
.btn { appearance: none; font: inherit; font-size: 13px; padding: 7px 13px; cursor: pointer;
       background: var(--card); border: 1px solid var(--hairline); color: var(--ink); }
.btn:hover { border-color: var(--teal); }
.btn.primary { background: var(--teal); color: #fff; border-color: var(--teal); }
.btn:focus-visible, .seg button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.board-grid { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; }
@media (max-width: 860px) { .board-grid { grid-template-columns: 1fr; } }

.pool, .person { background: var(--card); border: 1px solid var(--hairline); padding: 12px 13px; }
.pool { position: sticky; top: 56px; }
.pool h3, .person h3 { margin: 0 0 3px; font-size: 14px; font-weight: 650; }
.pool .sub, .person .sub { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
.pool.drop-hot, .person.drop-hot { border-color: var(--teal); box-shadow: inset 0 0 0 2px var(--teal); }

.people { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 14px; }

.bar { height: 12px; background: #EAEEF1; position: relative; margin: 8px 0 4px; overflow: hidden; }
.bar span { position: absolute; top: 0; bottom: 0; }
.bar .committed { left: 0; background: #A9B7C2; }
.bar .added { background: var(--teal); }
.bar .over { background: var(--alarm); }
.bar .target { width: 0; border-left: 2px dotted var(--alarm); background: none; z-index: 2; }
.numbers { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
           font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
.numbers .over-txt { color: var(--alarm); font-weight: 600; }
.numbers .free-txt { color: var(--teal); font-weight: 600; }

.chips { margin-top: 9px; display: flex; flex-direction: column; gap: 6px; min-height: 26px; }
.chip { border: 1px solid var(--hairline); background: #F7F9FA; padding: 6px 8px; cursor: grab;
        font-size: 13px; display: flex; gap: 8px; align-items: baseline; }
.chip:active { cursor: grabbing; }
.chip.unassigned { background: #FBF3E3; border-color: #E3CE9E; }
.chip[aria-selected="true"] { border-color: var(--teal); box-shadow: inset 0 0 0 1px var(--teal); }
.chip .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip .hrs { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
.chip .x { cursor: pointer; color: var(--muted); font-size: 15px; line-height: 1; }
.chip .x:hover { color: var(--alarm); }
.chip .split-btn { cursor: pointer; color: var(--muted); font-size: 11px; }
.chip .split-btn:hover { color: var(--teal); }
.splitter { display: flex; gap: 6px; padding: 6px 8px; border: 1px dashed var(--hairline);
            border-top: 0; background: #FBF3E3; }
.splitter input { width: 72px; font: inherit; font-size: 12px; padding: 3px 5px;
                  border: 1px solid var(--hairline); }
.empty { color: var(--muted); font-size: 12.5px; font-style: italic; }
.board-total { margin-top: 16px; padding: 12px 14px; background: var(--card);
               border: 1px solid var(--hairline); font-size: 13.5px; }
.board-total b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
#plan-text { width: 100%; height: 190px; margin-top: 12px; font-family: ui-monospace, monospace;
             font-size: 12px; padding: 10px; border: 1px solid var(--hairline); display: none; }
.hint { font-size: 12.5px; color: var(--muted); margin: 0 0 14px; max-width: 78ch; }
"""

BOARD_JS = """
(function () {
  const DATA = window.BOARD_DATA;
  if (!DATA) return;
  const target = DATA.billable_hours;
  let year = DATA.years.includes(DATA.default_year) ? DATA.default_year : DATA.years[0];
  let blocks = DATA.blocks.map(b => Object.assign({}, b));
  let selected = null;
  let splitting = null;

  const fmt = n => Math.round(n).toLocaleString('en-GB');
  const el = id => document.getElementById(id);

  function forYear() { return blocks.filter(b => b.year === year); }
  function committed(person) { return (DATA.committed[person] || {})[year] || 0; }
  function added(person) {
    return forYear().filter(b => b.owner === person).reduce((s, b) => s + b.hours, 0);
  }

  // A shared horizontal scale, so a filled bar means the same thing on every card.
  function scale() {
    const totals = DATA.people.map(p => committed(p) + added(p));
    return Math.max(target * 1.15, ...totals, 1);
  }

  function chip(b, inPool) {
    const wrap = document.createElement('div');
    const c = document.createElement('div');
    c.className = 'chip' + (inPool ? ' unassigned' : '');
    c.draggable = true;
    c.dataset.id = b.id;
    c.setAttribute('aria-selected', String(selected === b.id));
    c.title = b.project + ' · ' + fmt(b.hours) + ' h' + (b.pm ? ' · led by ' + b.pm : '');
    c.innerHTML =
      '<span class="name">' + b.project + '</span>' +
      '<span class="hrs">' + fmt(b.hours) + ' h</span>' +
      '<span class="split-btn" title="Split this block">split</span>' +
      (inPool ? '' : '<span class="x" title="Return to unassigned">\\u00d7</span>');

    c.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', b.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    c.addEventListener('click', e => {
      if (e.target.classList.contains('x')) { move(b.id, null); return; }
      if (e.target.classList.contains('split-btn')) {
        splitting = splitting === b.id ? null : b.id; render(); return;
      }
      selected = selected === b.id ? null : b.id;
      render();
    });
    wrap.appendChild(c);

    if (splitting === b.id) {
      const s = document.createElement('div');
      s.className = 'splitter';
      const half = Math.max(1, Math.round(b.hours / 2));
      s.innerHTML = '<input type="number" min="1" step="1" max="' + Math.floor(b.hours - 1) +
                    '" value="' + half + '" aria-label="Hours to split off">' +
                    '<button class="btn">Split off</button>';
      const input = s.querySelector('input');
      s.querySelector('button').addEventListener('click', () => doSplit(b.id, Number(input.value)));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') doSplit(b.id, Number(input.value)); });
      wrap.appendChild(s);
    }
    return wrap;
  }

  function doSplit(id, hours) {
    const b = blocks.find(x => x.id === id);
    if (!b || !(hours > 0) || hours >= b.hours) return;
    blocks.push({ id: b.id + '/' + Date.now(), project: b.project, year: b.year,
                  pm: b.pm, hours: hours, owner: b.owner });
    b.hours = b.hours - hours;
    splitting = null;
    render();
  }

  function move(id, owner) {
    const b = blocks.find(x => x.id === id);
    if (!b) return;
    b.owner = owner;
    selected = null;
    render();
  }

  function dropTarget(node, owner) {
    node.addEventListener('dragover', e => { e.preventDefault(); node.classList.add('drop-hot'); });
    node.addEventListener('dragleave', () => node.classList.remove('drop-hot'));
    node.addEventListener('drop', e => {
      e.preventDefault();
      node.classList.remove('drop-hot');
      move(e.dataTransfer.getData('text/plain'), owner);
    });
    // Click-to-place, for anyone who would rather not drag on a trackpad.
    node.addEventListener('click', e => {
      if (selected && !e.target.closest('.chip') && !e.target.closest('.splitter')) {
        move(selected, owner);
      }
    });
  }

  function render() {
    DATA.years.forEach(y => {
      const b = el('year-' + y);
      if (b) b.setAttribute('aria-pressed', String(y === year));
    });

    const pool = el('pool-chips');
    pool.innerHTML = '';
    const free = forYear().filter(b => b.owner === null).sort((a, b) => b.hours - a.hours);
    if (!free.length) {
      pool.innerHTML = '<div class="empty">Every hour has a name against it.</div>';
    } else {
      free.forEach(b => pool.appendChild(chip(b, true)));
    }
    const freeHours = free.reduce((s, b) => s + b.hours, 0);
    el('pool-sub').textContent = fmt(freeHours) + ' h still unassigned in ' + year;

    const grid = el('people-grid');
    grid.innerHTML = '';
    const sc = scale();
    DATA.people.forEach(person => {
      const com = committed(person), add = added(person), total = com + add;
      const card = document.createElement('div');
      card.className = 'person';
      const over = total > target;
      const second = DATA.second_groups[person];
      card.innerHTML =
        '<h3>' + person + '</h3>' +
        '<div class="sub">' + (second ? 'also in ' + second : '&nbsp;') + '</div>' +
        '<div class="bar">' +
          '<span class="committed" style="width:' + (Math.min(com, target) / sc * 100) + '%"></span>' +
          '<span class="added" style="left:' + (Math.min(com, target) / sc * 100) +
            '%;width:' + (Math.max(0, Math.min(total, target) - com) / sc * 100) + '%"></span>' +
          '<span class="over" style="left:' + (target / sc * 100) +
            '%;width:' + (Math.max(0, total - target) / sc * 100) + '%"></span>' +
          '<span class="target" style="left:' + (target / sc * 100) + '%"></span>' +
        '</div>' +
        '<div class="numbers"><span>' + fmt(total) + ' / ' + fmt(target) + ' h</span>' +
        (over ? '<span class="over-txt">' + fmt(total - target) + ' h over</span>'
              : '<span class="free-txt">' + fmt(target - total) + ' h free</span>') +
        '</div>' +
        '<div class="chips"></div>';
      const chips = card.querySelector('.chips');
      const mine = forYear().filter(b => b.owner === person);
      if (!mine.length) {
        chips.innerHTML = '<div class="empty">Drop hours here, or select a block and click.</div>';
      } else {
        mine.sort((a, b) => b.hours - a.hours).forEach(b => chips.appendChild(chip(b, false)));
      }
      dropTarget(card, person);
      grid.appendChild(card);
    });

    const assigned = forYear().filter(b => b.owner !== null).reduce((s, b) => s + b.hours, 0);
    const headroom = DATA.people.reduce(
      (s, p) => s + Math.max(0, target - committed(p) - added(p)), 0);
    el('board-total').innerHTML =
      '<b>' + fmt(freeHours) + ' h</b> unassigned in ' + year + ' · <b>' + fmt(assigned) +
      ' h</b> placed in this session · <b>' + fmt(headroom) +
      ' h</b> of headroom left across the group at the ' + fmt(target) + ' h standard.';

    const box = el('plan-text');
    if (box.style.display === 'block') box.value = planText();
  }

  function planText() {
    const rows = [['year', 'project', 'hours', 'assigned to']];
    blocks.slice().sort((a, b) => a.year - b.year || a.project.localeCompare(b.project))
      .forEach(b => rows.push([b.year, b.project, Math.round(b.hours),
                               b.owner || 'UNASSIGNED']));
    return rows.map(r => r.join('\\t')).join('\\n');
  }

  el('board-reset').addEventListener('click', () => {
    blocks = DATA.blocks.map(b => Object.assign({}, b));
    selected = null; splitting = null; render();
  });
  el('board-csv').addEventListener('click', () => {
    const csv = planText().split('\\n').map(r => r.split('\\t').join(',')).join('\\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'allocation_plan.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  el('board-show').addEventListener('click', () => {
    const box = el('plan-text');
    const open = box.style.display === 'block';
    box.style.display = open ? 'none' : 'block';
    el('board-show').textContent = open ? 'Show plan as text' : 'Hide plan';
    if (!open) { box.value = planText(); box.select(); }
  });
  DATA.years.forEach(y => {
    const b = el('year-' + y);
    if (b) b.addEventListener('click', () => { year = y; selected = null; splitting = null; render(); });
  });
  dropTarget(el('pool'), null);
  render();
})();
"""


def board_data(group: Group) -> dict:
    """Everything the board needs, as plain JSON."""
    project = group.budget[group.budget["category"] == "Project"]

    named = project[~project["unallocated"]]
    committed: dict[str, dict[str, float]] = {}
    for (person, year), hours in named.groupby(["person", "year"])["hours"].sum().items():
        committed.setdefault(str(person), {})[str(int(year))] = round(float(hours), 1)

    # Several budget lines can point at the same project and year. Merge them, then
    # let the user split blocks by hand, rather than showing four FUTURA cards.
    unalloc = project[project["unallocated"] & (project["hours"] > 0)]
    merged = unalloc.groupby(["project", "year"], as_index=False).agg(
        hours=("hours", "sum"), pm=("pm", lambda s: s.dropna().iloc[0] if s.notna().any() else None)
    )
    blocks = [
        {
            "id": f"{row.project}-{int(row.year)}",
            "project": str(row.project),
            "year": int(row.year),
            "hours": round(float(row.hours), 1),
            "pm": None if row.pm is None else str(row.pm),
            "owner": None,
        }
        for row in merged.itertuples(index=False)
    ]

    # Open the board on the year with the most unassigned time, which is the one
    # worth arguing about.
    by_year: dict[int, float] = {}
    for b in blocks:
        by_year[b["year"]] = by_year.get(b["year"], 0.0) + b["hours"]
    default_year = max(by_year, key=by_year.get) if by_year else group.reporting_year

    return {
        "years": [int(y) for y in group.years],
        "default_year": int(default_year),
        "people": group.people,
        "committed": {p: {int(y): h for y, h in d.items()} for p, d in committed.items()},
        "second_groups": {p: g.split(" / ")[-1] for p, g in group.second_groups().items()},
        "blocks": blocks,
        "billable_hours": group.assumptions.billable_hours,
        "unallocated_person": UNALLOCATED_PERSON,
    }


def board_html(group: Group) -> str:
    data = board_data(group)
    years = "".join(
        f'<button id="year-{y}" aria-pressed="false">{y}</button>' for y in data["years"]
    )
    target = data["billable_hours"]
    return f"""
<div class="board">
  <p class="hint">Drag a block of unassigned hours onto a researcher, or click it and then
  click a card. Split a block first if only part of it should go to one person. Grey is
  already budgeted, teal is what you have added here, red is past the
  {target:,.0f} h standard. Nothing is saved and nothing is written back to the budget
  system: export the plan before you close the page.</p>
  <div class="board-controls">
    <div class="seg" role="group" aria-label="Budget year">{years}</div>
    <span class="spacer"></span>
    <button class="btn" id="board-show">Show plan as text</button>
    <button class="btn" id="board-csv">Download CSV</button>
    <button class="btn" id="board-reset">Reset</button>
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
  <textarea id="plan-text" readonly aria-label="The plan as tab-separated text"></textarea>
</div>
<script>window.BOARD_DATA = {json.dumps(data)};</script>
"""
