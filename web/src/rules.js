// Shared domain constants, loaded from the same spec/rules.json the Python
// reads. Kept here as a JSON import so esbuild inlines the file into the
// bundle later on, no runtime fetch and no drift from the Python.

import raw from '../../spec/rules.json' with { type: 'json' };

export const PROJECT_JOB_FLOOR = raw.project_job_floor;
export const ABSENCE_JOBS = new Set(raw.absence_jobs);
export const INTERNAL_JOBS = new Set(raw.internal_jobs);
// One pseudo-employee per group, named 'Forsker' plus the group name, so this
// is a prefix rather than a literal; see spec/rules.json.
export const UNALLOCATED_PREFIX = raw.unallocated_prefix;
export const UNALLOCATED_LABEL = raw.unallocated_label;

// There is one per group and a combined export carries several, so matching the
// prefix is what stops the second group's pseudo-employee being read as a
// colleague with a workload.
export const isUnallocated = person =>
  typeof person === 'string' && person.startsWith(UNALLOCATED_PREFIX);
export const ALL_GROUPS = raw.all_groups;
export const ALL_GROUPS_LABEL = raw.all_groups_label;
export const CATEGORY_ORDER = raw.category_order.slice();

// Project work funded from CICERO's own strategic pot rather than by a
// customer, which the finance system marks with its own activity code.
export const INTERNAL_PROJECT_ACTIVITY = raw.internal_project_activity;
export const INTERNAL_PROJECT_LABEL = raw.internal_project_label;
export const EXTERNAL_PROJECT_LABEL = raw.external_project_label;

// Project time split by where the money comes from, in stacking order:
// the two halves take the place of the single 'Project' category.
export const TYPE_ORDER = [
  EXTERNAL_PROJECT_LABEL,
  INTERNAL_PROJECT_LABEL,
  ...CATEGORY_ORDER.filter(c => c !== 'Project'),
];
export const BILLABLE_HOURS_DEFAULT = raw.billable_hours_default;

// [{name, columns: Set<string>}]. The "first match wins, most specific first"
// contract still stands; keep the order that spec/rules.json declares.
export const TABLE_SIGNATURES = raw.table_signatures.map(t => ({
  name: t.name,
  columns: new Set(t.columns),
}));
