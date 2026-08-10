# cicero-hours

Turns the CICERO *Timer budsjettert og registrert pr. medarbeider* export into a
single self-contained HTML dashboard of project hours, budgets and allocation
across a research group.

Five views: group capacity by year, per-person allocation and burn, per-project
teams over time, a deep dive into any one researcher, and a person-by-project matrix.

## Install

```bash
git clone git@github.com:<you>/cicero-hours.git
cd cicero-hours
pip install -e ".[dev]"
```

## Run

```bash
cicero-hours Timer_budsjettert_og_registrert.csv \
    -o hours_dashboard.html \
    --as-of 2026-08-10 \
    --title "Climate Mitigation" \
    --summary
```

Or without installing, from a checkout: `python build_dashboard.py ...`

The output inlines plotly.js, so it opens offline and can be shared as one file.

| Flag | Default | What it does |
|---|---|---|
| `--as-of` | today | Date the registered hours run to. Sets the straight-line "on plan" marks. |
| `--billable-hours` | 1250 | Billable project hours expected from a full-time researcher in a year. |
| `--group-tag` | most common in the export | Specification 5 description identifying the group. |
| `--exclude` | none | Extra people to leave out, beyond those the group tag already filters. |
| `--holidays` | none | Weekday public holidays (`YYYY-MM-DD ...`) excluded when pro-rating the year. |
| `--title` | Climate Mitigation | Group name in the page header. |
| `--summary` | off | Also print the per-person table to the terminal. |

## Data protection

**The export is personal data about named staff. Do not commit it.** `.gitignore`
excludes `*.csv`, `*.xlsx`, `data/` and any rendered `*_dashboard.html`, since the
rendered page embeds the same information. The test suite builds its own synthetic
export in `tests/synthetic.py` rather than relying on a real one.

## What the export actually contains

* Several tables concatenated into one file, each with its own header row. The
  first block (`Budget Type`, `Description`) carries no project or person key and
  is discarded. Tables are found by column signature, not row offset, so a new
  export drops straight in.
* Budgeted hours cover project accounts only (job numbers from 31000 up).
  Registered hours also include internal CICERO time (10501, 10506) and absence
  (10503). Every budget-versus-actual comparison here therefore uses project time
  alone, with the other two shown separately rather than folded in.
* Registered rows repeat per activity code, including cost-only rows with no
  hours. `tidy_registered` collapses them to person / project / task / year.
* `Forsker Climate Mitigation` is not a colleague. It carries hours budgeted to
  the group with no name against them yet, and is drawn hatched throughout.
* The export reaches beyond the group. Shared projects pull in colleagues from
  other groups, and central staff appear against institute-wide accounts.
  Membership is decided by the group tag in Specification 5 rather than a list of
  names, so joiners and leavers need no code change; `--exclude` covers whatever
  the tag misses.
* The 1250 h billing standard is project time expected from a full-time
  researcher, not contracted hours. The rest of the working year is internal time
  and absence, which is why every capacity rule applies to project hours only.
* There are no timestamps anywhere in the file, which is why `--as-of` exists.
  Norwegian holiday leave is not spread evenly through the year, so a straight-line
  expectation read in August will understate the summer months.

## Layout

| Module | Job |
|---|---|
| `loader.py` | Finds the tables inside the export by column signature. |
| `model.py` | Tidies both tables, categorises time, holds capacity and pro-rating assumptions. |
| `figures.py` | One function per figure, each taking a `Group`. |
| `dashboard.py` | Page shell, KPI strip, tabs, notes. |
| `cli.py` | Argument parsing. |

Adding a view means one function in `figures.py` and one entry in the `tabs` list
in `dashboard.py`. Account numbers, the project job-number floor and the
unallocated pseudo-employee name are constants at the top of `model.py`; change
them there if the finance system changes.

## Development

```bash
pytest -q
ruff check .
```

## Licence

MIT.
