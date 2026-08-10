"""A synthetic export in the same shape as the real one.

The real export is personal data and never enters the repository, so the tests
build their own file: three concatenated tables, quoted fields, CRLF endings,
a leading block with no usable key, and the quirks that matter (cost-only rows
with zero hours, repeated activity codes, the unallocated pseudo-employee).
"""

from __future__ import annotations

from pathlib import Path

LEGEND = [
    '"Budget Type","Description"',
    '"2026","Tid, fakturerbar"',
    '"2026","Andre prosjektkostnader"',
    '"2027","Samarbeidspartner"',
]

REGISTERED = [
    '"Avdeling","Medarbeider","Prosjekt","Project Manager No.","Project Manager Name",'
    '"Oppgave","Task Name","Activity No.","Job No.","Job Name","Year str","Hours - Reg.",'
    '"Quantity - Reg.","Billing Price Reg. - Company","Quantity Up/Down",'
    '"Billing Price Up/Down - Company","Employee Specification 5 Name",'
    '"Employee Specification 5 Descr.","Employee Specification 6 Name",'
    '"Employee Specification 6 Descr."',
    # Two activity codes on one project: these must collapse to a single row.
    '"RESEARCH 1","Ada Lovelace","31001 - ALPHA","ABC","Ada Lovelace","10 - Tid","10",'
    '"1000","31001","Alpha project","2026","300","300","450000","0","0","G04",'
    '"Utslippsreduksjon / Climate Mitigation","",""',
    '"RESEARCH 1","Ada Lovelace","31001 - ALPHA","ABC","Ada Lovelace","10 - Tid","10",'
    '"1013","31001","Alpha project","2026","100","100","150000","0","0","G04",'
    '"Utslippsreduksjon / Climate Mitigation","",""',
    # A cost-only row: no hours, must not create a phantom entry.
    '"RESEARCH 1","Ada Lovelace","31001 - ALPHA","ABC","Ada Lovelace","30 - Reiser","30",'
    '"4757","31001","Alpha project","2026","0","0","0","0","0","G04",'
    '"Utslippsreduksjon / Climate Mitigation","",""',
    '"RESEARCH 1","Grace Hopper","31002 - BETA","DEF","Grace Hopper","10 - Tid","10",'
    '"1000","31002","Beta project","2026","200","200","300000","0","0","G04",'
    '"Utslippsreduksjon / Climate Mitigation","G06","Atmosfæreforskning / Atmospheric Sciences"',
    # Internal time and absence, which the budget table does not cover.
    '"RESEARCH 1","Grace Hopper","10506 - CICERO-tid Research 1","KÅM","Kårstein Måseide",'
    '"11 - Drift/Operations","11","9000","10506","CICERO-tid Research 1","2026","150","150",'
    '"0","0","0","G04","Utslippsreduksjon / Climate Mitigation","",""',
    '"RESEARCH 1","Grace Hopper","10503 - Fravær","KÅM","Kårstein Måseide","92 - Ferie",'
    '"92","9050","10503","Fravær","2026","187.5","187.5","0","0","0","G04",'
    '"Utslippsreduksjon / Climate Mitigation","",""',
]

BUDGET = [
    '"Avdeling","Project Manager No.","Project Manager Name","Medarbeider","Prosjekt",'
    '"Oppgave","Task Name","Activity No.","Job No.","Job Name","Budget Type",'
    '"Specification5Name","Specification5Description","Specification6Name",'
    '"Specification6Description","Quantity - Hours","Quantity","Total Billing Price - Company"',
    '"RESEARCH 1","ABC","Ada Lovelace","Ada Lovelace","31001 - ALPHA","10 - Tid","10","1000",'
    '"31001","Alpha project","2026","G04","Utslippsreduksjon / Climate Mitigation","","",'
    '"800","800","1200000"',
    '"RESEARCH 1","ABC","Ada Lovelace","Ada Lovelace","31001 - ALPHA","10 - Tid","10","1000",'
    '"31001","Alpha project","2027","G04","Utslippsreduksjon / Climate Mitigation","","",'
    '"400","400","620000"',
    '"RESEARCH 1","DEF","Grace Hopper","Grace Hopper","31002 - BETA","10 - Tid","10","1000",'
    '"31002","Beta project","2026","G04","Utslippsreduksjon / Climate Mitigation","G06",'
    '"Atmosfæreforskning / Atmospheric Sciences","500","500","750000"',
    # Hours budgeted to the group with nobody's name against them.
    '"RESEARCH 1","ABC","Ada Lovelace","Forsker Climate Mitigation","31001 - ALPHA",'
    '"10 - Tid","10","1000","31001","Alpha project","2027","G04",'
    '"Utslippsreduksjon / Climate Mitigation","","","600","600","930000"',
    # A zero-hour budget row, which should not appear as an allocation.
    '"RESEARCH 1","DEF","Grace Hopper","Grace Hopper","31002 - BETA","10 - Tid","10","1000",'
    '"31002","Beta project","2028","G04","Utslippsreduksjon / Climate Mitigation","","",'
    '"0","0","0"',
]


def write_export(path: Path) -> Path:
    lines = LEGEND + REGISTERED + BUDGET
    path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")
    return path
