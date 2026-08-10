#!/usr/bin/env python3
"""Build a dashboard from the synthetic export, for the jsdom board harness.

    python tests/build_fixture_dashboard.py /tmp/fixture.html
    node tests/board_check.js /tmp/fixture.html
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cicero_hours.dashboard import build_dashboard  # noqa: E402
from cicero_hours.loader import load_export  # noqa: E402
from cicero_hours.model import build_group  # noqa: E402
from tests.synthetic import write_export  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixture_dashboard.html")
with tempfile.TemporaryDirectory() as tmp:
    csv = write_export(Path(tmp) / "export.csv")
    build_dashboard(build_group(load_export(csv)), out, title="Fixture Group")
print(f"Wrote {out}")
