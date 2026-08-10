"""Read the CICERO 'Timer budsjettert og registrert pr. medarbeider' export.

The export is not a single CSV. It concatenates several tables, each preceded
by its own quoted header row, and the row offsets move between exports. This
module finds the header rows by signature instead of by position, so a new
export drops straight in.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

# A table is recognised by columns it must contain. First match wins, so put
# the more specific signatures first.
TABLE_SIGNATURES: list[tuple[str, set[str]]] = [
    ("registered", {"Medarbeider", "Prosjekt", "Hours - Reg.", "Year str"}),
    ("budget", {"Medarbeider", "Prosjekt", "Quantity - Hours", "Budget Type"}),
]


@dataclass
class RawExport:
    """The parsed blocks of one export file."""

    tables: dict[str, pd.DataFrame]
    unrecognised: list[pd.DataFrame]
    source: Path

    def require(self, name: str) -> pd.DataFrame:
        if name not in self.tables:
            found = ", ".join(sorted(self.tables)) or "none"
            raise KeyError(
                f"No '{name}' table in {self.source.name}. Recognised tables: {found}. "
                "If the export format changed, update TABLE_SIGNATURES in loader.py."
            )
        return self.tables[name]


def _split_blocks(text: str) -> list[list[str]]:
    """Split the file into blocks, each starting at a line that looks like a header.

    A header line is taken to be one whose every field is a bare quoted string
    and which is followed by at least one data line. That is deliberately loose:
    the point is to survive column reordering and added columns.
    """
    lines = text.splitlines()
    starts: list[int] = []
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        fields = _sniff_fields(line)
        if fields is None:
            continue
        # Header rows in this export are all-text and contain no pure numbers.
        if any(_looks_numeric(f) for f in fields):
            continue
        if len(fields) >= 2:
            starts.append(i)
    if not starts:
        return []
    # Consecutive candidate lines are data, not a run of headers: keep the first
    # of each run only if the run length is 1.
    kept = [s for j, s in enumerate(starts) if j == 0 or s != starts[j - 1] + 1]
    kept = [s for s in kept if s + 1 not in starts or True]
    blocks: list[list[str]] = []
    for j, s in enumerate(kept):
        end = kept[j + 1] if j + 1 < len(kept) else len(lines)
        block = [ln for ln in lines[s:end] if ln.strip()]
        if len(block) > 1:
            blocks.append(block)
    return blocks


def _sniff_fields(line: str) -> list[str] | None:
    try:
        parsed = pd.read_csv(io.StringIO(line), header=None, dtype=str)
        row = next(iter(parsed.itertuples(index=False)))
    except Exception:
        return None
    return ["" if pd.isna(v) else str(v) for v in row]


def _looks_numeric(value: str) -> bool:
    v = value.strip().replace(" ", "").replace(",", ".")
    if not v:
        return False
    try:
        float(v)
    except ValueError:
        return False
    return True


def load_export(path: str | Path) -> RawExport:
    """Parse an export file into named tables."""
    path = Path(path)
    text = path.read_text(encoding="utf-8-sig")
    tables: dict[str, pd.DataFrame] = {}
    unrecognised: list[pd.DataFrame] = []

    for block in _split_blocks(text):
        try:
            df = pd.read_csv(io.StringIO("\n".join(block)))
        except Exception:
            continue
        cols = set(df.columns)
        for name, signature in TABLE_SIGNATURES:
            if signature <= cols and name not in tables:
                tables[name] = df
                break
        else:
            unrecognised.append(df)

    return RawExport(tables=tables, unrecognised=unrecognised, source=path)
