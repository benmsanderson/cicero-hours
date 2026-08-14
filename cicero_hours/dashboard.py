"""Assemble the figures into one self-contained HTML file."""

from __future__ import annotations

import datetime as dt
import html
from pathlib import Path

import plotly.graph_objects as go
import plotly.offline as pyo

from . import figures as F
from ._rules import SHELL_CSS as CSS
from .board import BOARD_CSS, BOARD_JS, board_html
from .model import UNALLOCATED_PERSON, Group

JS = """
const tabs = Array.from(document.querySelectorAll('nav button'));
const panels = Array.from(document.querySelectorAll('.panel'));
function show(id) {
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.target === id)));
  panels.forEach(p => p.setAttribute('data-active', String(p.id === id)));
  const panel = document.getElementById(id);
  // Plotly cannot size a chart while its container is hidden, so resize on reveal.
  if (typeof Plotly !== 'undefined') {
    panel.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
  }
  try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// URLs */ }
}
tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.target)));
window.addEventListener('resize', () => {
  if (typeof Plotly === 'undefined') return;
  const panel = document.querySelector('.panel[data-active="true"]');
  if (panel) panel.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
});
show(location.hash ? location.hash.slice(1) : tabs[0].dataset.target);
"""


def _fig_html(fig: go.Figure) -> str:
    inner = fig.to_html(
        full_html=False,
        include_plotlyjs=False,
        config={"displaylogo": False, "responsive": True,
                "modeBarButtonsToRemove": ["select2d", "lasso2d", "autoScale2d"]},
    )
    return f'<section class="card">{inner}</section>'


def _kpis(group: Group, year: int) -> str:
    s = group.person_summary(year)
    b = group.budget[group.budget["category"] == "Project"]
    unalloc_next = b[b["unallocated"] & (b["year"] > year)]["hours"].sum()
    named_next = b[~b["unallocated"] & (b["year"] > year)]["hours"].sum()
    over = s[s["project_budget"] > group.assumptions.billable_hours]
    reg = group.registered_by_category(year)
    project_share = reg["Project"].sum() / reg.to_numpy().sum() if reg.to_numpy().sum() else 0

    cards = [
        ("", f"{len(group.people)}", "people with hours"),
        ("", f"{b[b['year'] == year]['hours'].sum():,.0f}", f"hours budgeted for {year}"),
        ("warn" if len(over) else "", f"{len(over)}",
         f"over the {group.assumptions.billable_hours:.0f} h standard in {year}"),
        ("", f"{project_share:.0%}", "of registered time on projects"),
        ("gap", f"{unalloc_next / max(named_next + unalloc_next, 1):.0%}",
         f"of {year + 1}+ budget unallocated"),
    ]
    items = "".join(
        f'<div class="kpi {cls}"><span class="value">{html.escape(v)}</span>'
        f'<span class="label">{html.escape(lbl)}</span></div>'
        for cls, v, lbl in cards
    )
    return f'<div class="kpis">{items}</div>'


def build_dashboard(group: Group, output: str | Path, title: str = "Climate Mitigation") -> Path:
    year = group.reporting_year
    a = group.assumptions
    frac = a.year_fraction(year)

    tabs = [
        ("overview", "Overview", [
            F.fig_group_capacity(group),
            F.fig_registered_composition(group, year),
        ]),
        ("people", "People", [
            F.fig_person_budget_stack(group, year),
            F.fig_person_burn(group, year),
            F.fig_person_forward(group),
        ]),
        ("projects", "Projects", [
            F.fig_project_totals(group),
            F.fig_project_team(group),
            F.fig_project_burn(group, year),
        ]),
        ("deepdive", "One researcher", [
            F.fig_person_deep_dive(group, year),
        ]),
        ("matrix", "Who is on what", [
            F.fig_matrix(group, year),
        ]),
        # A browser cannot choose where it writes, so the best the board can do
        # is suggest a name next to the dashboard and let the user pick the folder.
        ("board", "Allocation board", board_html(group, f"{Path(output).stem}_plan.txt")),
    ]

    nav = "".join(
        f'<button role="tab" data-target="{tid}" aria-selected="false">{html.escape(label)}</button>'
        for tid, label, _ in tabs
    )
    panels = "".join(
        f'<div class="panel" id="{tid}" role="tabpanel">'
        + ("".join(_fig_html(f) for f in body) if isinstance(body, list) else body)
        + "</div>"
        for tid, _, body in tabs
    )

    excluded_note = (
        "People outside the group appear in the export where projects are shared; "
        + ", ".join(html.escape(p) for p in group.excluded)
        + " are filtered out by the group tag. "
    ) if group.excluded else ""

    second = group.second_groups()
    second_note = (
        "Part of their time sits with another research group: "
        + ", ".join(f"{p} ({g.split(' / ')[-1]})" for p, g in sorted(second.items()))
        + ". "
    ) if second else ""

    notes = f"""
    <p class="note"><b>How to read this.</b> Budgeted hours come from the budget table in the
    export; registered hours are what people have actually booked. The two cover different
    ground, so every comparison here uses project time only, with internal CICERO time and
    absence shown separately rather than folded in.</p>
    <p class="note"><b>Unallocated time.</b> The export books unassigned group hours to a
    pseudo-employee, <i>{html.escape(UNALLOCATED_PERSON)}</i>. Those hours are drawn hatched
    throughout and are never counted as a person's workload.</p>
    <p class="note"><b>Dates.</b> The export carries no timestamps, so progress is judged against
    a straight line: at {html.escape(a.as_of.isoformat())}, {frac:.0%} of {year}'s working days
    have passed. Norwegian holiday leave is not spread evenly through the year, so an
    August reading will understate the summer months. {html.escape(second_note)}</p>
    <p class="note"><b>Who is counted.</b> Membership comes from the group tag on each
    row rather than a list of names, so a new joiner or leaver needs no code change.
    {excluded_note}The billing standard of {a.billable_hours:.0f} h is the project time
    expected from a full-time researcher in a year; the rest of the working year is
    internal time and absence, which is why the capacity rules apply to project hours
    only.</p>
    """

    plotlyjs = pyo.get_plotlyjs()
    return _write(output, title, group, year, nav, panels, notes, plotlyjs)


def _write(output, title, group, year, nav, panels, notes, plotlyjs) -> Path:
    a = group.assumptions
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · hours and allocation</title>
<style>{CSS}{BOARD_CSS}</style>
<script>{plotlyjs}</script>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">CICERO · reporting year {year} · as of {html.escape(a.as_of.isoformat())}</div>
    <h1>{html.escape(title)}: hours and allocation</h1>
    <p class="standfirst">Where the group's time is committed, how much of it has been
    booked so far, and which hours are still waiting for a name.</p>
    {_kpis(group, year)}
  </header>
  <nav role="tablist">{nav}</nav>
  {panels}
  <div class="notes-block">{notes}</div>
  <footer>Generated {html.escape(dt.date.today().isoformat())} ·
  billing standard {a.billable_hours:.0f} h per full-time year · figures are interactive:
  hover for values, click legend entries to isolate a series.</footer>
</div>
<script>{JS}</script>
<script>{BOARD_JS}</script>
</body>
</html>"""
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc, encoding="utf-8")
    return path
