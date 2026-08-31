"""Plotly figures for the group hours dashboard.

Every function takes a Group and returns a figure, so views can be added or
reordered without touching the parser or the HTML assembly.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from .model import (
    CATEGORY_ORDER,
    EXTERNAL_PROJECT_LABEL,
    INTERNAL_PROJECT_LABEL,
    TYPE_ORDER,
    UNALLOCATED_PERSON,
    Group,
)

INK = "#12181F"
MUTED = "#6A7683"
HAIRLINE = "#D3D9DE"
OVER_ZONE = "rgba(199, 90, 60, 0.07)"

CATEGORY_COLOURS = {
    "Project": "#1F5F6B",
    "Internal": "#7E8FA0",
    "Absence": "#C6CED6",
    "Other": "#E4E8EC",
}

# Project time split by where the money comes from. The two halves keep the
# Project hue — they are the same kind of work, and both count against the
# billing standard — with the internally funded one a tint lighter, far enough
# from the grey of internal CICERO time to read as a different thing.
TYPE_COLOURS = {
    **{k: v for k, v in CATEGORY_COLOURS.items() if k != "Project"},
    EXTERNAL_PROJECT_LABEL: CATEGORY_COLOURS["Project"],
    INTERNAL_PROJECT_LABEL: "#4A8F9C",
}

UNALLOCATED_COLOUR = "#C98F2B"
BUDGET_COLOUR = "#A9B7C2"
REGISTERED_COLOUR = "#1F5F6B"

# Muted but separable, chosen to stay legible when 10+ appear in one stack.
PROJECT_PALETTE = [
    "#1F5F6B", "#C98F2B", "#6B4A72", "#4C7A3F", "#B4552F",
    "#3D6BA5", "#8C7B4B", "#A0466B", "#2E8C8C", "#7A6FA8",
    "#5E7B8B", "#9C6B3F", "#4F8F6B", "#B07F9B", "#365E4A",
]

# Years get distinct hues rather than shades of one, so a stacked bar can be read
# without counting segments. Ochre is reserved for unallocated hours.
YEAR_HUES = ["#1F5F6B", "#6B4A72", "#4C7A3F", "#3D6BA5", "#8C5A3C"]


def year_colours(years) -> dict[int, str]:
    return {y: YEAR_HUES[i % len(YEAR_HUES)] for i, y in enumerate(sorted(years))}

FONT = dict(
    family='"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    size=13,
    color=INK,
)


def _base_layout(title: str, subtitle: str = "", height: int = 520) -> dict:
    heading = f"<b>{title}</b>"
    if subtitle:
        heading += f'<br><span style="font-size:12px;color:{MUTED}">{subtitle}</span>'
    return dict(
        title=dict(text=heading, x=0, xanchor="left", font=dict(size=16)),
        font=FONT,
        height=height,
        margin=dict(l=10, r=20, t=70 if subtitle else 56, b=44),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hoverlabel=dict(font_size=12),
        legend=dict(
            orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1,
            font=dict(size=11), bgcolor="rgba(0,0,0,0)",
        ),
        xaxis=dict(gridcolor=HAIRLINE, zerolinecolor=HAIRLINE, linecolor=HAIRLINE),
        yaxis=dict(gridcolor=HAIRLINE, zerolinecolor=HAIRLINE, linecolor=HAIRLINE),
    )


def project_colours(group: Group) -> dict[str, str]:
    """Stable colour per project, ordered by total budgeted hours."""
    totals = (
        group.budget[group.budget["category"] == "Project"]
        .groupby("project")["hours"].sum().sort_values(ascending=False)
    )
    return {p: PROJECT_PALETTE[i % len(PROJECT_PALETTE)] for i, p in enumerate(totals.index)}


def person_colours(group: Group) -> dict[str, str]:
    """Stable colour per person, ordered by total budgeted hours."""
    totals = (
        group.budget[group.budget["category"] == "Project"]
        .groupby("person")["hours"].sum().sort_values(ascending=False)
    )
    names = [p for p in totals.index if p != UNALLOCATED_PERSON]
    palette = [c for c in PROJECT_PALETTE if c != UNALLOCATED_COLOUR]
    return {p: palette[i % len(palette)] for i, p in enumerate(names)}


def _shorten(label: str, width: int = 22) -> str:
    return label if len(label) <= width else label[: width - 1] + "\u2026"


def _task_label(task) -> str:
    """'92 - Ferie/Vacation' becomes 'Vacation'.

    Internal and absence tasks are coded, then named in Norwegian and English
    either side of a slash. The code is noise on a chart and the rest of the
    dashboard speaks English; the original string stays in the hover.
    """
    if not isinstance(task, str) or not task.strip():
        return "Unspecified"
    body = task.split(" - ", 1)[1] if " - " in task.split("/", 1)[0] else task
    label = body.rsplit("/", 1)[-1].strip()
    return label or task.strip()


def _menu_y(height: int, top: int, bottom: int = 44, gap: int = 46) -> float:
    """Where to float a picker so it sits `gap` pixels above the plotting area.

    Menu coordinates are fractions of the plotting area rather than the page, so
    one constant y drifts further from the plot the taller the figure gets, and
    these figures are as tall as the group is large.
    """
    return 1 + gap / max(height - top - bottom, 1)


def _dropdown(
    buttons: list[dict], height: int, top: int, bottom: int = 44, active: int = 0,
    gap: int = 46,
) -> dict:
    """A picker in the top right. `gap` clears whatever else is up there."""
    return dict(
        buttons=buttons, direction="down", showactive=True, active=active,
        x=1, xanchor="right", y=_menu_y(height, top, bottom, gap), yanchor="top",
        bgcolor="#FFFFFF", bordercolor=HAIRLINE, font=dict(size=12),
    )


def _title(title: str, subtitle: str) -> str:
    return f"<b>{title}</b><br><span style=\"font-size:12px;color:{MUTED}\">{subtitle}</span>"


def _capacity_zone(
    fig: go.Figure, capacity: float, horizontal: bool = True, label: str = "",
) -> None:
    """The signature element: a hard capacity rule with the overrun side tinted."""
    if horizontal:
        fig.add_vrect(
            x0=capacity, x1=capacity * 2.2,
            fillcolor=OVER_ZONE, line_width=0, layer="below",
        )
        fig.add_vline(
            x=capacity, line=dict(color="#C75A3C", width=1.4, dash="dot"),
            annotation_text=label or f"{capacity:.0f} h", annotation_position="top",
            annotation_font=dict(size=11, color="#C75A3C"),
        )
    else:
        fig.add_hrect(
            y0=capacity, y1=capacity * 2.2,
            fillcolor=OVER_ZONE, line_width=0, layer="below",
        )
        fig.add_hline(
            y=capacity, line=dict(color="#C75A3C", width=1.4, dash="dot"),
            annotation_text=label or f"{capacity:.0f} h", annotation_position="right",
            annotation_font=dict(size=11, color="#C75A3C"),
        )


# --------------------------------------------------------------------- group


def fig_group_capacity(group: Group) -> go.Figure:
    b = group.budget[group.budget["category"] == "Project"]
    named = b[~b["unallocated"]].groupby("year")["hours"].sum()
    unalloc = b[b["unallocated"]].groupby("year")["hours"].sum()
    years = group.years
    named = named.reindex(years).fillna(0.0)
    unalloc = unalloc.reindex(years).fillna(0.0)
    headcount = len(group.people)
    capacity = headcount * group.assumptions.billable_hours

    fig = go.Figure()
    fig.add_bar(
        x=[str(y) for y in years], y=named.values, name="Assigned to a person",
        marker_color=CATEGORY_COLOURS["Project"],
        hovertemplate="%{x}: %{y:,.0f} h assigned<extra></extra>",
    )
    fig.add_bar(
        x=[str(y) for y in years], y=unalloc.values, name="Unallocated",
        marker=dict(color=UNALLOCATED_COLOUR, pattern=dict(shape="/", fgcolor="#FFFFFF", size=6)),
        hovertemplate="%{x}: %{y:,.0f} h unallocated<extra></extra>",
    )
    fig.update_layout(
        barmode="stack",
        **_base_layout(
            "Project hours budgeted, by year",
            f"Hatched bars are hours booked to the group but not yet assigned to a named person. "
            f"Rule is {headcount} researchers at the "
            f"{group.assumptions.billable_hours:.0f} h billing standard.",
            height=420,
        ),
    )
    _capacity_zone(fig, capacity, horizontal=False, label=f"{capacity:,.0f} h billable")
    fig.update_yaxes(title_text="hours")
    return fig


def fig_registered_composition(group: Group, year: int) -> go.Figure:
    df = group.registered_by_type(year)
    df = df.loc[df.sum(axis=1).sort_values().index]
    fig = go.Figure()
    for kind in TYPE_ORDER:
        if kind not in df or df[kind].sum() == 0:
            continue
        fig.add_bar(
            y=df.index, x=df[kind], name=kind, orientation="h",
            marker_color=TYPE_COLOURS[kind],
            hovertemplate="%{y}<br>" + kind + ": %{x:,.0f} h<extra></extra>",
        )
    frac = group.assumptions.year_fraction(year)
    expected = group.assumptions.billable_hours * frac
    fig.update_layout(
        barmode="stack",
        **_base_layout(
            f"Hours registered in {year}, by type",
            f"Project time is stacked first, so the rule reads directly against it. "
            f"{INTERNAL_PROJECT_LABEL} is project work CICERO funds itself: it counts "
            f"towards the standard like any other project time, but raises no invoice. "
            f"Billing standard pro-rated to {frac:.0%} of the working year.",
            height=max(380, 34 * len(df) + 130),
        ),
    )
    _capacity_zone(fig, expected, label=f"{expected:,.0f} h billable to date")
    fig.update_xaxes(title_text="hours registered")
    return fig


# -------------------------------------------------------------------- people


def _stack_with_rollup(df: pd.DataFrame, top_n: int) -> pd.DataFrame:
    """Keep each person's largest top_n projects, roll the rest into 'Other projects'."""
    out = []
    for person, sub in df.groupby("person"):
        sub = sub.sort_values("hours", ascending=False)
        head, tail = sub.iloc[:top_n], sub.iloc[top_n:]
        out.append(head)
        if len(tail):
            out.append(pd.DataFrame({
                "person": [person],
                "project": [f"Other ({len(tail)})"],
                "hours": [tail["hours"].sum()],
            }))
    return pd.concat(out, ignore_index=True)


def _budgeted_years(group: Group) -> list[int]:
    """Years with budgeted project hours, which is not every year in the export."""
    return [y for y in group.years if not group.budget_by_person_project(y).empty]


def fig_person_budget_stack(group: Group, year: int, top_n: int = 6) -> go.Figure:
    """Budgeted hours per person for one year, with the other years a click away.

    Every year's bars are built and all but one hidden, rather than a figure per
    year: the tab would otherwise carry one of these for each year in the export.
    """
    years = _budgeted_years(group)
    if year not in years:
        year = years[-1]
    colours = project_colours(group)
    subtitle = (
        f"Largest {top_n} projects each, labelled where they fit; the rest pooled in grey. "
        f"'{UNALLOCATED_PERSON}' is unassigned group time."
    )

    fig = go.Figure()
    owner: list[int] = []
    order_of: dict[int, list[str]] = {}
    for y in years:
        df = group.budget_by_person_project(y)
        order_of[y] = df.groupby("person")["hours"].sum().sort_values().index.tolist()
        df = _stack_with_rollup(df, top_n)
        projects = df.groupby("project")["hours"].sum().sort_values(ascending=False).index
        for proj in projects:
            sub = df[df["project"] == proj]
            is_rollup = proj.startswith("Other (")
            fig.add_bar(
                y=sub["person"], x=sub["hours"], name=proj, orientation="h",
                visible=(y == year),
                marker_color="#B9C2C9" if is_rollup else colours.get(proj, "#8899A6"),
                hovertemplate="%{y}<br>" + proj + ": %{x:,.0f} h<extra></extra>",
                text=[_shorten(proj)] * len(sub), textposition="inside",
                insidetextanchor="middle",
                insidetextfont=dict(color="#FFFFFF" if not is_rollup else INK, size=11),
                textangle=0, constraintext="inside",
                showlegend=False,
            )
            owner.append(y)

    # A year late in the export may hold only a couple of people. The floor is
    # low enough that two rows do not become two very fat bars.
    def height_for(y: int) -> int:
        return max(280, 36 * len(order_of[y]) + 180)

    buttons = [
        dict(
            label=str(y), method="update",
            args=[
                {"visible": [o == y for o in owner]},
                {"title.text": _title(f"Hours budgeted per person, {y}", subtitle),
                 "yaxis.categoryarray": order_of[y],
                 # A year with fewer people makes a shorter figure, and the
                 # picker has to be re-floated against the new plotting area.
                 "height": height_for(y),
                 "updatemenus[0].y": _menu_y(height_for(y), 124)},
            ],
        )
        for y in years
    ]

    fig.update_layout(
        barmode="stack",
        **_base_layout(f"Hours budgeted per person, {year}", subtitle, height=height_for(year)),
    )
    fig.update_layout(
        margin=dict(l=10, r=20, t=124, b=44),
        uniformtext=dict(mode="hide", minsize=9),
        updatemenus=[_dropdown(buttons, height_for(year), top=124, active=years.index(year))],
    )
    fig.update_yaxes(categoryorder="array", categoryarray=order_of[year])
    _capacity_zone(
        fig, group.assumptions.billable_hours,
        label=f"{group.assumptions.billable_hours:,.0f} h billing standard",
    )
    fig.update_xaxes(title_text="hours budgeted")
    return fig


def fig_person_burn(group: Group, year: int) -> go.Figure:
    """Budget against hours booked for one year, with the other years a click away.

    A year still to come has nothing registered and nothing expected yet, so the
    subtitle says how far through each year the reading is taken.
    """
    rows = {}
    for y in group.years:
        s = group.person_summary(y)
        s = s[(s["project_budget"] > 0) | (s["Project"] > 0)].sort_values("project_budget")
        if len(s):
            rows[y] = s
    years = list(rows)
    if year not in years:
        year = years[-1]

    def subtitle_for(y: int) -> str:
        frac = group.assumptions.year_fraction(y)
        if frac == 0:
            return ("Absence and internal time excluded. Nothing is booked to "
                    f"{y} yet, so the bars are the budget as it stands.")
        return ("Absence and internal time excluded. Tick marks the straight-line "
                f"expectation at {frac:.0%} of {y}'s working year.")

    fig = go.Figure()
    owner: list[int] = []
    for y, s in rows.items():
        visible = y == year
        fig.add_bar(
            y=s.index, x=s["project_budget"], name=f"Budgeted for {y}", orientation="h",
            marker_color=BUDGET_COLOUR, visible=visible, legendgroup="budget",
            hovertemplate="%{y}<br>budgeted: %{x:,.0f} h<extra></extra>",
        )
        fig.add_bar(
            y=s.index, x=s["Project"], name="Registered so far", orientation="h",
            marker_color=REGISTERED_COLOUR, width=0.42, visible=visible, legendgroup="registered",
            hovertemplate="%{y}<br>registered: %{x:,.0f} h<extra></extra>",
        )
        fig.add_scatter(
            y=s.index, x=s["expected_to_date"], mode="markers", name="On plan at this date",
            marker=dict(symbol="line-ns", size=16, line=dict(color="#C75A3C", width=2.2)),
            visible=visible, legendgroup="onplan",
            hovertemplate="%{y}<br>on plan: %{x:,.0f} h<extra></extra>",
        )
        owner += [y] * 3

    def height_for(y: int) -> int:
        return max(280, 34 * len(rows[y]) + 180)

    buttons = [
        dict(
            label=str(y), method="update",
            args=[
                {"visible": [o == y for o in owner]},
                {"title.text": _title(f"Project time against plan, {y}", subtitle_for(y)),
                 "yaxis.categoryarray": rows[y].index.tolist(),
                 "height": height_for(y),
                 "updatemenus[0].y": _menu_y(height_for(y), 124)},
            ],
        )
        for y in years
    ]

    fig.update_layout(
        barmode="overlay",
        **_base_layout(
            f"Project time against plan, {year}", subtitle_for(year), height=height_for(year),
        ),
    )
    fig.update_layout(
        margin=dict(l=10, r=20, t=124, b=44),
        # The year picker takes the top right, so the legend moves out from under it.
        legend=dict(orientation="h", yanchor="bottom", y=1.0, xanchor="left", x=0,
                    font=dict(size=11), bgcolor="rgba(0,0,0,0)"),
        updatemenus=[_dropdown(buttons, height_for(year), top=124, active=years.index(year))],
    )
    fig.update_yaxes(categoryorder="array", categoryarray=rows[year].index.tolist())
    fig.update_xaxes(title_text="hours")
    return fig


def fig_person_forward(group: Group) -> go.Figure:
    b = group.budget[(group.budget["category"] == "Project") & (~group.budget["unallocated"])]
    piv = b.pivot_table(index="person", columns="year", values="hours", aggfunc="sum").fillna(0.0)
    order = piv.sum(axis=1).sort_values().index
    piv = piv.loc[order]
    colours = year_colours(piv.columns)
    fig = go.Figure()
    for year in piv.columns:
        fig.add_bar(
            y=piv.index, x=piv[year], name=str(year), orientation="h",
            marker_color=colours[year],
            hovertemplate="%{y}<br>" + str(year) + ": %{x:,.0f} h<extra></extra>",
        )
    fig.update_layout(
        barmode="group",
        **_base_layout(
            "Committed hours ahead, by person",
            "Named budget only. Short bars in later years show where funding runs out first.",
            height=max(420, 44 * len(piv) + 140),
        ),
    )
    _capacity_zone(
        fig, group.assumptions.billable_hours,
        label=f"{group.assumptions.billable_hours:,.0f} h billing standard",
    )
    fig.update_xaxes(title_text="hours budgeted")
    return fig


# ------------------------------------------------------------------ projects


def fig_project_totals(group: Group, min_hours: float = 100.0) -> go.Figure:
    ps = group.project_summary()
    totals = ps.groupby("project")["budget_total"].sum()
    keep = totals[totals >= min_hours].sort_values().index
    ps = ps[ps["project"].isin(keep)]
    years = sorted(ps["year"].unique())
    colours = year_colours(years)
    fig = go.Figure()
    for year in years:
        sub = ps[ps["year"] == year].set_index("project").reindex(keep).fillna(0.0)
        colour = colours[year]
        fig.add_bar(
            y=keep, x=sub["budget_named"], name=str(year), orientation="h",
            marker_color=colour, legendgroup=str(year),
            hovertemplate="%{y}<br>" + str(year) + " assigned: %{x:,.0f} h<extra></extra>",
        )
        fig.add_bar(
            y=keep, x=sub["budget_unallocated"], name=f"{year} unallocated", orientation="h",
            marker=dict(color=colour, pattern=dict(shape="/", fgcolor="#FFFFFF", size=5)),
            legendgroup=str(year), showlegend=False,
            hovertemplate="%{y}<br>" + str(year) + " unallocated: %{x:,.0f} h<extra></extra>",
        )
    fig.update_layout(
        barmode="stack",
        **_base_layout(
            "Budgeted hours per project",
            f"Projects above {min_hours:.0f} h in total. Hatched segments are hours "
            "with no name against them yet.",
            height=max(500, 26 * len(keep) + 150),
        ),
    )
    fig.update_xaxes(title_text="hours budgeted")
    return fig


def fig_project_team(group: Group, min_hours: float = 100.0) -> go.Figure:
    """One project at a time, chosen from a dropdown: who is on it, by year."""
    ps = group.project_summary()
    totals = ps.groupby("project")["budget_total"].sum().sort_values(ascending=False)
    projects = [p for p in totals.index if totals[p] >= min_hours]
    years = [str(y) for y in group.years]

    colours = person_colours(group)
    fig = go.Figure()
    trace_owner: list[str] = []
    for proj in projects:
        team = group.project_team(proj)
        people = team.groupby("person")["hours"].sum().sort_values(ascending=False).index
        for person in people:
            sub = team[team["person"] == person].set_index("year").reindex(group.years).fillna(0.0)
            unalloc = person == UNALLOCATED_PERSON
            fig.add_bar(
                x=years, y=sub["hours"].values,
                name="Unallocated" if unalloc else person,
                visible=(proj == projects[0]),
                marker=dict(
                    color=UNALLOCATED_COLOUR if unalloc else colours.get(person, "#8899A6"),
                    pattern=dict(shape="/", fgcolor="#FFFFFF", size=6) if unalloc else None,
                ),
                hovertemplate="%{x}<br>%{fullData.name}: %{y:,.0f} h<extra></extra>",
            )
            trace_owner.append(proj)

    buttons = []
    for proj in projects:
        pm = ps.loc[ps["project"] == proj, "pm"].dropna()
        pm_label = f" · led by {pm.iloc[0]}" if len(pm) else ""
        buttons.append(dict(
            label=proj[:46],
            method="update",
            args=[
                {"visible": [owner == proj for owner in trace_owner]},
                {"title.text": f"<b>Team on {proj}</b><br>"
                               f'<span style="font-size:12px;color:{MUTED}">'
                               f"Budgeted hours per person per year{pm_label}</span>"},
            ],
        ))

    fig.update_layout(
        barmode="stack",
        updatemenus=[dict(
            buttons=buttons, direction="down", showactive=True,
            x=1, xanchor="right", y=1.28, yanchor="top",
            bgcolor="#FFFFFF", bordercolor=HAIRLINE, font=dict(size=12),
        )],
        **_base_layout("Team on a project", "Budgeted hours per person per year", height=520),
    )
    fig.update_layout(margin=dict(l=10, r=20, t=140, b=44))
    fig.update_yaxes(title_text="hours budgeted")
    return fig


def fig_project_burn(group: Group, year: int, min_hours: float = 50.0) -> go.Figure:
    ps = group.project_summary()
    ps = ps[(ps["year"] == year) & (ps["budget_total"] >= min_hours)].copy()
    frac = group.assumptions.year_fraction(year)
    ps["expected"] = ps["budget_total"] * frac
    ps["gap"] = ps["registered"] - ps["expected"]
    ps = ps.sort_values("gap")
    fig = go.Figure()
    fig.add_bar(
        y=ps["project"], x=ps["budget_total"], name="Budgeted", orientation="h",
        marker_color=BUDGET_COLOUR,
        hovertemplate="%{y}<br>budgeted: %{x:,.0f} h<extra></extra>",
    )
    fig.add_bar(
        y=ps["project"], x=ps["registered"], name="Registered", orientation="h",
        marker_color=REGISTERED_COLOUR, width=0.42,
        hovertemplate="%{y}<br>registered: %{x:,.0f} h<extra></extra>",
    )
    fig.add_scatter(
        y=ps["project"], x=ps["expected"], mode="markers", name="On plan at this date",
        marker=dict(symbol="line-ns", size=14, line=dict(color="#C75A3C", width=2.2)),
        hovertemplate="%{y}<br>on plan: %{x:,.0f} h<extra></extra>",
    )
    fig.update_layout(
        barmode="overlay",
        **_base_layout(
            f"Delivery against budget by project, {year}",
            "Sorted by shortfall. The projects at the top are furthest behind their plan.",
            height=max(520, 24 * len(ps) + 150),
        ),
    )
    fig.update_xaxes(title_text="hours")
    return fig


# -------------------------------------------------------------------- matrix


def fig_matrix(group: Group, year: int, min_hours: float = 1.0) -> go.Figure:
    df = group.budget_by_person_project(year)
    df = df[df["hours"] >= min_hours]
    # Projects run down the page and people across it: there are far more
    # projects than people, and a tall grid stays readable where a wide one does not.
    piv = df.pivot_table(index="project", columns="person", values="hours", aggfunc="sum")
    piv = piv.loc[
        piv.sum(axis=1).sort_values().index,
        piv.sum(axis=0).sort_values(ascending=False).index,
    ]
    text = piv.map(lambda v: "" if pd.isna(v) else f"{v:,.0f}")
    fig = go.Figure(go.Heatmap(
        z=piv.values, x=piv.columns, y=piv.index,
        text=text.values, texttemplate="%{text}", textfont=dict(size=10),
        colorscale=[[0, "#F2F6F7"], [0.25, "#BBD3D8"], [0.6, "#4E8794"], [1, "#173F47"]],
        hovertemplate="%{x}<br>%{y}: %{z:,.0f} h<extra></extra>",
        colorbar=dict(title="hours", thickness=12, len=0.4, y=1, yanchor="top"),
        xgap=2, ygap=2,
    ))
    fig.update_layout(**_base_layout(
        f"Who is on what, {year}",
        "Budgeted hours. Reading down a column shows one person's spread; "
        "reading across a row shows a project's team.",
        height=max(560, 22 * len(piv) + 220),
    ))
    fig.update_xaxes(tickangle=-90, side="top", showgrid=False)
    fig.update_yaxes(showgrid=False, tickfont=dict(size=11))
    fig.update_layout(margin=dict(l=10, r=20, t=210, b=30))
    return fig


# ------------------------------------------------------------------ deep dive


def _rest_heading(mine: pd.DataFrame, year: int) -> str:
    """Heading for the non-project panel, which reports what it is showing."""
    if mine.empty:
        return f"The rest of {year}: nothing booked outside projects"
    by_cat = mine.groupby("category")["hours"].sum()
    bits = [f"{h:,.0f} h {cat.lower()}" for cat, h in by_cat.sort_values(ascending=False).items()]
    return f"The rest of {year}: {' · '.join(bits)}, by task"


def fig_person_deep_dive(group: Group, year: int) -> go.Figure:
    """One researcher at a time, with every project shown rather than pooled.

    Top left: where this year's budget sits and how much of it has been booked.
    Top right: the same person's commitments across all years in the export.
    Below: the rest of the year, which is where the billing standard's missing
    hours actually go — internal work and leave, split by the task booked to,
    since that is as much detail as the export carries.
    """
    people = (
        group.person_summary(year)
        .sort_values("project_budget", ascending=False)
        .index.tolist()
    )
    budget = group.budget_by_person_project(year).set_index(["person", "project"])["hours"]
    reg = group.registered_by_person_project(year).set_index(["person", "project"])["hours"]
    forward = (
        group.budget[(group.budget["category"] == "Project")]
        .groupby(["person", "project", "year"])["hours"].sum()
    )
    colours = project_colours(group)
    frac = group.assumptions.year_fraction(year)
    years = group.years

    rest = group.nonproject_by_person_task(year)
    rest = rest.assign(label=rest["task"].map(_task_label))
    task_rows = rest.groupby("person").size()
    # One height for everyone, sized for the busiest: the panels would otherwise
    # jump about as the reader steps through the group.
    bottom = max(130, 21 * int(task_rows.max()) if len(task_rows) else 0)

    fig = make_subplots(
        rows=2, cols=2, column_widths=[0.56, 0.44], row_heights=[400, bottom],
        horizontal_spacing=0.13, vertical_spacing=0.12,
        specs=[[{}, {}], [{"colspan": 2}, None]],
        subplot_titles=(
            f"{year}: budget against hours booked",
            "Commitments by year",
            f"The rest of {year}, by task",
        ),
    )
    owner: list[str] = []

    budget_people = set(budget.index.get_level_values(0))
    reg_people = set(reg.index.get_level_values(0))
    forward_people = set(forward.index.get_level_values(0))

    for person in people:
        rows = budget.loc[person] if person in budget_people else pd.Series(dtype=float)
        rows = rows.sort_values()
        booked = (
            reg.loc[person].reindex(rows.index).fillna(0.0)
            if person in reg_people else rows * 0
        )
        visible = person == people[0]

        fig.add_bar(
            y=rows.index, x=rows.values, orientation="h", name="Budgeted",
            marker_color=BUDGET_COLOUR, visible=visible, legendgroup="budget",
            offsetgroup="budget",
            hovertemplate="%{y}<br>budgeted: %{x:,.0f} h<extra></extra>",
            row=1, col=1,
        )
        owner.append(person)
        fig.add_bar(
            y=rows.index, x=booked.values, orientation="h", name="Booked",
            marker_color=REGISTERED_COLOUR, visible=visible, legendgroup="booked",
            offsetgroup="booked",
            hovertemplate="%{y}<br>booked: %{x:,.0f} h<extra></extra>",
            row=1, col=1,
        )
        owner.append(person)
        fig.add_scatter(
            y=rows.index, x=rows.values * frac, mode="markers", name="On plan",
            marker=dict(symbol="line-ns", size=13, line=dict(color="#C75A3C", width=2)),
            visible=visible, legendgroup="onplan",
            hovertemplate="%{y}<br>on plan: %{x:,.0f} h<extra></extra>",
            row=1, col=1,
        )
        owner.append(person)

        person_forward = forward.loc[person] if person in forward_people else None
        projects = (
            person_forward.groupby("project").sum().sort_values(ascending=False).index
            if person_forward is not None else []
        )
        for proj in projects:
            series = person_forward.loc[proj].reindex(years).fillna(0.0)
            fig.add_bar(
                x=[str(y) for y in years], y=series.values, name=proj,
                marker_color=colours.get(proj, "#8899A6"), visible=visible, showlegend=False,
                offsetgroup="forward",
                text=[_shorten(proj, 18)] * len(years), textposition="inside",
                insidetextanchor="middle", textangle=0, constraintext="inside",
                insidetextfont=dict(color="#FFFFFF", size=10),
                hovertemplate="%{x}<br>" + proj + ": %{y:,.0f} h<extra></extra>",
                row=1, col=2,
            )
            owner.append(person)

        # Time off projects, split by task. Only the categories this person
        # actually booked to, so the legend does not promise absence they
        # never took.
        mine = rest[rest["person"] == person]
        for cat in CATEGORY_ORDER[1:]:
            sub = mine[mine["category"] == cat].sort_values("hours")
            if sub.empty:
                continue
            fig.add_bar(
                y=sub["label"], x=sub["hours"], orientation="h", name=cat,
                marker_color=CATEGORY_COLOURS[cat], visible=visible, legendgroup=cat,
                customdata=sub["task"].fillna("no task on the row"),
                hovertemplate="%{customdata}<br>" + cat + ": %{x:,.0f} h<extra></extra>",
                row=2, col=1,
            )
            owner.append(person)

    summary = group.person_summary(year)
    buttons = []
    for person in people:
        row = summary.loc[person]
        second = group.second_groups().get(person)
        tail = f" · part-time in {second.split(' / ')[-1]}" if second else ""
        mine = rest[rest["person"] == person]
        buttons.append(dict(
            label=person, method="update",
            args=[
                {"visible": [o == person for o in owner]},
                {"title.text": f"<b>{person}</b><br>"
                               f'<span style="font-size:12px;color:{MUTED}">'
                               f"{row['project_budget']:,.0f} h budgeted across "
                               f"{int(row['n_projects'])} "
                               f"project{'' if row['n_projects'] == 1 else 's'} in {year} · "
                               f"{row['Project']:,.0f} h booked · "
                               f"{row['Absence']:,.0f} h absence · "
                               f"{row['Internal']:,.0f} h internal{tail}</span>",
                 # annotations[2] is the third subplot title. Everyone books a
                 # different mix, and someone may book nothing at all, in which
                 # case the panel says so rather than drawing an empty grid.
                 "annotations[2].text": _rest_heading(mine, year),
                 "yaxis3.categoryarray": mine.sort_values("hours")["label"].tolist(),
                 "xaxis3.visible": not mine.empty,
                 "yaxis3.visible": not mine.empty},
            ],
        ))

    first = summary.loc[people[0]]
    # The two rows and the gap between them are fractions of the plotting area,
    # so the figure is sized from what the rows need rather than the other way round.
    height = 130 + 90 + round((400 + bottom) / (1 - 0.12))
    fig.update_layout(
        barmode="stack",
        uniformtext=dict(mode="hide", minsize=9),
        # A wider gap than elsewhere: the subplot titles sit above the panels.
        updatemenus=[_dropdown(buttons, height, top=130, bottom=90, gap=92)],
        **_base_layout(
            people[0],
            f"{first['project_budget']:,.0f} h budgeted across "
            f"{int(first['n_projects'])} "
            f"project{'' if first['n_projects'] == 1 else 's'} in {year}",
            height=height,
        ),
    )
    # The legend sits under the panels, where it cannot collide with the subplot titles.
    fig.update_layout(
        margin=dict(l=10, r=20, t=130, b=90),
        legend=dict(orientation="h", yanchor="top", y=-0.1, xanchor="left", x=0),
    )
    fig.add_hline(
        y=group.assumptions.billable_hours, row=1, col=2,
        line=dict(color="#C75A3C", width=1.4, dash="dot"),
        annotation_text=f"{group.assumptions.billable_hours:,.0f} h",
        annotation_position="top left", annotation_font=dict(size=11, color="#C75A3C"),
    )
    first_rest = rest[rest["person"] == people[0]]
    fig.layout.annotations[2].text = _rest_heading(first_rest, year)
    fig.update_xaxes(title_text="hours", row=1, col=1, gridcolor=HAIRLINE)
    fig.update_yaxes(row=1, col=1, gridcolor=HAIRLINE, tickfont=dict(size=11))
    fig.update_yaxes(title_text="hours budgeted", row=1, col=2, gridcolor=HAIRLINE)
    fig.update_xaxes(row=1, col=2, gridcolor=HAIRLINE)
    fig.update_xaxes(
        title_text="hours registered", row=2, col=1, gridcolor=HAIRLINE,
        visible=not first_rest.empty,
    )
    fig.update_yaxes(
        row=2, col=1, gridcolor=HAIRLINE, tickfont=dict(size=10.5), automargin=True,
        categoryorder="array", visible=not first_rest.empty,
        categoryarray=first_rest.sort_values("hours")["label"].tolist(),
    )
    return fig
