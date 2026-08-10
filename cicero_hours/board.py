"""A what-if board for rebalancing project hours across a research group.

Every budgeted hour is a block, whether it already has a name against it or not,
so an oversubscribed researcher can hand work to a colleague as easily as spare
hours can be placed. Blocks move between people and to and from the unassigned
pool; they never move between years, because grant profiles fix when hours fall.

The billing standard is drawn as a guide, not a limit. Researchers legitimately
bill above and below it, so each card also carries that person's own current
rate, and passing the guide is shaded rather than alarmed.

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
                  margin-bottom: 16px; }
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
.btn:disabled { opacity: .45; cursor: default; border-color: var(--hairline); }
.btn:focus-visible, .seg button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.board-grid { display: grid; grid-template-columns: 302px 1fr; gap: 18px; align-items: start; }
@media (max-width: 900px) { .board-grid { grid-template-columns: 1fr; } }

.pool, .person { background: var(--card); border: 1px solid var(--hairline); padding: 12px 13px; }
.pool { position: sticky; top: 56px; max-height: calc(100vh - 90px); overflow-y: auto; }
.pool h3, .person h3 { margin: 0 0 2px; font-size: 14px; font-weight: 650; }
.pool .sub, .person .sub { font-size: 12px; color: var(--muted); }
.pool.drop-hot, .person.drop-hot { border-color: var(--teal); box-shadow: inset 0 0 0 2px var(--teal); }
.person.would-exceed { background: #FDF6F3; }
.person.would-exceed .bar { opacity: .75; }

.people { display: grid; grid-template-columns: repeat(auto-fill, minmax(272px, 1fr)); gap: 14px; }

.bar { height: 13px; background: #EAEEF1; position: relative; margin: 9px 0 5px; }
.bar span { position: absolute; top: 0; bottom: 0; }
.bar .fill.under { background: var(--teal); }
.bar .fill.above { background: #C98F2B; }
.bar .fill.far { background: var(--alarm); }
.bar .guide { width: 0; border-left: 2px dotted #7A8B99; z-index: 3; }
.bar .baseline { width: 0; border-left: 1px solid rgba(18,24,31,.45); z-index: 2; }
.numbers { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px;
           display: flex; justify-content: space-between; gap: 8px; }
.numbers .above-txt { color: #9A6B15; }
.numbers .far-txt { color: var(--alarm); font-weight: 600; }
.numbers .under-txt { color: var(--muted); }
.rate { font-size: 11.5px; color: var(--muted); margin-top: 3px; min-height: 15px; }
.rate .moved { color: var(--teal); font-weight: 600; }
.rate .moved.down { color: var(--alarm); }

.chips { margin-top: 9px; display: flex; flex-direction: column; gap: 6px; min-height: 26px;
         max-height: 260px; overflow-y: auto; }
.chip { border: 1px solid var(--hairline); background: #F7F9FA; padding: 6px 8px; cursor: grab;
        font-size: 13px; display: flex; gap: 8px; align-items: baseline; }
.chip:active { cursor: grabbing; }
.chip.unassigned { background: #FBF3E3; border-color: #E3CE9E; }
.chip.freed { background: #FFF; border-style: dashed; border-color: var(--teal); }
.chip.moved { border-left: 3px solid var(--teal); }
.chip[aria-selected="true"] { border-color: var(--teal); box-shadow: inset 0 0 0 1px var(--teal); }
.chip .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip .from { font-size: 11px; color: var(--muted); white-space: nowrap; }
.chip .hrs { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
.chip .x { cursor: pointer; color: var(--muted); font-size: 15px; line-height: 1; }
.chip .x:hover { color: var(--alarm); }
.chip .split-btn { cursor: pointer; color: var(--muted); font-size: 11px; }
.chip .split-btn:hover { color: var(--teal); }
.splitter { display: flex; gap: 6px; padding: 6px 8px; border: 1px dashed var(--hairline);
            border-top: 0; background: #F4F8F9; }
.splitter input { width: 74px; font: inherit; font-size: 12px; padding: 3px 5px;
                  border: 1px solid var(--hairline); }
.empty { color: var(--muted); font-size: 12.5px; font-style: italic; }

.board-total { margin-top: 16px; padding: 12px 14px; background: var(--card);
               border: 1px solid var(--hairline); font-size: 13.5px; }
.board-total b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.changes { margin-top: 12px; padding: 12px 14px; background: var(--card);
           border: 1px solid var(--hairline); }
.changes h3 { margin: 0 0 8px; font-size: 13px; font-weight: 650; }
.changes table { border-collapse: collapse; font-size: 13px; width: 100%; }
.changes td { padding: 3px 10px 3px 0; }
.changes td.n { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
                text-align: right; white-space: nowrap; }
.changes td.up { color: var(--teal); }
.changes td.down { color: var(--alarm); }
#plan-text { width: 100%; height: 210px; margin-top: 12px; font-family: ui-monospace, monospace;
             font-size: 12px; padding: 10px; border: 1px solid var(--hairline); display: none; }
.hint { font-size: 12.5px; color: var(--muted); margin: 0 0 14px; max-width: 80ch; }
.newperson { display: inline-flex; gap: 0; }
.newperson input { font: inherit; font-size: 13px; padding: 6px 9px; width: 150px;
                   border: 1px solid var(--hairline); border-right: 0; }
"""

BOARD_JS = """
(function () {
  const DATA = window.BOARD_DATA;
  if (!DATA) return;
  const guide = DATA.billable_hours;
  const FAR = 1.25;  // how far past the guide before the bar reads as a problem

  let year = DATA.years.includes(DATA.default_year) ? DATA.default_year : DATA.years[0];
  let blocks = clone(DATA.blocks);
  let extraPeople = [];
  let history = [];
  let selected = null;
  let splitting = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  const fmt = n => Math.round(n).toLocaleString('en-GB');
  const signed = n => (n > 0 ? '+' : '\\u2212') + fmt(Math.abs(n));
  const el = id => document.getElementById(id);

  function people() { return DATA.people.concat(extraPeople); }
  function forYear() { return blocks.filter(b => b.year === year); }
  function ownedBy(person) { return forYear().filter(b => b.owner === person); }
  function total(person) { return ownedBy(person).reduce((s, b) => s + b.hours, 0); }
  function baseline(person) { return (DATA.baseline[person] || {})[year] || 0; }

  function push() {
    history.push({ blocks: clone(blocks), extra: extraPeople.slice() });
    if (history.length > 60) history.shift();
  }

  // A shared horizontal scale, so a filled bar means the same thing on every card.
  function scale() {
    const totals = people().map(p => Math.max(total(p), baseline(p)));
    return Math.max(guide * FAR, ...totals, 1);
  }

  function chip(b, inPool) {
    const wrap = document.createElement('div');
    const c = document.createElement('div');
    const freed = inPool && b.origin !== null;
    const moved = !inPool && b.origin !== b.owner;
    c.className = 'chip' + (inPool ? (freed ? ' freed' : ' unassigned') : (moved ? ' moved' : ''));
    c.draggable = true;
    c.dataset.id = b.id;
    c.setAttribute('aria-selected', String(selected === b.id));
    c.title = b.project + ' \\u00b7 ' + fmt(b.hours) + ' h' +
              (b.pm ? ' \\u00b7 led by ' + b.pm : '') +
              (b.origin ? ' \\u00b7 originally ' + b.origin : ' \\u00b7 originally unassigned');
    c.innerHTML =
      '<span class="name">' + b.project + '</span>' +
      (freed ? '<span class="from">was ' + b.origin + '</span>' : '') +
      (moved ? '<span class="from">from ' + (b.origin || 'pool') + '</span>' : '') +
      '<span class="hrs">' + fmt(b.hours) + ' h</span>' +
      '<span class="split-btn" title="Split this block">split</span>' +
      (inPool ? '' : '<span class="x" title="Move to unassigned">\\u00d7</span>');

    c.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', b.id);
      e.dataTransfer.effectAllowed = 'move';
      markCapacity(b);
    });
    c.addEventListener('dragend', () => markCapacity(null));
    c.addEventListener('click', e => {
      if (e.target.classList.contains('x')) { move(b.id, null); return; }
      if (e.target.classList.contains('split-btn')) {
        splitting = splitting === b.id ? null : b.id; render(); return;
      }
      selected = selected === b.id ? null : b.id;
      render();
      markCapacity(selected ? b : null);
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
      const go = () => doSplit(b.id, Number(input.value));
      s.querySelector('button').addEventListener('click', go);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      wrap.appendChild(s);
    }
    return wrap;
  }

  // Shade the cards a block would push past the guide, before it is dropped.
  function markCapacity(b) {
    document.querySelectorAll('.person').forEach(card => {
      const person = card.dataset.person;
      const hot = b && b.owner !== person && (total(person) + b.hours) > guide;
      card.classList.toggle('would-exceed', Boolean(hot));
    });
  }

  function doSplit(id, hours) {
    const b = blocks.find(x => x.id === id);
    if (!b || !(hours > 0) || hours >= b.hours) return;
    push();
    blocks.push({ id: b.id + '/' + Date.now(), project: b.project, year: b.year, pm: b.pm,
                  hours: hours, owner: b.owner, origin: b.origin });
    b.hours = b.hours - hours;
    splitting = null;
    render();
  }

  function move(id, owner) {
    const b = blocks.find(x => x.id === id);
    if (!b || b.owner === owner) { selected = null; render(); return; }
    push();
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
      markCapacity(null);
      move(e.dataTransfer.getData('text/plain'), owner);
    });
    // Click-to-place, for anyone who would rather not drag on a trackpad.
    node.addEventListener('click', e => {
      if (selected && !e.target.closest('.chip') && !e.target.closest('.splitter')) {
        move(selected, owner);
      }
    });
  }

  function personCard(person, sc) {
    const now = total(person), was = baseline(person);
    const card = document.createElement('div');
    card.className = 'person';
    card.dataset.person = person;

    const state = now > guide * FAR ? 'far' : (now > guide ? 'above' : 'under');
    const diff = now - guide;
    const rate = DATA.rate[person];
    const second = DATA.second_groups[person];
    const delta = now - was;

    const bits = [];
    if (second) bits.push('also in ' + second);
    if (rate) bits.push('billing ~' + fmt(rate) + ' h/yr at current pace');

    card.innerHTML =
      '<h3>' + person + '</h3>' +
      '<div class="sub">' + (bits.length ? bits.join(' \\u00b7 ') : '&nbsp;') + '</div>' +
      '<div class="bar">' +
        '<span class="fill ' + state + '" style="left:0;width:' + (now / sc * 100) + '%"></span>' +
        (was > 0 ? '<span class="baseline" style="left:' + (was / sc * 100) + '%"></span>' : '') +
        '<span class="guide" style="left:' + (guide / sc * 100) + '%"></span>' +
      '</div>' +
      '<div class="numbers"><span>' + fmt(now) + ' h planned</span>' +
        '<span class="' + state + '-txt">' +
        (diff >= 0 ? signed(diff) + ' h vs guide' : fmt(-diff) + ' h under guide') +
        '</span></div>' +
      '<div class="rate">' +
        (Math.round(delta) !== 0
          ? '<span class="moved' + (delta < 0 ? ' down' : '') + '">' + signed(delta) +
            ' h</span> against a baseline of ' + fmt(was) + ' h'
          : 'unchanged from baseline') +
      '</div>' +
      '<div class="chips"></div>';

    const chips = card.querySelector('.chips');
    const mine = ownedBy(person).sort((a, b) => b.hours - a.hours);
    if (!mine.length) {
      chips.innerHTML = '<div class="empty">Drop hours here, or select a block and click.</div>';
    } else {
      mine.forEach(b => chips.appendChild(chip(b, false)));
    }
    dropTarget(card, person);
    return card;
  }

  function render() {
    DATA.years.forEach(y => {
      const b = el('year-' + y);
      if (b) b.setAttribute('aria-pressed', String(y === year));
    });
    el('board-undo').disabled = history.length === 0;

    const pool = el('pool-chips');
    pool.innerHTML = '';
    const free = forYear().filter(b => b.owner === null).sort((a, b) => b.hours - a.hours);
    if (!free.length) {
      pool.innerHTML = '<div class="empty">Every hour has a name against it.</div>';
    } else {
      free.forEach(b => pool.appendChild(chip(b, true)));
    }
    const freeHours = free.reduce((s, b) => s + b.hours, 0);
    const freedHours = free.filter(b => b.origin !== null).reduce((s, b) => s + b.hours, 0);
    el('pool-sub').textContent = fmt(freeHours) + ' h unassigned in ' + year +
      (freedHours > 0 ? ', of which ' + fmt(freedHours) + ' h freed here' : '');

    const grid = el('people-grid');
    grid.innerHTML = '';
    const sc = scale();
    people()
      .slice()
      .sort((a, b) => baseline(b) - baseline(a) || a.localeCompare(b))
      .forEach(p => grid.appendChild(personCard(p, sc)));

    renderChanges();

    const overGuide = people().filter(p => total(p) > guide).length;
    el('board-total').innerHTML =
      '<b>' + fmt(freeHours) + ' h</b> unassigned in ' + year + ' \\u00b7 <b>' + overGuide +
      '</b> of ' + people().length + ' researchers above the ' + fmt(guide) +
      ' h guide \\u00b7 <b>' + fmt(people().reduce((s, p) => s + total(p), 0)) +
      ' h</b> planned in total.';

    const box = el('plan-text');
    if (box.style.display === 'block') box.value = planText();
  }

  function changedPeople() {
    const rows = [];
    people().forEach(p => {
      const d = total(p) - baseline(p);
      if (Math.round(d) !== 0) rows.push({ person: p, was: baseline(p), now: total(p), delta: d });
    });
    const poolNow = forYear().filter(b => b.owner === null).reduce((s, b) => s + b.hours, 0);
    const poolWas = DATA.blocks
      .filter(b => b.year === year && b.origin === null)
      .reduce((s, b) => s + b.hours, 0);
    if (Math.round(poolNow - poolWas) !== 0) {
      rows.push({ person: 'Unassigned', was: poolWas, now: poolNow, delta: poolNow - poolWas });
    }
    return rows.sort((a, b) => b.delta - a.delta);
  }

  function renderChanges() {
    const rows = changedPeople();
    const box = el('board-changes');
    if (!rows.length) {
      box.innerHTML = '<h3>Changes in ' + year + '</h3>' +
                      '<div class="empty">Nothing moved yet.</div>';
      return;
    }
    box.innerHTML = '<h3>Changes in ' + year + '</h3><table><tbody>' +
      rows.map(r =>
        '<tr><td>' + r.person + '</td>' +
        '<td class="n ' + (r.delta > 0 ? 'up' : 'down') + '">' + signed(r.delta) + ' h</td>' +
        '<td class="n">' + fmt(r.was) + ' \\u2192 ' + fmt(r.now) + ' h</td></tr>'
      ).join('') + '</tbody></table>';
  }

  function planText() {
    const changed = changedPeople();
    const lines = ['Proposed reallocation, ' + year,
                   '', 'Change by person', 'person\\twas\\tnow\\tchange'];
    changed.forEach(r =>
      lines.push([r.person, Math.round(r.was), Math.round(r.now), signed(r.delta)].join('\\t')));
    if (!changed.length) lines.push('(nothing moved)');
    lines.push('', 'Blocks', 'year\\tproject\\thours\\toriginally\\tnow');
    blocks.slice()
      .sort((a, b) => a.year - b.year || a.project.localeCompare(b.project))
      .forEach(b => lines.push([b.year, b.project, Math.round(b.hours),
                                b.origin || 'unassigned', b.owner || 'unassigned'].join('\\t')));
    return lines.join('\\n');
  }

  function csvText() {
    const rows = [['year', 'project', 'hours', 'originally', 'now']];
    blocks.slice()
      .sort((a, b) => a.year - b.year || a.project.localeCompare(b.project))
      .forEach(b => rows.push([b.year, b.project, Math.round(b.hours),
                               b.origin || 'unassigned', b.owner || 'unassigned']));
    return rows
      .map(r => r.map(v => /[",]/.test(String(v)) ? '"' + v + '"' : v).join(','))
      .join('\\n');
  }

  el('board-undo').addEventListener('click', () => {
    const prev = history.pop();
    if (!prev) return;
    blocks = prev.blocks;
    extraPeople = prev.extra;
    selected = null; splitting = null;
    render();
  });
  el('board-reset').addEventListener('click', () => {
    blocks = clone(DATA.blocks);
    extraPeople = [];
    history = []; selected = null; splitting = null;
    render();
  });
  el('board-add').addEventListener('click', () => {
    const input = el('board-newname');
    const name = (input.value || '').trim() || 'New researcher ' + (extraPeople.length + 1);
    if (people().includes(name)) return;
    push();
    extraPeople.push(name);
    input.value = '';
    render();
  });
  el('board-csv').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv' }));
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
    if (b) b.addEventListener('click', () => {
      year = y; selected = null; splitting = null; render();
    });
  });
  dropTarget(el('pool'), null);
  render();
})();
"""


def board_data(group: Group) -> dict:
    """Everything the board needs, as plain JSON.

    Every project budget line becomes a block. Named lines start owned by that
    person, unallocated lines start in the pool, and `origin` records where each
    began so the board can show what has moved.
    """
    project = group.budget[group.budget["category"] == "Project"]
    project = project[project["hours"] > 0]

    # Several budget lines can point at the same person, project and year. Merge
    # them, then let the user split by hand, rather than showing four FUTURA cards.
    merged = project.groupby(["person", "project", "year"], as_index=False).agg(
        hours=("hours", "sum"),
        pm=("pm", lambda s: s.dropna().iloc[0] if s.notna().any() else None),
        unallocated=("unallocated", "first"),
    )

    blocks = []
    for row in merged.itertuples(index=False):
        owner = None if row.unallocated else str(row.person)
        blocks.append({
            "id": f"{owner or '~pool'}|{row.project}|{int(row.year)}",
            "project": str(row.project),
            "year": int(row.year),
            "hours": round(float(row.hours), 1),
            "pm": None if row.pm is None else str(row.pm),
            "owner": owner,
            "origin": owner,
        })

    baseline: dict[str, dict[int, float]] = {}
    for b in blocks:
        if b["origin"] is not None:
            per_person = baseline.setdefault(b["origin"], {})
            per_person[b["year"]] = round(per_person.get(b["year"], 0.0) + b["hours"], 1)

    # Each person's own billing rate, annualised from what they have booked so
    # far. Researchers legitimately bill above and below the standard, so this
    # sits on the card next to it as a second, personal reference.
    year = group.reporting_year
    frac = group.assumptions.year_fraction(year)
    rate: dict[str, float] = {}
    if frac > 0.15:
        booked = group.person_summary(year)["Project"]
        rate = {str(p): round(float(h) / frac, -1) for p, h in booked.items() if h > 0}

    unassigned_by_year: dict[int, float] = {}
    for b in blocks:
        if b["origin"] is None:
            unassigned_by_year[b["year"]] = unassigned_by_year.get(b["year"], 0.0) + b["hours"]
    default_year = (
        max(unassigned_by_year, key=unassigned_by_year.get)
        if unassigned_by_year else group.reporting_year
    )

    return {
        "years": [int(y) for y in group.years],
        "default_year": int(default_year),
        "people": group.people,
        "baseline": baseline,
        "rate": rate,
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
    guide = data["billable_hours"]
    return f"""
<div class="board">
  <p class="hint">Every budgeted hour is a block here, including hours that already have a
  name against them. Drag one onto another researcher, or click it and then click a card;
  split a block first if only part of it should move. The × sends a block back to
  unassigned. Hours never move between years, since grant profiles fix when they fall.
  The {guide:,.0f} h line is a guide rather than a limit, so each card also shows that
  person's own current billing rate, and the thin vertical mark is where they started.
  Nothing is saved and nothing is written back to the budget system: export the plan
  before you close the page.</p>
  <div class="board-controls">
    <div class="seg" role="group" aria-label="Budget year">{years}</div>
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
  <textarea id="plan-text" readonly aria-label="The plan as tab-separated text"></textarea>
</div>
<script>window.BOARD_DATA = {json.dumps(data)};</script>
"""
