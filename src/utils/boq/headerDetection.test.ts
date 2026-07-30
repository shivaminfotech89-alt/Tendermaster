import { describe, it, expect } from 'vitest';
import { detectRoleForText, detectTopRolesForText, detectHeader, isRepeatedHeader } from './headerDetection';
import type { TextRow, ColumnAnchor } from '../../types/boq';

describe('detectRoleForText', () => {
  it('identifies "Item No" as item_no', () => {
    const r = detectRoleForText('Item No');
    expect(r.role).toBe('item_no');
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it('identifies "Description" as description', () => {
    expect(detectRoleForText('Description').role).toBe('description');
  });

  it('identifies "Qty" as quantity', () => {
    expect(detectRoleForText('Qty').role).toBe('quantity');
  });

  it('identifies "Unit" as unit', () => {
    expect(detectRoleForText('Unit').role).toBe('unit');
  });

  it('identifies "Rate" as estimated_rate', () => {
    expect(detectRoleForText('Rate').role).toBe('estimated_rate');
  });

  it('identifies "Amount" as amount', () => {
    expect(detectRoleForText('Amount').role).toBe('amount');
  });

  it('returns unknown for junk text', () => {
    expect(detectRoleForText('JUNK TEXT').role).toBe('unknown');
  });

  it('strips punctuation — "Sl. No." → item_no', () => {
    expect(detectRoleForText('Sl. No.').role).toBe('item_no');
  });

  it('identifies long quantity header', () => {
    const r = detectRoleForText('Quantities Estimated But May Be More Or Less');
    expect(r.role).toBe('quantity');
  });

  // Smart_Meter SOR (.xlsx) header row synonyms — added for xlsx BOQ support.
  // Existing PDF-format synonyms above are re-asserted first to prove this
  // addition doesn't change any previously-passing PDF header mapping.
  it('still identifies "Particulars" as description (regression guard)', () => {
    expect(detectRoleForText('Particulars').role).toBe('description');
  });

  it('identifies "Activity" as description (xlsx SOR synonym)', () => {
    const r = detectRoleForText('Activity');
    expect(r.role).toBe('description');
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it('identifies "Sr. No." as item_no', () => {
    expect(detectRoleForText('Sr. No.').role).toBe('item_no');
  });

  it('identifies "Service Code" as code', () => {
    expect(detectRoleForText('Service Code').role).toBe('code');
  });

  it('identifies "UoM" as unit', () => {
    expect(detectRoleForText('UoM').role).toBe('unit');
  });

  it('identifies "Qty." as quantity', () => {
    expect(detectRoleForText('Qty.').role).toBe('quantity');
  });

  // detectRoleForText's single-best pick for "Unit Rate" ties at `unit`
  // (a prefix match, same score as `estimated_rate`'s own prefix match) —
  // that's expected/correct for this function in isolation. Disambiguating
  // it in favor of estimated_rate when `unit` is already claimed by a
  // sibling "UoM" column is detectTopRolesForText's job, tested below.
  it('normalizes a multi-line "Unit Rate\\n[Rs.]" header (newline collapsed)', () => {
    const r = detectRoleForText('Unit Rate\n[Rs.]');
    expect(['unit', 'estimated_rate']).toContain(r.role);
    expect(r.score).toBeGreaterThanOrEqual(60);
  });
});

describe('detectTopRolesForText', () => {
  it('returns both unit and estimated_rate as candidates for "Unit Rate\\n[Rs.]"', () => {
    const results = detectTopRolesForText('Unit Rate\n[Rs.]');
    const roles = results.map(r => r.role);
    expect(roles).toContain('unit');
    expect(roles).toContain('estimated_rate');
  });

  it('returns only unit (exact match) for "UoM"', () => {
    const results = detectTopRolesForText('UoM');
    expect(results[0].role).toBe('unit');
    expect(results[0].score).toBe(100);
  });

  it('returns an empty array for junk text', () => {
    expect(detectTopRolesForText('JUNK TEXT')).toEqual([]);
  });

  it('sorts candidates by score descending', () => {
    const results = detectTopRolesForText('Unit Rate\n[Rs.]');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

function makeHeaderRow(texts: string[], xs: number[]): TextRow {
  return {
    page: 1,
    baseY: 100,
    blocks: texts.map((text, i) => ({
      text, x: xs[i], y: 100, width: 40, height: 12, page: 1, fontSize: 10,
    })),
  };
}

describe('detectHeader', () => {
  it('detects header from a row with item_no, description, qty, unit', () => {
    const rows: TextRow[] = [
      makeHeaderRow(['Sr No', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'], [10, 80, 200, 250, 300, 370]),
    ];
    const cols: ColumnAnchor[] = [0, 1, 2, 3, 4, 5].map(i => ({ index: i, x: [10, 80, 200, 250, 300, 370][i], spanWidth: 50 }));
    const result = detectHeader(rows, cols);
    expect(result).not.toBeNull();
    expect(result!.mappedCount).toBeGreaterThanOrEqual(2);
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it('returns null if no row maps ≥2 roles', () => {
    const rows: TextRow[] = [
      makeHeaderRow(['Random', 'Stuff'], [10, 100]),
    ];
    const cols: ColumnAnchor[] = [{ index: 0, x: 10, spanWidth: 40 }, { index: 1, x: 100, spanWidth: 40 }];
    const result = detectHeader(rows, cols);
    expect(result).toBeNull();
  });
});

describe('isRepeatedHeader', () => {
  it('identifies a duplicate header row', () => {
    const row: TextRow = makeHeaderRow(['Sr No', 'Description', 'Unit', 'Qty'], [10, 80, 200, 250]);
    const knownHeader = {
      headerRowIndex: 0, mapping: {}, confidence: 90, mappedCount: 4, totalColumns: 4,
      headerText: 'Sr No Description Unit Qty',
    };
    expect(isRepeatedHeader(row, knownHeader)).toBe(true);
  });

  it('does not flag a regular data row as repeated header', () => {
    const row: TextRow = makeHeaderRow(['1', 'Earthwork excavation', 'Cum', '100'], [10, 80, 200, 250]);
    const knownHeader = {
      headerRowIndex: 0, mapping: {}, confidence: 90, mappedCount: 4, totalColumns: 4,
      headerText: 'Sr No Description Unit Qty',
    };
    expect(isRepeatedHeader(row, knownHeader)).toBe(false);
  });
});
