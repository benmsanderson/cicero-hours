"""Assemble the figures into one self-contained HTML file."""

from __future__ import annotations

import datetime as dt
import html
from pathlib import Path

import plotly.graph_objects as go
import plotly.offline as pyo

from . import figures as F
from .model import UNALLOCATED_PERSON, Group

CSS = """
:root {
  --ink: #12181F;
  --muted: #6A7683;
  --paper: #EDF0F3;
  --card: #FFFFFF;
  --hairline: #D3D9DE;
  --teal: #1F5F6B;
  --ochre: #C98F2B;
  --alarm: #C75A3C;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px; line-height: 1.5;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px 72px; }
header { padding: 40px 0 22px; border-bottom: 1px solid var(--hairline); }
.eyebrow {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted);
}
h1 { font-size: 34px; line-height: 1.1; margin: 8px 0 6px; font-weight: 650; letter-spacing: -.02em; }
.standfirst { color: var(--muted); max-width: 62ch; margin: 0; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 1px;
        background: var(--hairline); border: 1px solid var(--hairline); margin: 26px 0 0; }
.kpi { background: var(--card); padding: 16px 18px; }
.kpi .value {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 27px; font-weight: 600; letter-spacing: -.02em; display: block;
}
.kpi .label { font-size: 12px; color: var(--muted); display: block; margin-top: 3px; }
.kpi.warn .value { color: var(--alarm); }
.kpi.gap .value { color: var(--ochre); }
nav { position: sticky; top: 0; z-index: 20; background: var(--paper);
      border-bottom: 1px solid var(--hairline); margin-top: 30px; display: flex; gap: 4px;
      overflow-x: auto; }
nav button {
  appearance: none; border: 0; background: none; cursor: pointer; color: var(--muted);
  font: inherit; font-size: 14px; padding: 13px 14px; white-space: nowrap;
  border-bottom: 2px solid transparent;
}
nav button:hover { color: var(--ink); }
nav button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--teal); font-weight: 600; }
nav button:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
.panel { display: none; padding-top: 8px; }
.panel[data-active="true"] { display: block; }
.card { background: var(--card); border: 1px solid var(--hairline); padding: 14px 16px 8px; margin: 20px 0; }
.note { color: var(--muted); font-size: 13.5px; max-width: 74ch; margin: 22px 0 0; }
.note b { color: var(--ink); font-weight: 600; }
footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--hairline);
         color: var(--muted); font-size: 12.5px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
"""

JS = """
const tabs = Array.from(document.querySelectorAll('nav button'));
const panels = Array.from(document.querySelectorAll('.panel'));
function show(id) {
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.target === id)));
  panels.forEach(p => p.setAttribute('data-active', String(p.id === id)));
  const panel = document.getElementById(id);
  // Plotly cannot size a chart while its container is hidden, so resize on reveal.
  panel.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
  try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// URLs */ }
}
tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.target)));
window.addEventListener('resize', () => {
  document.querySelector('.panel[data-active="true"]')
    .querySelectorAll('.js-plotly-plot').forEach(el => Plotly.Plots.resize(el));
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
    over = s[s["project_budget"] > group.assumptions.annual_hours]
    reg = group.registered_by_category(year)
    project_share = reg["Project"].sum() / reg.to_numpy().sum() if reg.to_numpy().sum() else 0

    cards = [
        ("", f"{len(group.people)}", "people with hours"),
        ("", f"{b[b['year'] == year]['hours'].sum():,.0f}", f"hours budgeted for {year}"),
        ("warn" if len(over) else "", f"{len(over)}",
         f"over {group.assumptions.annual_hours:.0f} h in {year}"),
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
        ("matrix", "Who is on what", [
            F.fig_matrix(group, year),
        ]),
    ]

    nav = "".join(
        f'<button role="tab" data-target="{tid}" aria-selected="false">{html.escape(label)}</button>'
        for tid, label, _ in tabs
    )
    panels = "".join(
        f'<div class="panel" id="{tid}" role="tabpanel">'
        + "".join(_fig_html(f) for f in figs)
        + "</div>"
        for tid, _, figs in tabs
    )

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
<style>{CSS}</style>
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
  capacity assumption {a.annual_hours:.0f} h per full-time year · figures are interactive:
  hover for values, click legend entries to isolate a series.</footer>
</div>
<script>{JS}</script>
</body>
</html>"""
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc, encoding="utf-8")
    return path
