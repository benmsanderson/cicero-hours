"""Pin the golden aggregates the browser build will assert against.

The browser build's cross-check compares its own numbers to
``spec/expected.json``. If the Python drifts and the file is not
regenerated in the same commit, the two tools quietly disagree.
This test is the alarm: it fails when a code change moves a number,
and the fix is to regenerate the file (and explain the change in the
commit message), not to loosen the assertion.
"""

from __future__ import annotations

import json

from scripts.emit_expected import EXPECTED_PATH, compute


def test_committed_expected_matches_current_code():
    committed = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
    # Round-trip through JSON so dict keys, tuples and pandas scalars are
    # normalised the same way both sides went through when the file was written.
    fresh = json.loads(json.dumps(compute(), sort_keys=True))
    assert fresh == committed, (
        "spec/expected.json is out of date. If this change was intended, "
        "regenerate with `python scripts/emit_expected.py` and commit the "
        "new file alongside the code change that moved the numbers."
    )
