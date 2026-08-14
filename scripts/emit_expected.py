"""Regenerate spec/expected.json from the synthetic export.

The browser build is coming next, and its cross-check compares its own
computations against this file. A Python change that alters the numbers
therefore fails a Python test (the one in tests/test_expected.py) and,
later, a Node test in the same shape, rather than silently drifting away
from what the JavaScript is asserting.

Fixed inputs, chosen to match the pipeline tests: the synthetic export,
an as_of of 2 July 2026 (roughly half a working year through 2026), the
1250 h billing standard, no holidays.

Regenerate deliberately, not casually. Commit the change together with
the code change that caused it, and say in the commit message why the
numbers moved.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import math
import sys
import tempfile
from pathlib import Path

# So the synthetic fixture (in tests/) is importable when the script is run
# directly, without asking anyone to remember `python -m scripts.emit_expected`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from cicero_hours import figures as F  # noqa: E402
from cicero_hours._rules import BILLABLE_HOURS_DEFAULT  # noqa: E402
from cicero_hours.board import board_data  # noqa: E402
from cicero_hours.loader import load_export  # noqa: E402
from cicero_hours.model import Assumptions, Group, build_group  # noqa: E402
from tests.synthetic import write_export  # noqa: E402

AS_OF = dt.date(2026, 7, 2)

REPO_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PATH = REPO_ROOT / "spec" / "expected.json"

# Rounding precision for stored floats. Six places is well below any hours
# figure in the export while leaving room for pro-rated fractions and rates.
FLOAT_PRECISION = 6


def _jsonable(v):
    """Convert one value to something json.dumps can handle deterministically."""
    if v is None or v is pd.NA:
        return None
    # bool is a subclass of int, so this branch must come first.
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if math.isnan(f) else round(f, FLOAT_PRECISION)
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    # Last resort for pandas Timestamps, NaT, and friends.
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame to list of JSON-safe records, preserving row order."""
    columns = list(df.columns)
    return [
        {c: _jsonable(row[c]) for c in columns}
        for _, row in df.iterrows()
    ]


def _decode_array(v):
    """Plotly's to_dict() encodes numpy arrays as {'dtype': 'f8', 'bdata': ...}
    (base64 of the raw bytes). Turn that back into a plain list so the
    JavaScript output can be compared to it row for row."""
    if isinstance(v, dict) and "bdata" in v and "dtype" in v:
        return list(np.frombuffer(base64.b64decode(v["bdata"]), dtype=v["dtype"]))
    return v


def _figure_snapshot(fig) -> dict:
    """A compact, JSON-safe view of what the figure will actually draw.

    Not fig.to_dict() as-is: that carries plotly defaults and hover strings that
    the JS mirror does not need to match verbatim. Snapshot the shape (trace
    type, orientation, name), the numeric data (x, y) and the semantic layout
    bits (barmode, category order, menu masks, capacity zone counts) so the
    cross-check catches a real disagreement without flagging cosmetic ones.
    """
    d = fig.to_dict()
    traces = []
    for t in d.get("data", []):
        rec = {
            "type": t.get("type"),
            "name": t.get("name"),
        }
        for k in ("orientation", "mode", "visible", "legendgroup", "offsetgroup", "xaxis", "yaxis"):
            if k in t and t.get(k) is not None:
                rec[k] = t[k]
        for k in ("x", "y"):
            if k in t:
                decoded = _decode_array(t[k])
                rec[k] = None if decoded is None else [_jsonable(v) for v in decoded]
        # Hatched (unallocated) marker segments matter for reading the bar; the
        # colour value is stable per-project and worth pinning too.
        marker = t.get("marker") or {}
        if isinstance(marker, dict):
            mrec = {}
            if "color" in marker:
                mrec["color"] = marker["color"]
            pattern = marker.get("pattern") or {}
            if isinstance(pattern, dict) and pattern.get("shape"):
                mrec["pattern_shape"] = pattern["shape"]
            if mrec:
                rec["marker"] = mrec
        traces.append(rec)

    layout_in = d.get("layout", {}) or {}
    layout = {
        "barmode": layout_in.get("barmode"),
        "height": layout_in.get("height"),
    }
    yaxis = layout_in.get("yaxis") or {}
    if isinstance(yaxis, dict):
        if yaxis.get("categoryorder"):
            layout["yaxis_categoryorder"] = yaxis["categoryorder"]
        if yaxis.get("categoryarray") is not None:
            layout["yaxis_categoryarray"] = list(yaxis["categoryarray"])
    shapes = layout_in.get("shapes") or []
    layout["shape_count"] = len(shapes)
    annotations = layout_in.get("annotations") or []
    layout["annotation_texts"] = [str(a.get("text", "")) for a in annotations]

    menus = []
    for m in layout_in.get("updatemenus") or []:
        for b in m.get("buttons") or []:
            entry = {"label": b.get("label")}
            args = b.get("args") or []
            if args:
                if isinstance(args[0], dict) and "visible" in args[0]:
                    entry["visible"] = list(args[0]["visible"])
                if len(args) > 1 and isinstance(args[1], dict):
                    l1 = args[1]
                    if "yaxis.categoryarray" in l1:
                        entry["yaxis_categoryarray"] = list(l1["yaxis.categoryarray"])
                    if "title.text" in l1:
                        entry["title_text"] = l1["title.text"]
                    if "height" in l1:
                        entry["height"] = l1["height"]
            menus.append(entry)
    return {"traces": traces, "layout": layout, "menus": menus}


def _snapshot_figures(g: Group, year: int) -> dict:
    """Build every figure the dashboard shows and snapshot it."""
    return {
        # People tab
        "fig_person_forward": _figure_snapshot(F.fig_person_forward(g)),
        "fig_person_budget_stack": _figure_snapshot(F.fig_person_budget_stack(g, year)),
        "fig_person_burn": _figure_snapshot(F.fig_person_burn(g, year)),
    }


def _snapshot_group(g: Group) -> dict:
    years = g.years
    return {
        "group_tag": g.group_tag,
        "excluded": list(g.excluded),
        "years": [int(y) for y in years],
        "people": list(g.people),
        "reporting_year": int(g.reporting_year),
        "second_groups": {p: s for p, s in sorted(g.second_groups().items())},
        "year_fractions": {
            str(y): round(g.assumptions.year_fraction(y), FLOAT_PRECISION) for y in years
        },
        "budget": _records(g.budget),
        "registered": _records(g.registered),
        "person_summary": {
            str(y): _records(g.person_summary(y).reset_index()) for y in years
        },
        "project_summary": _records(g.project_summary()),
        "nonproject_by_person_task": {
            str(y): _records(g.nonproject_by_person_task(y)) for y in years
        },
        "board": _jsonable(board_data(g)),
        "figures": _snapshot_figures(g, g.reporting_year),
    }


def compute() -> dict:
    """The one function the emitter and the pin test both call."""
    with tempfile.TemporaryDirectory() as td:
        export = write_export(Path(td) / "synth.csv")
        g = build_group(
            load_export(export),
            Assumptions(as_of=AS_OF, billable_hours=BILLABLE_HOURS_DEFAULT),
        )
        snapshot = _snapshot_group(g)

    return {
        "as_of": AS_OF.isoformat(),
        "billable_hours": round(BILLABLE_HOURS_DEFAULT, FLOAT_PRECISION),
        **snapshot,
    }


def write(path: Path | None = None) -> Path:
    path = path or EXPECTED_PATH
    payload = compute()
    # sort_keys so the file diffs cleanly when only a leaf value moves.
    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


if __name__ == "__main__":
    out = write()
    print(f"wrote {out}")
