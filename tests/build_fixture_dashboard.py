#!/usr/bin/env python3
"""Build a dashboard from the synthetic export, for the jsdom board harness.

    python tests/build_fixture_dashboard.py /tmp/fixture.html
    node tests/board_check.js /tmp/fixture.html

Pass --all-groups for the view that spans every group in the export, which is
the one where the board has to say who belongs where.
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cicero_hours.dashboard import build_dashboard  # noqa: E402
from cicero_hours.loader import load_export  # noqa: E402
from cicero_hours.model import ALL_GROUPS, build_group  # noqa: E402
from tests.synthetic import write_export  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
every = "--all-groups" in sys.argv

out = Path(args[0] if args else "fixture_dashboard.html")
with tempfile.TemporaryDirectory() as tmp:
    csv = write_export(Path(tmp) / "export.csv")
    group = build_group(load_export(csv), group_tag=ALL_GROUPS if every else None)
    build_dashboard(group, out, title="Fixture Group")
print(f"Wrote {out}")
