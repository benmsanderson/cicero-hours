"""Turn the raw export tables into tidy frames and derived quantities."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ._rules import (
    ABSENCE_JOBS,
    BILLABLE_HOURS_DEFAULT,
    CATEGORY_ORDER,
    INTERNAL_JOBS,
    PROJECT_JOB_FLOOR,
    UNALLOCATED_PERSON,
)
from .loader import RawExport

# Re-exported so `from cicero_hours.model import UNALLOCATED_PERSON` still works;
# the values themselves live in spec/rules.json.
__all__ = [
    "ABSENCE_JOBS",
    "Assumptions",
    "CATEGORY_ORDER",
    "Group",
    "INTERNAL_JOBS",
    "PROJECT_JOB_FLOOR",
    "UNALLOCATED_PERSON",
    "build_group",
    "tidy_budget",
    "tidy_registered",
]


@dataclass
class Assumptions:
    """Everything the analysis needs that is not in the export."""

    as_of: dt.date = field(default_factory=dt.date.today)
    # Billable project hours expected from a researcher on a 100% position in one
    # year. This is the institute's billing standard, not contracted hours: the
    # gap between the two is internal time, absence and everything non-billable.
    billable_hours: float = BILLABLE_HOURS_DEFAULT
    # Public holidays falling on weekdays, used to pro-rate the year.
    holidays: tuple[str, ...] = ()

    def year_fraction(self, year: int) -> float:
        """Share of the year's working days that have elapsed at as_of."""
        start = dt.date(year, 1, 1)
        end = dt.date(year + 1, 1, 1)
        if self.as_of <= start:
            return 0.0
        if self.as_of >= end:
            return 1.0
        hol = np.array(self.holidays or [], dtype="datetime64[D]")
        total = np.busday_count(start, end, holidays=hol)
        done = np.busday_count(start, self.as_of, holidays=hol)
        return float(done) / float(total) if total else 0.0


def _category(job_no: float) -> str:
    if pd.isna(job_no):
        return "Other"
    job = int(job_no)
    if job in ABSENCE_JOBS:
        return "Absence"
    if job in INTERNAL_JOBS:
        return "Internal"
    if job >= PROJECT_JOB_FLOOR:
        return "Project"
    return "Other"


def _project_label(prosjekt: str) -> str:
    """'31679 - FUTURA' becomes 'FUTURA'. Falls back to the raw string."""
    if not isinstance(prosjekt, str):
        return "Unknown"
    parts = prosjekt.split(" - ", 1)
    return parts[1].strip() if len(parts) == 2 else prosjekt.strip()


def _clean(series: pd.Series) -> pd.Series:
    return series.astype("string").str.strip().replace({"": pd.NA})


def tidy_budget(raw: RawExport) -> pd.DataFrame:
    df = raw.require("budget").copy()
    out = pd.DataFrame(
        {
            "person": _clean(df["Medarbeider"]),
            "project_no": pd.to_numeric(df["Job No."], errors="coerce"),
            "project_full": _clean(df["Prosjekt"]),
            "task": _clean(df["Oppgave"]),
            "year": pd.to_numeric(df["Budget Type"], errors="coerce").astype("Int64"),
            "hours": pd.to_numeric(df["Quantity - Hours"], errors="coerce").fillna(0.0),
            "value": pd.to_numeric(df.get("Total Billing Price - Company"), errors="coerce"),
            "pm": _clean(df["Project Manager Name"]),
            "department": _clean(df["Avdeling"]),
            "group_tag": _clean(df["Specification5Description"]),
            "second_group": _clean(df.get("Specification6Description", pd.Series(dtype="object"))),
        }
    )
    out["project"] = out["project_full"].map(_project_label)
    out["category"] = out["project_no"].map(_category)
    out["unallocated"] = out["person"] == UNALLOCATED_PERSON
    return out.dropna(subset=["year"]).reset_index(drop=True)


def tidy_registered(raw: RawExport) -> pd.DataFrame:
    df = raw.require("registered").copy()
    out = pd.DataFrame(
        {
            "person": _clean(df["Medarbeider"]),
            "project_no": pd.to_numeric(df["Job No."], errors="coerce"),
            "project_full": _clean(df["Prosjekt"]),
            "task": _clean(df["Oppgave"]),
            "year": pd.to_numeric(df["Year str"], errors="coerce").astype("Int64"),
            "hours": pd.to_numeric(df["Hours - Reg."], errors="coerce").fillna(0.0),
            "value": pd.to_numeric(df.get("Billing Price Reg. - Company"), errors="coerce"),
            "activity": pd.to_numeric(df["Activity No."], errors="coerce").astype("Int64"),
            "department": _clean(df["Avdeling"]),
            "group_tag": _clean(df["Employee Specification 5 Descr."]),
        }
    )
    out["project"] = out["project_full"].map(_project_label)
    out["category"] = out["project_no"].map(_category)
    # The registered table carries several rows per key, one per activity code,
    # including pure cost rows with zero hours. Collapse to the analysis key.
    keys = ["person", "project_no", "project", "project_full", "task", "year",
            "category", "group_tag"]
    out = (
        out.groupby(keys, dropna=False, as_index=False)
        .agg(hours=("hours", "sum"), value=("value", "sum"))
        .query("hours != 0 or value != 0")
    )
    return out.dropna(subset=["year"]).reset_index(drop=True)


@dataclass
class Group:
    """Tidy budget and registration for one organisational group."""

    budget: pd.DataFrame
    registered: pd.DataFrame
    assumptions: Assumptions
    group_tag: str | None = None
    excluded: tuple[str, ...] = ()

    # ---------------------------------------------------------------- people

    @property
    def years(self) -> list[int]:
        ys = set(self.budget["year"].dropna()) | set(self.registered["year"].dropna())
        return sorted(int(y) for y in ys)

    @property
    def reporting_year(self) -> int:
        """The most recent year with registered hours."""
        reg_years = self.registered["year"].dropna()
        return int(reg_years.max()) if len(reg_years) else self.years[-1]

    @property
    def people(self) -> list[str]:
        names = set(self.budget.loc[~self.budget["unallocated"], "person"].dropna())
        names |= set(self.registered["person"].dropna())
        return sorted(names)

    def second_groups(self) -> dict[str, str]:
        """People tagged to a second research group, and which one."""
        tagged = self.budget.dropna(subset=["second_group"])
        return (
            tagged.groupby("person")["second_group"]
            .agg(lambda s: s.mode().iloc[0])
            .to_dict()
        )

    # --------------------------------------------------------------- rollups

    def registered_by_category(self, year: int | None = None) -> pd.DataFrame:
        df = self.registered
        if year is not None:
            df = df[df["year"] == year]
        return (
            df.pivot_table(index="person", columns="category", values="hours", aggfunc="sum")
            .reindex(columns=CATEGORY_ORDER)
            .fillna(0.0)
        )

    def budget_by_person_project(self, year: int, include_unallocated: bool = True) -> pd.DataFrame:
        df = self.budget[(self.budget["year"] == year) & (self.budget["category"] == "Project")]
        if not include_unallocated:
            df = df[~df["unallocated"]]
        return df.groupby(["person", "project"], as_index=False)["hours"].sum().query("hours > 0")

    def registered_by_person_project(self, year: int) -> pd.DataFrame:
        df = self.registered[
            (self.registered["year"] == year) & (self.registered["category"] == "Project")
        ]
        return df.groupby(["person", "project"], as_index=False)["hours"].sum().query("hours > 0")

    def nonproject_by_person_task(self, year: int) -> pd.DataFrame:
        """Internal time and absence for one year, split by the task booked to.

        The task is the only detail the export carries about time spent off
        projects, and it is a good deal: which kind of internal work, and which
        kind of leave. Rows with no task are kept rather than dropped, since the
        hours are real either way.
        """
        df = self.registered[
            (self.registered["year"] == year) & (self.registered["category"] != "Project")
        ]
        out = (
            df.groupby(["person", "category", "task"], dropna=False, as_index=False)["hours"]
            .sum()
            .query("hours > 0")
        )
        return out.sort_values("hours", ascending=False).reset_index(drop=True)

    def person_summary(self, year: int) -> pd.DataFrame:
        """One row per person: budget, registration by category, expected-to-date."""
        budget = (
            self.budget[(self.budget["year"] == year) & (self.budget["category"] == "Project")]
            .groupby("person")["hours"]
            .sum()
            .rename("project_budget")
        )
        cats = self.registered_by_category(year)
        out = pd.concat([budget, cats], axis=1).fillna(0.0)
        out = out.drop(index=UNALLOCATED_PERSON, errors="ignore")
        out["registered_total"] = out[CATEGORY_ORDER].sum(axis=1)
        frac = self.assumptions.year_fraction(year)
        out["expected_to_date"] = out["project_budget"] * frac
        out["variance"] = out["Project"] - out["expected_to_date"]
        out["billable_target"] = self.assumptions.billable_hours
        out["n_projects"] = (
            self.budget[
                (self.budget["year"] == year)
                & (self.budget["category"] == "Project")
                & (self.budget["hours"] > 0)
            ]
            .groupby("person")["project"]
            .nunique()
            .reindex(out.index)
            .fillna(0)
            .astype(int)
        )
        return out.sort_values("project_budget", ascending=False)

    def project_summary(self) -> pd.DataFrame:
        """One row per project per year: budget split named/unallocated, plus registration."""
        b = self.budget[self.budget["category"] == "Project"]
        named = (
            b[~b["unallocated"]].groupby(["project", "year"])["hours"].sum().rename("budget_named")
        )
        unalloc = (
            b[b["unallocated"]].groupby(["project", "year"])["hours"].sum()
            .rename("budget_unallocated")
        )
        reg = (
            self.registered[self.registered["category"] == "Project"]
            .groupby(["project", "year"])["hours"]
            .sum()
            .rename("registered")
        )
        out = pd.concat([named, unalloc, reg], axis=1).fillna(0.0).reset_index()
        pm = b.dropna(subset=["pm"]).groupby("project")["pm"].agg(lambda s: s.mode().iloc[0])
        out["pm"] = out["project"].map(pm)
        out["budget_total"] = out["budget_named"] + out["budget_unallocated"]
        return out

    def project_team(self, project: str) -> pd.DataFrame:
        """Budgeted hours per person per year for one project."""
        b = self.budget
        df = b[(b["project"] == project) & (b["category"] == "Project")]
        return df.groupby(["person", "year"], as_index=False)["hours"].sum().query("hours > 0")


def build_group(
    raw: RawExport,
    assumptions: Assumptions | None = None,
    group_tag: str | None = None,
    exclude: tuple[str, ...] = (),
) -> Group:
    """Tidy an export and narrow it to one research group.

    The export reaches beyond the group: shared projects pull in colleagues from
    elsewhere, and central staff appear against institute-wide accounts. Rows
    carry a group tag in Specification 5, so that is what decides membership,
    rather than a hard-coded list of names. `exclude` is there for the cases the
    tag does not catch.
    """
    assumptions = assumptions or Assumptions()
    budget = tidy_budget(raw)
    registered = tidy_registered(raw)

    tag = group_tag
    if tag is None:
        tags = budget["group_tag"].dropna()
        tag = tags.mode().iloc[0] if len(tags) else None

    before = set(budget["person"].dropna()) | set(registered["person"].dropna())
    if tag is not None:
        budget = budget[budget["group_tag"] == tag]
        registered = registered[registered["group_tag"] == tag]
    if exclude:
        budget = budget[~budget["person"].isin(exclude)]
        registered = registered[~registered["person"].isin(exclude)]
    after = set(budget["person"].dropna()) | set(registered["person"].dropna())

    return Group(
        budget=budget.reset_index(drop=True),
        registered=registered.reset_index(drop=True),
        assumptions=assumptions,
        group_tag=tag,
        excluded=tuple(sorted(before - after)),
    )
