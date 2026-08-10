from __future__ import annotations

import datetime as dt

import pytest

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
    assert by_cat["Internal"] == pytest.approx(150.0)
    assert by_cat["Absence"] == pytest.approx(187.5)


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


# ----------------------------------------------------------------- dashboard


def test_dashboard_builds_a_self_contained_page(group, tmp_path):
    out = build_dashboard(group, tmp_path / "dash.html", title="Test Group")
    html = out.read_text(encoding="utf-8")
    assert "Plotly" in html, "plotly.js is inlined, so the file opens offline"
    assert html.count('class="plotly-graph-div') == 10
    for tab in ("overview", "people", "projects", "deepdive", "matrix"):
        assert f'id="{tab}"' in html
    assert "Test Group" in html
