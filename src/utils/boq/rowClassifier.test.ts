import { describe, it, expect } from 'vitest';
import { classifyRow, extractCells } from './rowClassifier';
import type { TextRow, LockedColumnMap } from '../../types/boq';

function makeRow(texts: string[], xs: number[], page = 1, y = 100): TextRow {
  return {
    page,
    baseY: y,
    blocks: texts.map((text, i) => ({
      text, x: xs[i], y, width: 40, height: 12, page, fontSize: 10,
    })),
  };
}

// Locked map: item_no@30, description@70, unit@360, quantity@400, estimated_rate@440, amount@490
const LOCKED_MAP: LockedColumnMap = {
  anchorRowIndex: 0,
  anchorConfidence: 95,
  headerText: 'Sr. No. Description of Items Unit Qty. Rate Amount',
  boundaries: [
    { role: 'item_no',        x: 30,  minX: 22,  maxX: 62 },
    { role: 'description',    x: 70,  minX: 62,  maxX: 352 },
    { role: 'unit',           x: 360, minX: 352, maxX: 392 },
    { role: 'quantity',       x: 400, minX: 392, maxX: 432 },
    { role: 'estimated_rate', x: 440, minX: 432, maxX: 482 },
    { role: 'amount',         x: 490, minX: 482, maxX: Infinity },
  ],
};

describe('extractCells', () => {
  it('maps blocks to roles by x position', () => {
    const row = makeRow(
      ['1.00', 'Earthwork excavation', 'Cum', '100', '50.00', '5000.00'],
      [30,      70,                     360,   400,   440,     490],
    );
    const cells = extractCells(row, LOCKED_MAP);
    expect(cells.item_no).toBe('1.00');
    expect(cells.description).toBe('Earthwork excavation');
    expect(cells.unit).toBe('Cum');
    expect(cells.quantity).toBe('100');
    expect(cells.estimated_rate).toBe('50.00');
    expect(cells.amount).toBe('5000.00');
  });

  it('concatenates multi-block description text in x order', () => {
    const row = makeRow(
      ['Providing', 'and', 'laying'],
      [70, 120, 160],
    );
    const cells = extractCells(row, LOCKED_MAP);
    expect(cells.description).toBe('Providing and laying');
  });

  it('returns empty cells for a row with no relevant blocks', () => {
    const row = makeRow(['Just a heading'], [200]);
    const cells = extractCells(row, LOCKED_MAP);
    expect(cells.description).toBe('Just a heading');
    expect(cells.item_no).toBeUndefined();
  });
});

describe('classifyRow', () => {
  it('classifies a row with a valid item number as new_item', () => {
    const row = makeRow(
      ['1.00', 'Earthwork excavation', 'Cum', '100', '50.00', '5000.00'],
      [30,      70,                     360,   400,   440,     490],
    );
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('new_item');
  });

  it('classifies a row with only description as continuation', () => {
    const row = makeRow(['in hard strata complete.'], [70]);
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('continuation');
  });

  it('classifies a repeated header row correctly', () => {
    // Levenshtein similarity ≥80 with the header text
    const row = makeRow(
      ['Sr. No.', 'Description of Items', 'Unit', 'Qty.', 'Rate', 'Amount'],
      [30,         70,                     360,    400,    440,    490],
    );
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('repeated_header');
  });

  it('classifies a Rate Analysis heading as section_break', () => {
    const row = makeRow(['Rate Analysis RA-1'], [30]);
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('section_break');
  });

  it('does NOT trigger section_break when item_no is present (data row)', () => {
    // e.g. a description mentioning "material cost" — still a data row
    const row = makeRow(
      ['5.00', 'Supply of material cost analysis', 'Nos', '1', '100', '100'],
      [30,      70,                                  360,   400, 440,   490],
    );
    const result = classifyRow(row, LOCKED_MAP);
    expect(result.rowClass).toBe('new_item');
  });

  it('classifies an empty row as skip', () => {
    const row = makeRow([], []);
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('skip');
  });

  it('cells are populated on new_item', () => {
    const row = makeRow(
      ['3.00', 'Brickwork', 'Sqm', '200', '120.00', '24000.00'],
      [30,      70,          360,   400,   440,      490],
    );
    const result = classifyRow(row, LOCKED_MAP);
    expect(result.cells.item_no).toBe('3.00');
    expect(result.cells.quantity).toBe('200');
  });

  it('item number pattern: letters prefix allowed', () => {
    const row = makeRow(['A1', 'Some item'], [30, 70]);
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('new_item');
  });

  it('item number pattern: "hardner)" does not match', () => {
    const row = makeRow(['hardner)'], [70]);
    expect(classifyRow(row, LOCKED_MAP).rowClass).toBe('continuation');
  });
});
