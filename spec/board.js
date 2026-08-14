// Interactive allocation board. Ported unchanged from cicero_hours/board.py's
// BOARD_JS other than the entry-point wrapper below and the bootstrap at the
// bottom. The Python build sets window.BOARD_DATA and lets this script self-run;
// the browser build imports the file (for the side effect that registers this
// function on window) and calls it directly with the payload.
//
// Node imports it too (transitively through web/src/board.js) when the
// cross-check test only wants boardData; the runtime is browser-only, so
// bail out cleanly if there is no window rather than throwing at parse time.

if (typeof window === 'undefined') { /* Node import; nothing to do here */ } else {

window.__cicero_boardInit = function initBoard(DATA) {
  if (!DATA) return;
  const guide = DATA.billable_hours;
  const FAR = 1.25;  // how far past the guide before the bar reads as a problem

  let year = DATA.years.includes(DATA.default_year) ? DATA.default_year : DATA.years[0];
  let blocks = clone(DATA.blocks);
  let extraPeople = [];
  let history = [];
  let selected = null;
  let splitting = null;
  let deferring = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  const fmt = n => Math.round(n).toLocaleString('en-GB');
  const signed = n => (n > 0 ? '+' : '\u2212') + fmt(Math.abs(n));
  const el = id => document.getElementById(id);

  // The year argument defaults to the year the board is showing; the plan file
  // and the chart pass one explicitly, because both look across all years.
  function people() { return DATA.people.concat(extraPeople); }
  function forYear(y) { return blocks.filter(b => b.year === (y === undefined ? year : y)); }
  function ownedBy(person, y) { return forYear(y).filter(b => b.owner === person); }
  function total(person, y) { return ownedBy(person, y).reduce((s, b) => s + b.hours, 0); }
  function baseline(person, y) {
    return (DATA.baseline[person] || {})[y === undefined ? year : y] || 0;
  }

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
    const deferred = b.year !== b.oyear;
    c.className = 'chip' + (inPool ? (freed ? ' freed' : ' unassigned') : (moved ? ' moved' : '')) +
                  (deferred ? ' deferred' : '');
    c.draggable = true;
    c.dataset.id = b.id;
    c.setAttribute('aria-selected', String(selected === b.id));
    c.title = b.project + ' \u00b7 ' + fmt(b.hours) + ' h' +
              (b.pm ? ' \u00b7 led by ' + b.pm : '') +
              (b.origin ? ' \u00b7 originally ' + b.origin : ' \u00b7 originally unassigned') +
              (deferred ? ' \u00b7 deferred from ' + b.oyear : '');
    c.innerHTML =
      '<span class="name">' + b.project + '</span>' +
      (freed ? '<span class="from">was ' + b.origin + '</span>' : '') +
      (moved ? '<span class="from">from ' + (b.origin || 'pool') + '</span>' : '') +
      (deferred ? '<span class="from defer">from ' + b.oyear + '</span>' : '') +
      '<span class="hrs">' + fmt(b.hours) + ' h</span>' +
      '<span class="split-btn" title="Split this block">split</span>' +
      '<span class="defer-btn" title="Move to a later year of this project">defer</span>' +
      (inPool ? '' : '<span class="x" title="Move to unassigned">\u00d7</span>');

    c.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', b.id);
      e.dataTransfer.effectAllowed = 'move';
      markCapacity(b);
    });
    c.addEventListener('dragend', () => markCapacity(null));
    c.addEventListener('click', e => {
      if (e.target.classList.contains('x')) { move(b.id, null); return; }
      if (e.target.classList.contains('split-btn')) {
        splitting = splitting === b.id ? null : b.id; deferring = null; render(); return;
      }
      if (e.target.classList.contains('defer-btn')) {
        deferring = deferring === b.id ? null : b.id; splitting = null; render(); return;
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

    if (deferring === b.id) wrap.appendChild(deferPanel(b));
    return wrap;
  }

  // Hours can be pushed to a later year of the same project, never pulled earlier
  // than they were budgeted, and never moved to another project.
  function deferPanel(b) {
    const d = document.createElement('div');
    d.className = 'deferrer';
    const options = DATA.years.filter(y => y >= b.oyear && y !== b.year);
    if (!options.length) {
      d.innerHTML = '<span>No later year for ' + b.project + ' in this budget.</span>';
      return d;
    }
    const funded = DATA.project_years[b.project] || [];
    d.innerHTML = '<span>Move these ' + fmt(b.hours) + ' h to:</span><div class="years"></div>';
    const row = d.querySelector('.years');
    options.forEach(y => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = y === b.oyear ? y + ' (back)' : y;
      btn.addEventListener('click', () => defer(b.id, y));
      row.appendChild(btn);
    });
    const unfunded = options.filter(y => !funded.includes(y) && y !== b.oyear);
    if (unfunded.length) {
      // Appended as a node: innerHTML += here would re-parse the panel and drop
      // the click listeners just attached to the year buttons.
      const caution = document.createElement('span');
      caution.className = 'caution';
      caution.textContent = b.project + ' has no budget in ' + unfunded.join(', ') +
                            ' — check the project actually runs that long.';
      d.appendChild(caution);
    }
    return d;
  }

  function defer(id, targetYear) {
    const b = blocks.find(x => x.id === id);
    if (!b || targetYear < b.oyear || targetYear === b.year) return;
    push();
    b.year = targetYear;
    deferring = null;
    selected = null;
    render();
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
                  hours: hours, owner: b.owner, origin: b.origin, oyear: b.oyear });
    b.hours = b.hours - hours;
    splitting = null;
    render();
  }

  function move(id, owner) {
    const b = blocks.find(x => x.id === id);
    if (!b || b.owner === owner) { selected = null; deferring = null; render(); return; }
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
      '<div class="sub">' + (bits.length ? bits.join(' \u00b7 ') : '&nbsp;') + '</div>' +
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
      const btn = el('year-' + y);
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(y === year));
      const into = blocks.filter(b => b.year === y && b.oyear !== y)
                         .reduce((s, b) => s + b.hours, 0);
      const out = blocks.filter(b => b.oyear === y && b.year !== y)
                        .reduce((s, b) => s + b.hours, 0);
      const net = into - out;
      btn.querySelector('.badge').textContent = Math.round(net) === 0 ? '' : signed(net) + ' h';
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
    renderDeferrals();

    const overGuide = people().filter(p => total(p) > guide).length;
    el('board-total').innerHTML =
      '<b>' + fmt(freeHours) + ' h</b> unassigned in ' + year + ' \u00b7 <b>' + overGuide +
      '</b> of ' + people().length + ' researchers above the ' + fmt(guide) +
      ' h guide \u00b7 <b>' + fmt(people().reduce((s, p) => s + total(p), 0)) +
      ' h</b> planned in total.';

    const box = el('plan-text');
    if (box.style.display === 'block') box.value = planText();

    const ysel = el('chart-year');
    if (ysel) ysel.options[0].textContent = 'Board year (' + year + ')';
    drawChart();
    scheduleSave();
  }

  function changedPeople(y) {
    if (y === undefined) y = year;
    const rows = [];
    people().forEach(p => {
      const d = total(p, y) - baseline(p, y);
      if (Math.round(d) !== 0) {
        rows.push({ person: p, was: baseline(p, y), now: total(p, y), delta: d });
      }
    });
    const poolNow = forYear(y).filter(b => b.owner === null).reduce((s, b) => s + b.hours, 0);
    const poolWas = DATA.blocks
      .filter(b => b.year === y && b.origin === null)
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
        '<td class="n">' + fmt(r.was) + ' \u2192 ' + fmt(r.now) + ' h</td></tr>'
      ).join('') + '</tbody></table>';
  }

  function deferrals() {
    return blocks
      .filter(b => b.year !== b.oyear)
      .map(b => ({ project: b.project, hours: b.hours, from: b.oyear, to: b.year,
                   owner: b.owner || 'unassigned' }))
      .sort((a, b) => a.project.localeCompare(b.project) || a.from - b.from);
  }

  function renderDeferrals() {
    const rows = deferrals();
    const box = el('board-defers');
    if (!rows.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const hrs = rows.reduce((s, r) => s + r.hours, 0);
    box.innerHTML =
      '<h3>Deferred to a later year · ' + fmt(hrs) + ' h</h3>' +
      '<p class="why">Moving hours between years changes the spending profile, so each of ' +
      'these needs NFR approval before it is real. This list is the request.</p>' +
      '<table><tbody>' +
      rows.map(r =>
        '<tr><td>' + r.project + '</td><td class="n">' + fmt(r.hours) + ' h</td>' +
        '<td class="n">' + r.from + ' → ' + r.to + '</td>' +
        '<td>' + r.owner + '</td></tr>').join('') +
      '</tbody></table>';
  }

  // -------------------------------------------------------------------- chart
  // The same shape as "Hours budgeted per person" on the People tab, but drawn
  // from the proposal rather than the export and redrawn on every move, so what
  // a reallocation does to the group is visible while it is being made.

  const POOL_ROW = 'Unassigned';
  const CHART_TOP_N = 6;
  const ROLLUP_COLOUR = '#B9C2C9';
  const CHART_CONFIG = { displaylogo: false, responsive: true,
                         modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] };
  const CHART_FONT = { family: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                       size: 13, color: '#12181F' };

  function shorten(s, w) { return s.length <= w ? s : s.slice(0, w - 1) + '\u2026'; }

  function chartYears() {
    const sel = el('chart-year');
    const v = sel ? sel.value : 'follow';
    if (v === 'all') return DATA.years.slice();
    if (v === 'follow' || !DATA.years.includes(Number(v))) return [year];
    return [Number(v)];
  }

  // person -> project -> proposed hours, with the pool as a row of its own so
  // the chart shows it draining as blocks are placed.
  function chartRows(years) {
    const rows = new Map([[POOL_ROW, new Map()]]);
    people().forEach(p => rows.set(p, new Map()));
    blocks.forEach(b => {
      if (!years.includes(b.year)) return;
      const key = b.owner === null ? POOL_ROW : b.owner;
      if (!rows.has(key)) rows.set(key, new Map());
      const m = rows.get(key);
      m.set(b.project, (m.get(b.project) || 0) + b.hours);
    });
    // Largest few projects each and the rest pooled, as the People tab does: a
    // dozen slivers in one bar cannot be read at this height.
    rows.forEach((m, person) => {
      const sorted = Array.from(m).sort((a, b) => b[1] - a[1]);
      if (sorted.length <= CHART_TOP_N + 1) return;
      const tail = sorted.slice(CHART_TOP_N);
      rows.set(person, new Map(sorted.slice(0, CHART_TOP_N).concat(
        [['Other (' + tail.length + ')', tail.reduce((s, e) => s + e[1], 0)]])));
    });
    return rows;
  }

  function baselineFor(person, years) {
    return DATA.blocks
      .filter(b => years.includes(b.oyear) &&
                   (person === POOL_ROW ? b.origin === null : b.origin === person))
      .reduce((s, b) => s + b.hours, 0);
  }

  function chartFigure() {
    const years = chartYears();
    const rows = chartRows(years);
    const now = new Map(), was = new Map();
    rows.forEach((m, p) => {
      now.set(p, Array.from(m.values()).reduce((s, v) => s + v, 0));
      was.set(p, baselineFor(p, years));
    });
    // Someone emptied by the proposal still belongs on the chart; that is the
    // change worth seeing. The pool stays even at zero, which is the good case.
    const order = Array.from(rows.keys())
      .filter(p => p === POOL_ROW || now.get(p) > 0 || was.get(p) > 0)
      .sort((a, b) => (a === POOL_ROW ? -1 : b === POOL_ROW ? 1
                       : Math.max(now.get(a), was.get(a)) - Math.max(now.get(b), was.get(b))));
    const sel = el('chart-view');
    const view = sel ? sel.value : 'projects';
    return {
      view: view, years: years, order: order, now: now, was: was,
      traces: view === 'baseline' ? baselineTraces(order, was, now) : projectTraces(order, rows),
    };
  }

  function projectTraces(order, rows) {
    const totals = new Map();
    rows.forEach(m => m.forEach((h, proj) => totals.set(proj, (totals.get(proj) || 0) + h)));
    const hatch = order.map(p => (p === POOL_ROW ? '/' : ''));
    return Array.from(totals.keys())
      .sort((a, b) => totals.get(b) - totals.get(a))
      .map(proj => {
        const rollup = proj.indexOf('Other (') === 0;
        const colour = rollup ? ROLLUP_COLOUR : (DATA.project_colour[proj] || '#8899A6');
        return {
          type: 'bar', orientation: 'h', name: proj, y: order,
          x: order.map(p => rows.get(p).get(proj) || 0),
          // bgcolor has to be given: a per-point shape array does not inherit
          // marker.color the way a single shape does, and the pool row would
          // otherwise be drawn white on white.
          marker: { color: colour,
                    pattern: { shape: hatch, bgcolor: colour, fgcolor: '#FFFFFF', size: 6 } },
          text: order.map(() => shorten(proj, 22)),
          textposition: 'inside', insidetextanchor: 'middle', textangle: 0,
          constraintext: 'inside', showlegend: false,
          insidetextfont: { color: rollup ? '#12181F' : '#FFFFFF', size: 11 },
          hovertemplate: '%{y}<br>' + proj + ': %{x:,.0f} h<extra></extra>',
        };
      });
  }

  function baselineTraces(order, was, now) {
    return [
      { type: 'bar', orientation: 'h', name: 'Budgeted', y: order,
        x: order.map(p => was.get(p)), marker: { color: '#A9B7C2' },
        hovertemplate: '%{y}<br>budgeted: %{x:,.0f} h<extra></extra>' },
      { type: 'bar', orientation: 'h', name: 'Proposed', y: order,
        x: order.map(p => now.get(p)), marker: { color: '#1F5F6B' },
        hovertemplate: '%{y}<br>proposed: %{x:,.0f} h<extra></extra>' },
    ];
  }

  function chartLayout(f) {
    // Over several years the guide is that many billing years, so the rule
    // still means the same thing: hours to the right of it are over the standard.
    const cap = guide * f.years.length;
    const span = f.years.length > 1
      ? f.years[0] + '\u2013' + f.years[f.years.length - 1]
      : String(f.years[0]);
    const sub = f.view === 'baseline'
      ? 'Where the budget put the hours, against where this proposal puts them.'
      : 'Largest ' + CHART_TOP_N + ' projects each, the rest pooled in grey. The hatched ' +
        'row is hours still waiting for a name.';
    return {
      barmode: f.view === 'baseline' ? 'group' : 'stack',
      font: CHART_FONT,
      height: Math.max(320, 30 * f.order.length + 150),
      margin: { l: 10, r: 20, t: 74, b: 44 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      hoverlabel: { font_size: 12 },
      uniformtext: { mode: 'hide', minsize: 9 },
      showlegend: f.view === 'baseline',
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.0, xanchor: 'right', x: 1,
                font: { size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
      title: { text: '<b>Proposed hours per person, ' + span + '</b><br>' +
                     '<span style="font-size:12px;color:#6A7683">' + sub + '</span>',
               x: 0, xanchor: 'left', font: { size: 16 } },
      xaxis: { title: { text: 'hours' }, gridcolor: '#D3D9DE', zerolinecolor: '#D3D9DE',
               linecolor: '#D3D9DE' },
      yaxis: { type: 'category', categoryorder: 'array', categoryarray: f.order,
               gridcolor: '#D3D9DE', zerolinecolor: '#D3D9DE', linecolor: '#D3D9DE',
               tickfont: { size: 11 }, automargin: true },
      shapes: [
        { type: 'rect', xref: 'x', yref: 'paper', x0: cap, x1: cap * 2.2, y0: 0, y1: 1,
          fillcolor: 'rgba(199, 90, 60, 0.07)', line: { width: 0 }, layer: 'below' },
        { type: 'line', xref: 'x', yref: 'paper', x0: cap, x1: cap, y0: 0, y1: 1,
          line: { color: '#C75A3C', width: 1.4, dash: 'dot' } },
      ],
      annotations: [
        { x: cap, y: 1, xref: 'x', yref: 'paper', showarrow: false,
          xanchor: 'left', yanchor: 'bottom', font: { size: 11, color: '#C75A3C' },
          text: fmt(cap) + ' h' + (f.years.length > 1
            ? ' \u00b7 ' + f.years.length + ' years at the standard' : ' billing standard') },
      ],
    };
  }

  function drawChart() {
    const node = el('board-chart-plot');
    if (!node || typeof Plotly === 'undefined') return;
    if (el('board-chart').classList.contains('hidden')) return;
    const f = chartFigure();
    Plotly.react(node, f.traces, chartLayout(f), CHART_CONFIG);
  }

  // --------------------------------------------------------------- exports

  function changeLines(y) {
    const rows = changedPeople(y);
    const lines = ['Change by person, ' + y, 'person\twas\tnow\tchange'];
    if (!rows.length) lines.push('(nothing moved)');
    rows.forEach(r =>
      lines.push([r.person, Math.round(r.was), Math.round(r.now), signed(r.delta)].join('\t')));
    return lines;
  }

  function deferralLines() {
    const rows = deferrals();
    const lines = ['Deferred to a later year (needs NFR approval)',
                   'project\thours\tfrom\tto\theld by'];
    if (!rows.length) lines.push('(none)');
    rows.forEach(r => lines.push([r.project, Math.round(r.hours), r.from, r.to,
                                  r.owner].join('\t')));
    return lines;
  }

  function blockLines() {
    const lines = ['Blocks', 'project\thours\tbudget year\tnow in\toriginally\tnow'];
    blocks.slice()
      .sort((a, b) => a.project.localeCompare(b.project) || a.year - b.year)
      .forEach(b => lines.push([b.project, Math.round(b.hours), b.oyear, b.year,
                                b.origin || 'unassigned',
                                b.owner || 'unassigned'].join('\t')));
    return lines;
  }

  function planText() {
    return ['Proposed reallocation, ' + year, '']
      .concat(changeLines(year), [''], deferralLines(), [''], blockLines())
      .join('\n');
  }

  function csvText() {
    const rows = [['project', 'hours', 'budget_year', 'planned_year',
                   'originally', 'now', 'deferred']];
    blocks.slice()
      .sort((a, b) => a.project.localeCompare(b.project) || a.year - b.year)
      .forEach(b => rows.push([b.project, Math.round(b.hours), b.oyear, b.year,
                               b.origin || 'unassigned', b.owner || 'unassigned',
                               b.year !== b.oyear ? 'yes' : 'no']));
    return rows
      .map(r => r.map(v => /[",]/.test(String(v)) ? '"' + v + '"' : v).join(','))
      .join('\n');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ----------------------------------------------------------- the plan file
  // A reallocation rarely finishes in one sitting. The user names a file once,
  // the page keeps it up to date from then on, and opening it in a later
  // session picks the proposal up where it was left. Everything above the
  // marker is for people to read; the line below it is what the board reloads.

  const STATE_MARKER = '# board state \u2014 keep this line and the one after it';
  const canWriteFiles = typeof window.showSaveFilePicker === 'function' &&
                        typeof window.showOpenFilePicker === 'function';
  const FILE_TYPES = [{ description: 'Allocation plan', accept: { 'text/plain': ['.txt'] } }];
  let planFile = null;
  let saveTimer = null;
  let savedSignature = null;

  function status(msg) { const s = el('board-save-status'); if (s) s.textContent = msg; }
  function warn(msg) { const w = el('board-save-warn'); if (w) w.textContent = msg || ''; }
  function stamp() { return new Date().toISOString().slice(0, 16).replace('T', ' '); }

  function planFileText() {
    const head = [
      'CICERO hours \u00b7 proposed reallocation',
      'Saved ' + stamp() + ' UTC \u00b7 guide ' + fmt(guide) + ' h per full-time year ' +
        '\u00b7 export ' + DATA.fingerprint,
      'Open the allocation board in the dashboard and use "Open plan file" to carry on.',
    ];
    const moved = DATA.years.filter(y => changedPeople(y).length);
    let lines = head;
    moved.forEach(y => { lines = lines.concat([''], changeLines(y)); });
    if (!moved.length) lines = lines.concat(['', 'Nothing has been moved yet.']);
    lines = lines.concat([''], deferralLines(), [''], blockLines());
    lines = lines.concat(['', STATE_MARKER, JSON.stringify({
      v: 1,
      saved: new Date().toISOString(),
      fingerprint: DATA.fingerprint,
      year: year,
      extra_people: extraPeople.slice(),
      blocks: blocks,
    })]);
    return lines.join('\n') + '\n';
  }

  function parsePlanFile(text) {
    const at = text.indexOf(STATE_MARKER);
    if (at < 0) throw new Error('no board state in that file');
    const state = JSON.parse(text.slice(at + STATE_MARKER.length));
    if (!state || !Array.isArray(state.blocks) || !state.blocks.length) {
      throw new Error('that file carries no blocks');
    }
    return state;
  }

  // Returns a warning to show, or '' if the file matches the export in the page.
  function applyPlan(state) {
    push();
    blocks = state.blocks.map((b, i) => ({
      id: String(b.id === undefined ? 'loaded/' + i : b.id),
      project: String(b.project),
      year: Number(b.year),
      oyear: Number(b.oyear),
      hours: Number(b.hours),
      pm: b.pm === undefined ? null : b.pm,
      owner: b.owner === undefined ? null : b.owner,
      origin: b.origin === undefined ? null : b.origin,
    }));
    extraPeople = (Array.isArray(state.extra_people) ? state.extra_people : [])
      .filter(p => !DATA.people.includes(p));
    // Hours held by someone this export does not know about would otherwise
    // disappear from the board while still sitting in the plan. Give them a card.
    const known = people();
    blocks.forEach(b => {
      if (b.owner && !known.includes(b.owner)) { extraPeople.push(b.owner); known.push(b.owner); }
    });
    if (DATA.years.includes(state.year)) year = state.year;
    selected = null; splitting = null; deferring = null;
    render();
    return state.fingerprint && state.fingerprint !== DATA.fingerprint
      ? 'This plan was saved against a different export (' + state.fingerprint + ', now ' +
        DATA.fingerprint + '). The blocks come from the file, so it and the rest of the ' +
        'dashboard may not line up.'
      : '';
  }

  // What is worth writing: the blocks and the cards, not which year is on screen
  // or which chip happens to be selected.
  function planSignature() {
    return JSON.stringify(blocks) + '|' + extraPeople.join('|');
  }

  async function writePlan() {
    if (!planFile) return;
    const sig = planSignature();
    try {
      const w = await planFile.createWritable();
      await w.write(planFileText());
      await w.close();
      savedSignature = sig;  // left stale by a failure, so the next change retries
      status('Saved to ' + planFile.name + ' at ' + new Date().toLocaleTimeString());
    } catch (err) {
      status('Could not write ' + planFile.name + ': ' + err.message);
    }
  }

  // render() runs on every click, most of which move nothing.
  function scheduleSave() {
    if (!planFile || planSignature() === savedSignature) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writePlan, 700);
    status('Saving to ' + planFile.name + '\u2026');
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
    history = []; selected = null; splitting = null; deferring = null;
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
    download(DATA.plan_file.replace(/\.txt$/, '') + '.csv', csvText(), 'text/csv');
  });
  el('chart-year').addEventListener('change', drawChart);
  el('chart-view').addEventListener('change', drawChart);
  el('chart-toggle').addEventListener('click', () => {
    const panel = el('board-chart');
    const hidden = panel.classList.toggle('hidden');
    el('chart-toggle').textContent = hidden ? 'Show chart' : 'Hide chart';
    drawChart();
  });

  el('board-save').addEventListener('click', async () => {
    if (planFile) { await writePlan(); return; }
    if (!canWriteFiles) {
      download(DATA.plan_file, planFileText(), 'text/plain');
      status('Downloaded ' + DATA.plan_file + '.');
      warn('This browser cannot keep a file up to date as you work, so that copy is a ' +
           'snapshot: save again before you close the page, and move it next to the ' +
           'dashboard. Chrome and Edge can write as you go.');
      return;
    }
    try {
      planFile = await window.showSaveFilePicker({
        suggestedName: DATA.plan_file, types: FILE_TYPES,
      });
    } catch (err) { return; }  // the picker was cancelled
    el('board-save').textContent = 'Save now';
    warn('');
    await writePlan();
  });

  el('board-open').addEventListener('click', async () => {
    if (!canWriteFiles) { el('board-plan-input').click(); return; }
    let handle, state;
    try { handle = (await window.showOpenFilePicker({ types: FILE_TYPES }))[0]; }
    catch (err) { return; }  // the picker was cancelled
    try { state = parsePlanFile(await (await handle.getFile()).text()); }
    catch (err) { status('Could not read that file: ' + err.message); return; }
    planFile = handle;
    el('board-save').textContent = 'Save now';
    warn(applyPlan(state));
    status('Loaded ' + handle.name + ' \u00b7 saving back to it as you work');
  });

  el('board-plan-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let state;
    try { state = parsePlanFile(await file.text()); }
    catch (err) { status('Could not read that file: ' + err.message); return; }
    const mismatch = applyPlan(state);
    status('Loaded ' + file.name);
    warn((mismatch ? mismatch + ' ' : '') +
         'This browser cannot write back to the file, so use Save plan file to download an ' +
         'updated copy before you close the page.');
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
      year = y; selected = null; splitting = null; deferring = null; render();
    });
  });
  // The seam the DOM test drives, and a way to script the board from a console.
  window.BOARD_API = {
    planFileText: planFileText,
    loadPlanText: text => applyPlan(parsePlanFile(text)),
    chartFigure: chartFigure,
  };

  dropTarget(el('pool'), null);
  render();
  status('Not saved yet. The plan lives in this page until you write it to a file' +
         (canWriteFiles ? '.' : ', and this browser can only download a copy.'));
};

if (window.BOARD_DATA) {
  window.__cicero_boardInit(window.BOARD_DATA);
}

}  // end of the "window exists" guard
