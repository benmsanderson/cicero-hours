"""A what-if board for rebalancing project hours across a research group.

Every budgeted hour is a block, whether it already has a name against it or not,
so an oversubscribed researcher can hand work to a colleague as easily as spare
hours can be placed. Blocks move between people and to and from the unassigned
pool, and they can be deferred to a later year within the same project. A
deferral changes the grant's spending profile, so those need NFR approval and are
listed separately for exactly that purpose. Hours are never pulled earlier than
they were budgeted.

The billing standard is drawn as a guide, not a limit. Researchers legitimately
bill above and below it, so each card also carries that person's own current
rate, and passing the guide is shaded rather than alarmed.

A stacked bar of the proposal sits above the cards, the same shape as "Hours
budgeted per person" on the People tab but drawn from the board's own state, so
the effect of a move on the whole group is visible while it is being made.

This is a planning aid for group meetings, not a system of record. Nothing is
written back to the finance system: the board holds a proposal in memory and
exports it as CSV or as text to paste into meeting notes. Refreshing the page
clears it, which is deliberate, because a half-remembered browser state is worse
than none when the numbers matter.

A reallocation rarely finishes in one sitting, though, so the board can also
write the proposal to a text file the user names once and the page then keeps up
to date. Opening that file in a later session restores the plan. The readable
part of the file is the plan itself; the last line is the state the board reloads
from. A browser cannot choose where that file goes, so the save dialogue suggests
a name next to the dashboard and the user picks the folder.
"""

from __future__ import annotations

import json

# Re-exported so the imports here keep working; the CSS and JS themselves live
# in spec/board.css and spec/board.js and are shared with the browser build.
from ._rules import BOARD_CSS, BOARD_JS  # noqa: F401
from .figures import project_colours
from .model import UNALLOCATED_PERSON, Group


def board_data(group: Group, plan_file: str = "allocation_plan.txt") -> dict:
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
            "oyear": int(row.year),
        })

    # Which years each project actually has budget in, so a deferral into a year
    # the project does not run can be flagged rather than silently accepted.
    project_years = {
        str(proj): sorted(int(y) for y in sub["year"].unique())
        for proj, sub in project.groupby("project")
    }

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

    # Enough of the export to tell whether a saved plan came from this one. A
    # plan opened against a rebuilt export is still worth loading, but the two
    # may disagree, and the board says so rather than pretending otherwise.
    fingerprint = f"{len(blocks)} blocks / {sum(b['hours'] for b in blocks):,.0f} h"

    return {
        "years": [int(y) for y in group.years],
        "default_year": int(default_year),
        "people": group.people,
        "baseline": baseline,
        "rate": rate,
        "second_groups": {p: g.split(" / ")[-1] for p, g in group.second_groups().items()},
        "blocks": blocks,
        "project_years": project_years,
        "project_colour": project_colours(group),
        "billable_hours": group.assumptions.billable_hours,
        "unallocated_person": UNALLOCATED_PERSON,
        "fingerprint": fingerprint,
        "plan_file": plan_file,
    }


def board_html(group: Group, plan_file: str = "allocation_plan.txt") -> str:
    data = board_data(group, plan_file)
    years = "".join(
        f'<button id="year-{y}" aria-pressed="false">{y}<span class="badge"></span></button>' for y in data["years"]
    )
    guide = data["billable_hours"]
    chart_years = "".join(f'<option value="{y}">{y}</option>' for y in data["years"])
    return f"""
<div class="board">
  <p class="hint">Every budgeted hour is a block here, including hours that already have a
  name against them. Drag one onto another researcher, or click it and then click a card;
  split a block first if only part of it should move. The × sends a block back to
  unassigned. <b>Defer</b> pushes a block into a later year of the same project, which
  changes the grant's spending profile and so needs NFR approval; those moves are listed
  separately at the bottom, ready to go in the request. Hours are never pulled earlier
  than they were budgeted.
  The {guide:,.0f} h line is a guide rather than a limit, so each card also shows that
  person's own current billing rate, and the thin vertical mark is where they started.
  Nothing is written back to the budget system, and the plan is gone on a refresh unless
  you put it in a file: <b>Save plan file</b> names one and keeps it up to date as you
  work, and <b>Open plan file</b> picks a reallocation up in a later session.</p>
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
        {chart_years}
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
<script>window.BOARD_DATA = {json.dumps(data)};</script>
"""
