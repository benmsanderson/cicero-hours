# cicero-hours

Turns the CICERO *Timer budsjettert og registrert pr. medarbeider* export into a
single self-contained HTML dashboard of project hours, budgets and allocation
across a research group.

Six views: group capacity by year, per-person allocation and burn, per-project
teams over time, a deep dive into any one researcher, a person-by-project matrix,
and a drag-and-drop allocation board for planning meetings.

*One researcher* puts three panels behind a name: this year's budget against what
has been booked, commitments across every year in the export, and — since the
billing standard only accounts for part of a working year — where the rest of the
year went. That last panel splits internal time and leave by the task actually
booked to, which is as much detail as the export carries: vacation, parental
leave, self- and doctor-certified sick leave, and the kinds of internal work, one
bar each. Someone who has booked nothing outside projects is told so rather than
shown an empty grid.

The two People views that read a single year — *Hours budgeted per person* and
*Project time against plan* — carry a year picker in the top right, so a planning
conversation can move from this year to next without rebuilding the page. Each
year is re-sorted and re-scaled on its own terms, and a year still to come says
that nothing is booked to it yet rather than drawing an empty comparison. Years
the export budgets nothing to are not offered.

There are two builds and they show the same six views from the same numbers. The
**browser build** is a page you drop the export onto. The **Python build**
renders a page from the command line. Start with the browser one; reach for the
command line when you need the flags it does not expose.

## Open it in a browser

The browser build is published to GitHub Pages on every push to `main`:
**https://benmsanderson.github.io/cicero-hours/**. Drop your *Timer budsjettert
og registrert pr. medarbeider* CSV onto the page and it renders. That is the
whole procedure — no Python, no environment, no arguments.

**The export never leaves the page.** The CSV is read from your disk by
`FileReader`, parsed in the browser and drawn there. The built page makes no
outbound request at runtime: no `fetch`, no analytics, no service worker, and
plotly.js is inlined rather than pulled from a CDN. That is the point rather
than a detail, because the export is personal data about named staff.

What GitHub sees is the page load itself — IP, user agent, referrer — and not
the file you open with it. If even that is too much, build the page yourself and
open it from your own disk:

```bash
git clone git@github.com:<you>/cicero-hours.git
cd cicero-hours
npm install          # esbuild and plotly, dev only
npm run build        # writes dist/hours_dashboard.html, about 1.4 MB
```

That file is the same dashboard with nothing hosted about it. It carries no data
of its own, so it is also the thing to pass around: mail it to a colleague and
they open their own export in it, offline, by double-click, with nothing to
install.

The reporting date is a date picker in the header rather than a flag, so a
meeting can move it and watch the "on plan" marks follow. Everything else the
page infers from the export: the group tag is read off the rows, and the billing
standard is the 1250 h default.

What the browser cannot do is everything the command line passes as an argument:
overriding the detected group tag, excluding named people, declaring public
holidays for the pro-rating, moving the billing standard off 1250 h, and setting
the page title. It also cannot print the per-person table to a terminal.

## The Python build

From the same checkout, with [uv](https://docs.astral.sh/uv/), into a project
virtualenv:

```bash
uv venv                      # creates .venv on Python >=3.10
uv pip install -e ".[dev]"
source .venv/bin/activate    # or prefix commands with `uv run`
```

Or with pip into an environment of your own:

```bash
pip install -e ".[dev]"
```

Then:

```bash
cicero-hours Timer_budsjettert_og_registrert.csv \
    -o hours_dashboard.html \
    --as-of 2026-08-10 \
    --title "Climate Mitigation" \
    --summary
```

Or without installing, from a checkout: `python build_dashboard.py ...`

This output also inlines plotly.js and opens offline, but unlike the browser
build it has the export baked into it: it is a rendering of one group's hours,
not an empty page waiting for a file. Convenient to keep, and personal data to
handle accordingly.

| Flag | Default | What it does |
|---|---|---|
| `--as-of` | today | Date the registered hours run to. Sets the straight-line "on plan" marks. |
| `--billable-hours` | 1250 | Billable project hours expected from a full-time researcher in a year. |
| `--group-tag` | most common in the export | Specification 5 description identifying the group. |
| `--exclude` | none | Extra people to leave out, beyond those the group tag already filters. |
| `--holidays` | none | Weekday public holidays (`YYYY-MM-DD ...`) excluded when pro-rating the year. |
| `--title` | Climate Mitigation | Group name in the page header. |
| `--summary` | off | Also print the per-person table to the terminal. |

## The allocation board

The last tab is a what-if board for group strategy meetings. **Every** budgeted
hour is a block, including hours that already have a name against them, so an
oversubscribed researcher can hand work to a colleague as easily as spare hours
can be placed. Drag a block onto a card, or click the block and then the card;
split it first if only part should move; the × sends it back to unassigned.
Picking up a block shades the cards it would push past the guide.

*Defer* pushes a block into a later year of the same project. Hours are never
pulled earlier than they were budgeted, and never moved to another project. A
deferral changes the grant's spending profile, so it needs NFR approval before it
is real: deferrals are therefore collected in their own panel at the bottom of the
board, which is the content of that request. The year buttons show the net hours
each year has gained or lost, and the board warns when a block is being pushed
into a year the project has no budget in at all.

A stacked bar of the proposal sits above the cards, the same shape as *Hours
budgeted per person* on the People tab but drawn from the board's own state, so
the effect of a move on the whole group is visible while it is being made. Two
dropdowns: **Year** follows the board or pins any single year or the whole
horizon, which is how you check that hours pushed out of one year land somewhere
survivable; **Show** switches between the stack by project and proposed against
budgeted, side by side. The hatched row is the unassigned pool, and watching it
drain is usually the point of the meeting.

The billing standard is a **guide, not a limit**. Researchers legitimately bill
above and below it, so each card also carries that person's own rate, annualised
from what they have booked so far, and the thin vertical mark on the bar is where
their budget started. Crossing the guide is shaded rather than alarmed; only well
past it turns red.

*Add card* creates a hypothetical person. When the arithmetic will not close on
the people you have, the honest output of the meeting is an FTE case, and the
board should be able to express that.

*Undo* steps back through moves. *Download CSV* and *Show plan as text* export the
result, with where each block started alongside where it ended, plus a change
summary per person for the minutes.

### Picking a reallocation up again

A reallocation rarely finishes in one sitting. *Save plan file* names a text file
and the page keeps it up to date from then on; *Open plan file* loads it back in a
later session, restoring every block, split, deferral and hypothetical card. The
readable part of the file is the plan itself — change by person for each year,
the deferrals needing NFR approval, and the full block table — and the last line
is the state the board reloads from. Loading is undoable, and a plan saved
against an older export still opens, with a warning that the two may not line up.

A browser cannot choose where it writes, so the save dialogue suggests
`<dashboard>_plan.txt` and you pick the folder; put it next to the HTML. Keeping
the file current as you work needs the File System Access API, which is Chrome
and Edge today. Firefox and Safari fall back to downloading a snapshot, so save
again before closing the page.

**It is a sandbox, not a system of record.** Nothing is written back to the budget
system, and nothing survives a page refresh unless it is in a plan file — a
half-remembered browser state is worse than none when the numbers matter.

Two things the board cannot know, and which should stay in the room rather than in
the tool: whether a person has the right expertise for the work, and whether the
project lead wants them. The board only checks that the hours add up. Some hours
are not transferable at all, and nothing in the export marks them.

## Data protection

**The export is personal data about named staff. Do not commit it.** `.gitignore`
excludes `*.csv`, `*.xlsx`, `data/`, any rendered `*_dashboard.html`, `dist/` and
any saved `*_plan.txt`, since a rendered page embeds the same information and a
plan names who is being asked to do what. The test suite builds its own synthetic
export in `tests/synthetic.py` rather than relying on a real one.

Neither build uploads anything. There is no server that receives an export: the
hosted page is a static file GitHub hands you, and once it is in your browser it
has no `fetch`, no analytics and no service worker. That is worth saying out loud
because "drop your staff data onto this web page" is otherwise a reasonable thing
to be suspicious of. Hosting costs you the page load — GitHub logs IP, user agent
and referrer, as any web server would — and nothing about the file you open.

The two builds differ in what the HTML holds afterwards. The browser build's page
is empty until someone opens a file in it, so it is safe to circulate; the Python
build's page is the data.

## What the export actually contains

* Several tables concatenated into one file, each with its own header row. The
  first block (`Budget Type`, `Description`) carries no project or person key and
  is discarded. Tables are found by column signature, not row offset, so a new
  export drops straight in.
* Budgeted hours cover project accounts only (job numbers from 31000 up).
  Registered hours also include internal CICERO time (10501, 10506) and absence
  (10503). Every budget-versus-actual comparison here therefore uses project time
  alone, with the other two shown separately rather than folded in.
* Those non-project rows carry a task, which is the only detail the export gives
  about time off projects, and it is a good deal: seven kinds of leave and ten
  kinds of internal work, coded and named in Norwegian and English either side of
  a slash. `_task_label` drops the code and keeps the English; the full string
  stays in the hover. Nothing in the export says *why* leave was taken beyond the
  category, and nothing dates it, so the deep dive totals a year rather than
  drawing a calendar.
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

Three trees. `spec/` is what the other two share, and is why they agree:

| File | Job |
|---|---|
| `spec/rules.json` | Account numbers, job-number floor, table signatures, the billing standard. |
| `spec/board.js` | The allocation board's runtime, one file, loaded verbatim by both builds. |
| `spec/board.css`, `spec/shell.css` | The styling, likewise read as-is by both. |
| `spec/expected.json` | Model output for the synthetic export, the fixed point the cross-check asserts against. |

`cicero_hours/` is the Python build:

| Module | Job |
|---|---|
| `loader.py` | Finds the tables inside the export by column signature. |
| `model.py` | Tidies both tables, categorises time, holds capacity and pro-rating assumptions. |
| `figures.py` | One function per figure, each taking a `Group`. |
| `board.py` | The allocation board: its blocks, its browser code, its plan file. |
| `dashboard.py` | Page shell, KPI strip, tabs, notes. |
| `cli.py` | Argument parsing. |

`web/src/` is the browser build, a module-for-module port of the same pipeline —
`loader.js`, `model.js`, `figures.js`, `board.js` — plus `app.js` for the file
drop, the shell and the tabs. `web/build.js` bundles the lot with esbuild and
inlines plotly's cartesian distribution, which is the ~1.4 MB rather than the
4.9 MB of the full one and the difference between an emailable file and one that
bounces.

Adding a view means one function in `figures.py` and one entry in the `tabs` list
in `dashboard.py` — then the same in `web/src/figures.js` and the `FIGURES_FOR`
table in `web/src/app.js`. Constants belong in `spec/rules.json`, where both
builds read them; change them there if the finance system changes.

## Development

```bash
pytest -q
ruff check .
```

The rest is browser code, so it is tested in a DOM rather than by pytest:

```bash
npm install
npm run test:board       # the board, in the Python-rendered dashboard
npm run test:board:web   # the same assertions, in the browser build
npm run test:cross       # the JS loader and model against spec/expected.json
npm run test:shell       # the browser build end to end, from file drop to figures
npm run test:size        # guards the 2.5 MiB budget on the built file
```

`test:board` renders a dashboard first, so it wants the Python build installed
and on the path; the others need only Node and a `python3` that can write the
synthetic export.

`test:cross` is the load-bearing one. Two builds that disagree about a number
would be worse than one build, so the JavaScript's model output is asserted key
by key against `spec/expected.json`; a Python change that moves a number and a
JavaScript change that fails to follow both fail it. Regenerate that file with
`python scripts/emit_expected.py` deliberately, in the same commit as the change
that moved the numbers.

## Licence

MIT.
