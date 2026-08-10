#!/usr/bin/env python3
"""Thin wrapper so the tool runs from a checkout without installing it.

    python build_dashboard.py export.csv -o hours.html --as-of 2026-08-10
"""

import sys

from cicero_hours.cli import main

if __name__ == "__main__":
    sys.exit(main())
