from __future__ import annotations

import datetime as dt

import pytest

from cicero_hours import figures as F
from cicero_hours.board import board_data, board_html
from cicero_hours.dashboard import build_dashboard
from cicero_hours.loader import load_export
from cicero_hours.model import Assumptions, build_group

from .synthetic import write_export


@pytest.fixture
def export(tmp_path):
    return write_export(tmp_path / "export.csv")


@pytest.fixture
def group(export):
    return build_group(
        load_export(export),
        Assumptions(as_of=dt.date(2026, 7, 2), billable_hours=1250.0),
    )


# ------------------------------------------------------------------- loading


def test_finds_both_tables_and_ignores_the_keyless_block(export):
    raw = load_export(export)
    assert set(raw.tables) == {"registered", "budget"}
    assert len(raw.unrecognised) == 1
    assert list(raw.unrecognised[0].columns) == ["Budget Type", "Description"]


def test_missing_table_names_itself_in_the_error(tmp_path):
    path = tmp_path / "legend_only.csv"
    path.write_text('"Budget Type","Description"\r\n"2026","Tid"\r\n', encoding="utf-8")
    with pytest.raises(KeyError, match="budget"):
        load_export(path).require("budget")


# ------------------------------------------------------------------- tidying


def test_registered_rows_collapse_across_activity_codes(group):
    alpha = group.registered.query("person == 'Ada Lovelace' and project == 'ALPHA'")
    assert len(alpha) == 1, "the two time rows merge; the empty cost row is dropped"
    assert alpha["hours"].sum() == pytest.approx(400.0)
    assert not (group.registered["hours"] == 0).any()


def test_time_splits_into_project_internal_and_absence(group):
    by_cat = group.registered.groupby("category")["hours"].sum()
    assert by_cat["Project"] == pytest.approx(600.0)
    assert by_cat["Internal"] == pytest.approx(210.0)
    assert by_cat["Absence"] == pytest.approx(210.0)


def test_budget_covers_project_accounts_only(group):
    assert set(group.budget["category"]) == {"Project"}


def test_project_label_drops_the_job_number(group):
    assert set(group.budget["project"]) == {"ALPHA", "BETA"}


# --------------------------------------------------------------- unallocated


def test_people_without_the_group_tag_are_filtered_out(group):
    assert "Alan Turing" not in group.people
    assert group.excluded == ("Alan Turing",)
    assert group.group_tag == "Utslippsreduksjon / Climate Mitigation"


def test_explicit_exclusions_apply_on_top_of_the_tag(export):
    g = build_group(load_export(export), exclude=("Grace Hopper",))
    assert g.people == ["Ada Lovelace"]
    assert "Grace Hopper" in g.excluded


def test_billable_target_defaults_to_the_billing_standard(group):
    assert group.person_summary(2026)["billable_target"].unique().tolist() == [1250.0]


def test_unallocated_is_flagged_and_kept_out_of_the_roster(group):
    assert group.budget["unallocated"].sum() == 1
    assert "Forsker Climate Mitigation" not in group.people
    assert group.people == ["Ada Lovelace", "Grace Hopper"]


def test_unallocated_excluded_from_person_summary(group):
    assert "Forsker Climate Mitigation" not in group.person_summary(2026).index


def test_project_summary_separates_named_from_unallocated(group):
    row = group.project_summary().query("project == 'ALPHA' and year == 2027").iloc[0]
    assert row["budget_named"] == pytest.approx(400.0)
    assert row["budget_unallocated"] == pytest.approx(600.0)
    assert row["budget_total"] == pytest.approx(1000.0)


# ------------------------------------------------------------------ pro-rata


@pytest.mark.parametrize(
    "as_of, expected",
    [
        (dt.date(2025, 12, 31), 0.0),
        (dt.date(2027, 1, 1), 1.0),
        (dt.date(2026, 7, 2), 0.5),
    ],
)
def test_year_fraction_bounds_and_midpoint(as_of, expected):
    assert Assumptions(as_of=as_of).year_fraction(2026) == pytest.approx(expected, abs=0.02)


def test_holidays_shorten_the_elapsed_year():
    plain = Assumptions(as_of=dt.date(2026, 6, 1))
    with_holidays = Assumptions(
        as_of=dt.date(2026, 6, 1),
        holidays=tuple(f"2026-05-{d:02d}" for d in range(4, 9)),
    )
    assert with_holidays.year_fraction(2026) < plain.year_fraction(2026)


def test_expectation_uses_project_budget_not_registered_total(group):
    row = group.person_summary(2026).loc["Ada Lovelace"]
    assert row["project_budget"] == pytest.approx(800.0)
    assert row["expected_to_date"] == pytest.approx(800.0 * group.assumptions.year_fraction(2026))
    assert row["variance"] == pytest.approx(row["Project"] - row["expected_to_date"])


# -------------------------------------------------------------------- shapes


def test_zero_hour_allocations_are_dropped(group):
    assert group.budget_by_person_project(2028).empty


def test_reporting_year_is_the_last_year_with_registrations(group):
    assert group.years == [2026, 2027, 2028]
    assert group.reporting_year == 2026


def test_second_group_tag_is_picked_up(group):
    assert group.second_groups() == {
        "Grace Hopper": "Atmosfæreforskning / Atmospheric Sciences"
    }


def test_project_team_spans_years(group):
    team = group.project_team("ALPHA")
    assert set(team["person"]) == {"Ada Lovelace", "Forsker Climate Mitigation"}
    assert set(team["year"]) == {2026, 2027}


# ------------------------------------------------------------------- figures


def _menu(fig):
    return fig.layout.updatemenus[0]


@pytest.mark.parametrize("build", [F.fig_person_budget_stack, F.fig_person_burn])
def test_people_figures_offer_every_year_with_hours(group, build):
    fig = build(group, 2026)
    assert [b["label"] for b in _menu(fig).buttons] == ["2026", "2027"], (
        "2028 budgets nothing and has nothing booked, so it is not offered"
    )


@pytest.mark.parametrize("build", [F.fig_person_budget_stack, F.fig_person_burn])
def test_each_trace_belongs_to_exactly_one_year(group, build):
    fig = build(group, 2026)
    masks = [b["args"][0]["visible"] for b in _menu(fig).buttons]
    assert all(len(m) == len(fig.data) for m in masks)
    assert [sum(t) for t in zip(*masks, strict=True)] == [1] * len(fig.data)


@pytest.mark.parametrize("build", [F.fig_person_budget_stack, F.fig_person_burn])
def test_the_year_on_show_is_the_year_the_picker_names(group, build):
    fig = build(group, group.reporting_year)
    menu = _menu(fig)
    assert menu.buttons[menu.active]["label"] == str(group.reporting_year)
    assert [t.visible for t in fig.data] == list(menu.buttons[menu.active]["args"][0]["visible"])


def test_switching_year_re_sorts_the_people(group):
    fig = F.fig_person_budget_stack(group, 2026)
    later = next(b for b in _menu(fig).buttons if b["label"] == "2027")
    assert "2027" in later["args"][1]["title.text"]
    assert list(later["args"][1]["yaxis.categoryarray"]) == [
        "Ada Lovelace", "Forsker Climate Mitigation",
    ], "smallest first, so the biggest commitment is at the top of the chart"


def test_burn_says_so_when_a_year_has_not_started(group):
    fig = F.fig_person_burn(group, 2026)
    later = next(b for b in _menu(fig).buttons if b["label"] == "2027")
    assert "Nothing is booked to 2027 yet" in later["args"][1]["title.text"]
    assert "50% of 2026's working year" in fig.layout.title.text, "as_of is 2 July"


# ------------------------------------------------- internal time and absence


def test_nonproject_time_splits_by_task(group):
    rest = group.nonproject_by_person_task(2026)
    assert set(rest["person"]) == {"Grace Hopper"}, "Ada books none of this"
    assert dict(zip(rest["task"], rest["hours"], strict=True)) == {
        "92 - Ferie": pytest.approx(187.5),
        "11 - Drift/Operations": pytest.approx(150.0),
        "11-2 - Prosjektutv. & akkv. Bidragsforskning/Project Development and Acquisition"
        " - Research funding": pytest.approx(60.0),
        "90 - Syk, Egenmelding/Sick Leave (Self-Certified)": pytest.approx(22.5),
    }
    assert set(rest["category"]) == {"Internal", "Absence"}


@pytest.mark.parametrize(
    "raw, label",
    [
        ("92 - Ferie/Vacation", "Vacation"),
        ("92 - Ferie", "Ferie"),
        ("90 - Syk, Egenmelding/Sick Leave (Self-Certified)", "Sick Leave (Self-Certified)"),
        ("11-10 - Vitenskapelig datastøtte", "Vitenskapelig datastøtte"),
        # The English half of this one carries a dash of its own.
        ("11-2 - Prosjektutv./Project Development - Research funding",
         "Project Development - Research funding"),
        (None, "Unspecified"),
        ("", "Unspecified"),
    ],
)
def test_task_labels_lose_the_code_and_keep_the_english(raw, label):
    assert F._task_label(raw) == label


def test_deep_dive_shows_the_rest_of_the_year_by_task(group):
    fig = F.fig_person_deep_dive(group, 2026)
    grace = next(b for b in _menu(fig).buttons if b["label"] == "Grace Hopper")
    heading = grace["args"][1]["annotations[2].text"]
    assert "210 h absence" in heading and "210 h internal" in heading
    assert list(grace["args"][1]["yaxis3.categoryarray"]) == [
        "Sick Leave (Self-Certified)", "Project Development and Acquisition - Research funding",
        "Operations", "Ferie",
    ], "smallest first, so the biggest slice of the year is at the top"

    visible = grace["args"][0]["visible"]
    panel = [t for t, on in zip(fig.data, visible, strict=True)
             if on and getattr(t, "xaxis", None) == "x3"]
    assert [t.name for t in panel] == ["Internal", "Absence"]
    assert sum(sum(t.x) for t in panel) == pytest.approx(420.0)


def test_deep_dive_says_when_someone_books_nothing_off_projects(group):
    fig = F.fig_person_deep_dive(group, 2026)
    ada = next(b for b in _menu(fig).buttons if b["label"] == "Ada Lovelace")
    assert ada["args"][1]["annotations[2].text"] == (
        "The rest of 2026: nothing booked outside projects"
    )
    assert list(ada["args"][1]["yaxis3.categoryarray"]) == []
    assert ada["args"][1]["xaxis3.visible"] is False, "no empty grid where there is no data"
    assert fig.layout.xaxis3.visible is False, "and none on the person it opens on"


# ----------------------------------------------------------------- dashboard


def test_dashboard_builds_a_self_contained_page(group, tmp_path):
    out = build_dashboard(group, tmp_path / "dash.html", title="Test Group")
    html = out.read_text(encoding="utf-8")
    assert "Plotly" in html, "plotly.js is inlined, so the file opens offline"
    assert html.count('class="plotly-graph-div') == 10
    for tab in ("overview", "people", "projects", "deepdive", "matrix", "board"):
        assert f'id="{tab}"' in html
    assert "Test Group" in html


# --------------------------------------------------------------------- board


def test_board_makes_every_budgeted_hour_a_block(group):
    blocks = board_data(group)["blocks"]
    assert {(b["project"], b["year"], b["origin"]) for b in blocks} == {
        ("ALPHA", 2026, "Ada Lovelace"),
        ("ALPHA", 2027, "Ada Lovelace"),
        ("ALPHA", 2027, None),
        ("BETA", 2026, "Grace Hopper"),
    }, "the zero-hour 2028 line is dropped"


def test_board_blocks_start_where_they_are_budgeted(group):
    for b in board_data(group)["blocks"]:
        assert b["owner"] == b["origin"]
        assert b["year"] == b["oyear"]


def test_board_knows_which_years_each_project_is_funded_in(group):
    assert board_data(group)["project_years"] == {"ALPHA": [2026, 2027], "BETA": [2026]}


def test_board_baseline_matches_the_named_budget(group):
    baseline = board_data(group)["baseline"]
    assert baseline["Ada Lovelace"] == {2026: 800.0, 2027: 400.0}
    assert baseline["Grace Hopper"] == {2026: 500.0}
    assert "Forsker Climate Mitigation" not in baseline


def test_board_opens_on_the_year_with_most_unassigned_time(group):
    assert board_data(group)["default_year"] == 2027


def test_board_annualises_each_persons_own_billing_rate(group):
    rate = board_data(group)["rate"]
    frac = group.assumptions.year_fraction(2026)
    assert rate["Ada Lovelace"] == pytest.approx(round(400.0 / frac, -1))
    assert "Grace Hopper" in rate


def test_board_rate_is_omitted_too_early_in_the_year(export):
    early = build_group(load_export(export), Assumptions(as_of=dt.date(2026, 1, 8)))
    assert board_data(early)["rate"] == {}


def test_board_carries_the_billing_standard_as_a_guide(group):
    assert board_data(group)["billable_hours"] == 1250.0


def test_board_html_embeds_its_data_and_controls(group):
    markup = board_html(group)
    assert "window.BOARD_DATA" in markup
    for control in ("pool-chips", "people-grid", "board-reset", "board-undo",
                    "board-add", "board-csv", "year-2027"):
        assert control in markup
