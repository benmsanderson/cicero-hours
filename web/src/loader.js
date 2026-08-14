// Parse the CICERO 'Timer budsjettert og registrert pr. medarbeider' export.
//
// The export concatenates several tables into one file, each with its own
// quoted header row, and the row offsets move between exports. This module
// finds tables by column signature rather than position, so a new export
// drops straight in. Mirror of cicero_hours/loader.py, one for one, so a
// silent divergence at parse time cannot creep in.

import { TABLE_SIGNATURES } from './rules.js';

// {tables: {name: {columns, rows}}, unrecognised: [{columns, rows}]}
export function loadExport(text) {
  const tables = {};
  const unrecognised = [];
  for (const block of splitBlocks(stripBom(text))) {
    const parsed = parseBlock(block);
    if (!parsed) continue;
    const cols = new Set(parsed.columns);
    let matched = null;
    for (const sig of TABLE_SIGNATURES) {
      if (!(sig.name in tables) && isSubset(sig.columns, cols)) {
        matched = sig.name;
        break;
      }
    }
    if (matched) tables[matched] = parsed;
    else unrecognised.push(parsed);
  }
  return { tables, unrecognised };
}

export function requireTable(raw, name) {
  if (!(name in raw.tables)) {
    const found = Object.keys(raw.tables).sort().join(', ') || 'none';
    throw new Error(
      `No '${name}' table in the export. Recognised tables: ${found}. ` +
      `If the export format changed, update table_signatures in spec/rules.json.`
    );
  }
  return raw.tables[name];
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function isSubset(sub, sup) {
  for (const x of sub) if (!sup.has(x)) return false;
  return true;
}

// Header lines are all-text and contain at least two fields; data lines carry
// at least one numeric-looking value. Loose on purpose, so column reorder or
// added columns still find the right block.
function splitBlocks(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = sniffFields(lines[i]);
    if (!fields) continue;
    if (fields.some(looksNumeric)) continue;
    if (fields.length >= 2) starts.push(i);
  }
  if (!starts.length) return [];
  // A run of consecutive candidate lines is data, not a stack of headers.
  const kept = starts.filter((s, j) => j === 0 || s !== starts[j - 1] + 1);
  const blocks = [];
  for (let j = 0; j < kept.length; j++) {
    const s = kept[j];
    const end = j + 1 < kept.length ? kept[j + 1] : lines.length;
    const block = lines.slice(s, end).filter(l => l.trim());
    if (block.length > 1) blocks.push(block);
  }
  return blocks;
}

function parseBlock(block) {
  const columns = parseCsvLine(block[0]);
  if (!columns.length) return null;
  const rows = block.slice(1).map(line => {
    const fields = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = fields[i] === undefined ? '' : fields[i];
    }
    return row;
  });
  return { columns, rows };
}

function sniffFields(line) {
  try { return parseCsvLine(line); } catch { return null; }
}

// Norwegian numbers use a comma for the decimal, and spaces sometimes appear as
// thousands separators; normalise both before deciding "is this a number".
function looksNumeric(value) {
  const v = String(value).trim().replaceAll(' ', '').replaceAll(',', '.');
  if (!v) return false;
  const n = Number(v);
  return !Number.isNaN(n) && Number.isFinite(n);
}

// Minimal CSV line parser: double-quoted fields with embedded commas and
// doubled quotes ("") as an escape. The export has no fields with embedded
// newlines, and neither does the Python loader handle them.
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQuotes = false; i++;
      } else { cur += c; i++; }
    } else {
      if (c === '"') { inQuotes = true; i++; }
      else if (c === ',') { fields.push(cur); cur = ''; i++; }
      else { cur += c; i++; }
    }
  }
  fields.push(cur);
  return fields;
}
