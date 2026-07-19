import { describe, it, expect } from 'vitest';
import { detectRoleForText, detectHeader, isRepeatedHeader } from './headerDetection';
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
