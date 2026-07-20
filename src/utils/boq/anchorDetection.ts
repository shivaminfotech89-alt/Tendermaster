/**
 * Anchor detection — global scan to find the BOQ column-header row.
 *
 * Many Indian tender PDFs split the BOQ column headers across 2-4 rows
 * (e.g. "ITEM" on one row, "NO" on the next).  We handle this with a
 * two-pass strategy:
 *
 *   Pass 1 — single row: existing logic, fast path for well-formed headers.
 *   Pass 2 — band scan: merge rows within MULTI_ROW_BAND_PX of each other
 *             into a virtual row and re-try anchor detection.
 *
 * After the best anchor is found we calibrate the description column
 * boundary by peeking at actual data rows.  The header text for the
 * description column is often centred inside a wide cell, so its x
 * position under-estimates where description data actually starts.
 */

import type { TextRow, ColumnRole, ColumnBoundary, LockedColumnMap } from '../../types/boq';
import { detectRoleForText } from './headerDetection';
import { rowText } from './rowGrouping';

const X_TOLERANCE = 8;
const MIN_BLOCKS_IN_HEADER = 4;
const REQUIRED_ROLES: ColumnRole[] = ['item_no', 'description'];
const SUPPORTING_ROLES: ColumnRole[] = ['quantity', 'unit', 'estimated_rate', 'amount'];
const MIN_SUPPORTING = 2;
const HIGH_CONFIDENCE_EARLY_EXIT = 90;

/** Maximum y-span (in PDF pts) to merge rows into a single header band. */
const MULTI_ROW_BAND_PX = 20;

/** Number of data rows to scan when calibrating the description column. */
const CALIBRATION_SCAN_ROWS = 15;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scans all rows and returns the locked column map derived from the best
 * qualifying anchor row, or null if no header with sufficient confidence
 * is found.
 */
export function findAnchorRow(
  rows: TextRow[],
  minConfidence = 60,
): LockedColumnMap | null {
  let best: LockedColumnMap | null = null;

  // Pass 1 — single-row scan
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (row.blocks.length < MIN_BLOCKS_IN_HEADER) continue;

    const candidate = tryAnchor(ri, row, minConfidence);
    if (!candidate) continue;

    if (best === null || candidate.anchorConfidence > best.anchorConfidence) {
      best = candidate;
      if (best.anchorConfidence >= HIGH_CONFIDENCE_EARLY_EXIT) break;
    }
  }

  // Pass 2 — multi-row band scan (handles headers split across rows)
  if (!best || best.anchorConfidence < HIGH_CONFIDENCE_EARLY_EXIT) {
    outer: for (let ri = 0; ri < rows.length; ri++) {
      const startY = rows[ri].baseY;
      const bandRows: TextRow[] = [rows[ri]];

      for (let bi = 1; bi <= 4 && ri + bi < rows.length; bi++) {
        if (Math.abs(rows[ri + bi].baseY - startY) <= MULTI_ROW_BAND_PX) {
          bandRows.push(rows[ri + bi]);
        } else {
          break;
        }
      }

      if (bandRows.length < 2) continue;

      const mergedRow: TextRow = {
        page: rows[ri].page,
        baseY: rows[ri].baseY,
        blocks: bandRows.flatMap(r => r.blocks),
      };

      const bandLastIdx = ri + bandRows.length - 1;
      const candidate = tryAnchor(bandLastIdx, mergedRow, minConfidence);
      if (candidate && (best === null || candidate.anchorConfidence > best.anchorConfidence)) {
        best = candidate;
        if (best.anchorConfidence >= HIGH_CONFIDENCE_EARLY_EXIT) break outer;
      }
    }
  }

  // Post-process: calibrate description column start using actual data rows.
  // The description header text is often centred in its cell, placing it far
  // to the right of where data actually begins.
  if (best) {
    best = calibrateDescriptionBoundary(best, rows);
  }

  return best;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Peek at the first CALIBRATION_SCAN_ROWS data rows after the anchor to find
 * where description text actually starts (it often begins further left than
 * the centred header text suggests).
 *
 * If calibration finds a leftward shift, the item_no column's maxX and the
 * description column's minX are both moved to that position so they remain
 * contiguous with no gap or overlap.
 */
function calibrateDescriptionBoundary(
  map: LockedColumnMap,
  rows: TextRow[],
): LockedColumnMap {
  const descIdx = map.boundaries.findIndex(b => b.role === 'description');
  const itemIdx = map.boundaries.findIndex(b => b.role === 'item_no');
  if (descIdx < 0 || itemIdx < 0) return map;

  const itemB = map.boundaries[itemIdx];
  const descB = map.boundaries[descIdx];

  // Leftmost x of numeric columns (anything that isn't item_no or description)
  const numericMinX = map.boundaries
    .filter((_, i) => i !== itemIdx && i !== descIdx)
    .reduce((m, b) => Math.min(m, b.x), Infinity);

  let minDescX = descB.minX;
  const scanEnd = Math.min(rows.length, map.anchorRowIndex + 1 + CALIBRATION_SCAN_ROWS);

  for (let ri = map.anchorRowIndex + 1; ri < scanEnd; ri++) {
    for (const block of rows[ri].blocks) {
      // Block sits clearly right of item_no centre and left of numeric zone
      if (block.x > itemB.x + 5 && block.x < numericMinX - 5) {
        minDescX = Math.min(minDescX, block.x);
      }
    }
  }

  if (minDescX >= descB.minX) return map; // no leftward shift needed

  const boundaries = map.boundaries.map((b, i): ColumnBoundary => {
    if (i === itemIdx) return { ...b, maxX: minDescX };
    if (i === descIdx) return { ...b, minX: minDescX };
    return b;
  });

  return { ...map, boundaries };
}

interface RoleHit {
  x: number;
  width: number;
  role: ColumnRole;
  score: number;
}

function tryAnchor(
  rowIndex: number,
  row: TextRow,
  minConfidence: number,
): LockedColumnMap | null {
  const hits: RoleHit[] = [];
  const usedRoles = new Set<ColumnRole>();

  for (const block of row.blocks) {
    const { role, score } = detectRoleForText(block.text);
    if (role !== 'unknown' && !usedRoles.has(role)) {
      hits.push({ x: block.x, width: block.width, role, score });
      usedRoles.add(role);
    }
  }

  // Must have item_no and description
  for (const req of REQUIRED_ROLES) {
    if (!usedRoles.has(req)) return null;
  }

  // Must have at least MIN_SUPPORTING supporting roles
  const supportCount = SUPPORTING_ROLES.filter(r => usedRoles.has(r)).length;
  if (supportCount < MIN_SUPPORTING) return null;

  // Sort by x position (left → right column order)
  const sorted = [...hits].sort((a, b) => a.x - b.x);

  // Build column boundaries: each column spans from its x-tolerance to the
  // next column's x-tolerance (exclusive).
  const boundaries: ColumnBoundary[] = sorted.map((hit, i) => {
    const nextX = i < sorted.length - 1 ? sorted[i + 1].x : Infinity;
    return {
      role: hit.role,
      x: hit.x,
      minX: hit.x - X_TOLERANCE,
      maxX: nextX - X_TOLERANCE,
    };
  });

  // Confidence: blend avg role-match score with coverage ratio
  const avgScore = hits.reduce((s, h) => s + h.score, 0) / hits.length;
  const coverage = Math.min(1, hits.length / 6);   // 6 = ideal column count
  const confidence = Math.min(100, avgScore * 0.7 + coverage * 100 * 0.3);

  if (confidence < minConfidence) return null;

  return {
    anchorRowIndex: rowIndex,
    anchorConfidence: confidence,
    boundaries,
    headerText: rowText(row),
  };
}
