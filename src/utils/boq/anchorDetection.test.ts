import { describe, it, expect } from 'vitest';
import { findAnchorRow } from './anchorDetection';
import type { TextRow } from '../../types/boq';

function makeRow(texts: string[], xs: number[], page = 1, y = 100): TextRow {
  return {
    page,
    baseY: y,
    blocks: texts.map((text, i) => ({
      text, x: xs[i], y, width: 40, height: 12, page, fontSize: 10,
    })),
  };
}

// Typical BOQ header row
const HEADER_ROW = makeRow(
  ['Sr. No.', 'Description of Items', 'Unit', 'Qty.', 'Rate', 'Amount'],
  [30,        70,                      360,    400,    440,    490],
  1, 700,
);

// Data rows (items)
const ITEM_ROW_1 = makeRow(
  ['1.00', 'Earthwork excavation', 'Cum', '100', '50.00', '5000.00'],
  [30,      70,                     360,   400,   440,     490],
  1, 686,
);

const ITEM_ROW_2 = makeRow(
  ['2.00', 'Brickwork in CM 1:6', 'Sqm', '50', '200.00', '10000.00'],
  [30,      70,                    360,    400,  440,      490],
  1, 672,
);

const CONTINUATION_ROW = makeRow(
  ['with proper bedding and joint filling'],
  [70],
  1, 658,
);

describe('findAnchorRow', () => {
  it('finds a well-formed 6-column header row', () => {
    const rows = [HEADER_ROW, ITEM_ROW_1, ITEM_ROW_2];
    const result = findAnchorRow(rows, 60);
    expect(result).not.toBeNull();
    expect(result?.anchorRowIndex).toBe(0);
    expect(result?.anchorConfidence).toBeGreaterThanOrEqual(60);
  });

  it('returns correct boundary roles (left→right)', () => {
    const result = findAnchorRow([HEADER_ROW], 60);
    const roles = result!.boundaries.map(b => b.role);
    expect(roles).toContain('item_no');
    expect(roles).toContain('description');
    expect(roles).toContain('quantity');
    expect(roles).toContain('estimated_rate');
    expect(roles).toContain('amount');
  });

  it('boundaries are sorted by x', () => {
    const result = findAnchorRow([HEADER_ROW], 60);
    const xs = result!.boundaries.map(b => b.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('headerText matches the anchor row text', () => {
    const result = findAnchorRow([HEADER_ROW], 60);
    expect(result?.headerText).toContain('Sr. No.');
    expect(result?.headerText).toContain('Description');
  });

  it('returns null when item_no is missing', () => {
    const noItemNo = makeRow(
      ['Description', 'Unit', 'Qty.', 'Rate', 'Amount'],
      [70,             360,    400,    440,    490],
    );
    expect(findAnchorRow([noItemNo], 60)).toBeNull();
  });

  it('returns null when description is missing', () => {
    const noDesc = makeRow(
      ['Sr. No.', 'Unit', 'Qty.', 'Rate', 'Amount'],
      [30,         360,    400,    440,    490],
    );
    expect(findAnchorRow([noDesc], 60)).toBeNull();
  });

  it('returns null when fewer than 2 supporting roles', () => {
    const minimal = makeRow(
      ['Sr. No.', 'Description', 'Amount'],
      [30,         70,             490],
    );
    expect(findAnchorRow([minimal], 60)).toBeNull();
  });

  it('skips data rows (item number at item_no position does not trigger anchor)', () => {
    // Data rows have numbers not column labels — detectRoleForText should not
    // match "1.00" or "5000.00" as column header roles
    const rows = [ITEM_ROW_1, ITEM_ROW_2];
    // Should either return null or a very low-confidence result
    const result = findAnchorRow(rows, 60);
    expect(result).toBeNull();
  });

  it('finds the header when it appears after some preamble rows', () => {
    const preamble1 = makeRow(['BAREJA NAGARPALIKA'], [30], 1, 800);
    const preamble2 = makeRow(['Schedule-B1'], [30], 1, 786);
    const rows = [preamble1, preamble2, HEADER_ROW, ITEM_ROW_1];
    const result = findAnchorRow(rows, 60);
    expect(result?.anchorRowIndex).toBe(2);
  });

  it('minX and maxX boundaries are consistent (no overlap, no gap)', () => {
    const result = findAnchorRow([HEADER_ROW], 60);
    const bounds = result!.boundaries;
    for (let i = 0; i < bounds.length - 1; i++) {
      // maxX of boundary i should equal minX of boundary i+1 (they share the edge)
      expect(bounds[i].maxX).toBe(bounds[i + 1].minX);
    }
  });
});
