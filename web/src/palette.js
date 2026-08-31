// Colour constants and small styling helpers, shared by the figures and the
// board. Match cicero_hours/figures.py one for one, so the two builds paint
// the same project the same colour and shade capacity zones identically.

import { EXTERNAL_PROJECT_LABEL, INTERNAL_PROJECT_LABEL } from './rules.js';

export const INK = '#12181F';
export const MUTED = '#6A7683';
export const HAIRLINE = '#D3D9DE';
export const OVER_ZONE = 'rgba(199, 90, 60, 0.07)';

export const CATEGORY_COLOURS = {
  Project: '#1F5F6B',
  Internal: '#7E8FA0',
  Absence: '#C6CED6',
  Other: '#E4E8EC',
};

// Project time split by where the money comes from. The two halves keep the
// Project hue — they are the same kind of work, and both count against the
// billing standard — with the internally funded one a tint lighter, far enough
// from the grey of internal CICERO time to read as a different thing.
export const TYPE_COLOURS = {
  ...Object.fromEntries(Object.entries(CATEGORY_COLOURS).filter(([k]) => k !== 'Project')),
  [EXTERNAL_PROJECT_LABEL]: CATEGORY_COLOURS.Project,
  [INTERNAL_PROJECT_LABEL]: '#4A8F9C',
};

export const UNALLOCATED_COLOUR = '#C98F2B';
export const BUDGET_COLOUR = '#A9B7C2';
export const REGISTERED_COLOUR = '#1F5F6B';

// Muted but separable, chosen to stay legible when 10+ appear in one stack.
export const PROJECT_PALETTE = [
  '#1F5F6B', '#C98F2B', '#6B4A72', '#4C7A3F', '#B4552F',
  '#3D6BA5', '#8C7B4B', '#A0466B', '#2E8C8C', '#7A6FA8',
  '#5E7B8B', '#9C6B3F', '#4F8F6B', '#B07F9B', '#365E4A',
];

// Years get distinct hues rather than shades of one, so a stacked bar can be
// read without counting segments. Ochre is reserved for unallocated hours.
export const YEAR_HUES = ['#1F5F6B', '#6B4A72', '#4C7A3F', '#3D6BA5', '#8C5A3C'];

export const FONT = {
  family: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  size: 13,
  color: INK,
};

// Stable colour per project, ordered by total budgeted hours descending.
// The board and figures both call this on the same Group, so they colour
// identical projects identically.
export function projectColours(group) {
  const totals = new Map();
  for (const r of group.budget) {
    if (r.category !== 'Project') continue;
    totals.set(r.project, (totals.get(r.project) || 0) + r.hours);
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const out = {};
  ordered.forEach(([p], i) => { out[p] = PROJECT_PALETTE[i % PROJECT_PALETTE.length]; });
  return out;
}

// Stable colour per person, ordered by total budgeted hours descending. The
// unallocated pseudo-employee is drawn in ochre elsewhere; keep that colour
// out of the person palette so a real person is never mistaken for them.
export function personColours(group, unallocatedPerson) {
  const totals = new Map();
  for (const r of group.budget) {
    if (r.category !== 'Project') continue;
    totals.set(r.person, (totals.get(r.person) || 0) + r.hours);
  }
  const names = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .filter(p => p !== unallocatedPerson);
  const palette = PROJECT_PALETTE.filter(c => c !== UNALLOCATED_COLOUR);
  const out = {};
  names.forEach((p, i) => { out[p] = palette[i % palette.length]; });
  return out;
}

export function yearColours(years) {
  const out = {};
  [...years].sort((a, b) => a - b).forEach((y, i) => {
    out[y] = YEAR_HUES[i % YEAR_HUES.length];
  });
  return out;
}
