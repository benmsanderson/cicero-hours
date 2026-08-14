"""Shared domain constants, loaded once from ``spec/rules.json``.

The browser build will import the same file at bundle time, so account numbers
and the unallocated pseudo-employee's name cannot silently disagree between the
two tools. Add a new constant here and in ``spec/rules.json`` together.
"""

from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "spec" / "rules.json"
_DATA = json.loads(_PATH.read_text(encoding="utf-8"))

PROJECT_JOB_FLOOR: int = int(_DATA["project_job_floor"])
ABSENCE_JOBS: set[int] = {int(j) for j in _DATA["absence_jobs"]}
INTERNAL_JOBS: set[int] = {int(j) for j in _DATA["internal_jobs"]}

UNALLOCATED_PERSON: str = str(_DATA["unallocated_person"])
CATEGORY_ORDER: list[str] = list(_DATA["category_order"])

BILLABLE_HOURS_DEFAULT: float = float(_DATA["billable_hours_default"])

TABLE_SIGNATURES: list[tuple[str, set[str]]] = [
    (entry["name"], set(entry["columns"])) for entry in _DATA["table_signatures"]
]
