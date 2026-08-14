"""Command line entry point.

    cicero-hours export.csv -o hours.html --as-of 2026-08-10

Everything the export does not contain (capacity per full-time year, the
reporting date, public holidays) is passed in here, so a new export needs no
code changes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from ._rules import BILLABLE_HOURS_DEFAULT
from .dashboard import build_dashboard
from .loader import load_export
from .model import Assumptions, build_group


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("csv", type=Path, help="Timer budsjettert og registrert export")
    p.add_argument("-o", "--output", type=Path, default=Path("hours_dashboard.html"))
    p.add_argument("--as-of", type=dt.date.fromisoformat, default=dt.date.today(),
                   help="Date the registered hours run to (YYYY-MM-DD). Default: today.")
    p.add_argument("--billable-hours", type=float, default=BILLABLE_HOURS_DEFAULT,
                   help="Billable project hours expected from a full-time researcher "
                        "in one year. Default: 1250, the CICERO billing standard.")
    p.add_argument("--holidays", nargs="*", default=[],
                   help="Weekday public holidays (YYYY-MM-DD), used to pro-rate the year.")
    p.add_argument("--exclude", nargs="*", default=[],
                   help="People to leave out beyond those the group tag already filters.")
    p.add_argument("--group-tag", default=None,
                   help="Specification 5 description identifying the group. "
                        "Default: the most common one in the budget table.")
    p.add_argument("--title", default="Climate Mitigation")
    p.add_argument("--summary", action="store_true", help="Also print a text summary.")
    args = p.parse_args(argv)

    raw = load_export(args.csv)
    group = build_group(
        raw,
        Assumptions(
            as_of=args.as_of,
            billable_hours=args.billable_hours,
            holidays=tuple(args.holidays),
        ),
        group_tag=args.group_tag,
        exclude=tuple(args.exclude),
    )
    if group.excluded:
        print("Outside the group, left out: " + ", ".join(group.excluded))

    if args.summary:
        year = group.reporting_year
        print(f"Reporting year {year}, {args.as_of} "
              f"({group.assumptions.year_fraction(year):.0%} of working days elapsed)")
        print(group.person_summary(year).round(0).to_string())

    out = build_dashboard(group, args.output, title=args.title)
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
