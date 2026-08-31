"""Shared domain constants, loaded once from ``spec/rules.json``.

The browser build will import the same file at bundle time, so account numbers
and the unallocated pseudo-employee's name cannot silently disagree between the
two tools. Add a new constant here and in ``spec/rules.json`` together.
"""

from __future__ import annotations

import json
from pathlib import Path

_SPEC = Path(__file__).resolve().parents[1] / "spec"
_DATA = json.loads((_SPEC / "rules.json").read_text(encoding="utf-8"))


def _spec_text(name: str) -> str:
    """Read a companion file from spec/ verbatim. The browser build reads the
    same file at bundle time, so the two dashboards cannot drift on styling."""
    return (_SPEC / name).read_text(encoding="utf-8")

PROJECT_JOB_FLOOR: int = int(_DATA["project_job_floor"])
ABSENCE_JOBS: set[int] = {int(j) for j in _DATA["absence_jobs"]}
INTERNAL_JOBS: set[int] = {int(j) for j in _DATA["internal_jobs"]}

UNALLOCATED_PERSON: str = str(_DATA["unallocated_person"])
CATEGORY_ORDER: list[str] = list(_DATA["category_order"])

# Project work funded from CICERO's own strategic pot rather than by a customer.
# The finance system gives it its own activity code; see spec/rules.json.
INTERNAL_PROJECT_ACTIVITY: int = int(_DATA["internal_project_activity"])
INTERNAL_PROJECT_LABEL: str = str(_DATA["internal_project_label"])
EXTERNAL_PROJECT_LABEL: str = str(_DATA["external_project_label"])

# Project time split by where the money comes from, in stacking order. The
# two halves take the place of the single "Project" category.
TYPE_ORDER: list[str] = [
    EXTERNAL_PROJECT_LABEL,
    INTERNAL_PROJECT_LABEL,
    *(c for c in CATEGORY_ORDER if c != "Project"),
]

BILLABLE_HOURS_DEFAULT: float = float(_DATA["billable_hours_default"])

TABLE_SIGNATURES: list[tuple[str, set[str]]] = [
    (entry["name"], set(entry["columns"])) for entry in _DATA["table_signatures"]
]

SHELL_CSS: str = _spec_text("shell.css")
BOARD_CSS: str = _spec_text("board.css")
BOARD_JS: str = _spec_text("board.js")
