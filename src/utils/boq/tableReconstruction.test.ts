import { describe, it, expect } from 'vitest';
import { reconstructBoqItems } from './tableReconstruction';
import type { TextRow, ColumnAnchor, HeaderDetectionResult } from '../../types/boq';

function makeRow(cells: Record<number, string>, xs: number[], page = 1, y = 100): TextRow {
  const blocks = Object.entries(cells).map(([colIdx, text]) => ({
    text,
    x: xs[Number(colIdx)] ?? Number(colIdx) * 100,
    y,
    width: 50,
    height: 12,
    page,
    fontSize: 10,
  }));
  return { page, baseY: y, blocks };
}

// Column anchors at positions matching our test x values
const COLS: ColumnAnchor[] = [
  { index: 0, x: 10, spanWidth: 50 },   // item_no
  { index: 1, x: 80, spanWidth: 100 },  // description
  { index: 2, x: 200, spanWidth: 40 },  // unit
  { index: 3, x: 250, spanWidth: 40 },  // quantity
  { index: 4, x: 300, spanWidth: 50 },  // estimated_rate
  { index: 5, x: 370, spanWidth: 50 },  // amount
];

const XS = [10, 80, 200, 250, 300, 370];

const HEADER: HeaderDetectionResult = {
  headerRowIndex: 0,
  mapping: { 0: 'item_no', 1: 'description', 2: 'unit', 3: 'quantity', 4: 'estimated_rate', 5: 'amount' },
  confidence: 95,
  mappedCount: 6,
  totalColumns: 6,
};

describe('reconstructBoqItems', () => {
  it('extracts 3 simple BOQ items', () => {
    const rows: TextRow[] = [
      makeRow({ 0: 'Sr No', 1: 'Description', 2: 'Unit', 3: 'Qty', 4: 'Rate', 5: 'Amount' }, XS, 1, 200), // header at index 0
      makeRow({ 0: '1', 1: 'Earthwork', 2: 'Cum', 3: '100', 4: '50', 5: '5000' }, XS, 1, 188),
      makeRow({ 0: '2', 1: 'Brickwork', 2: 'Sqm', 3: '200', 4: '120', 5: '24000' }, XS, 1, 176),
      makeRow({ 0: '3', 1: 'Plastering', 2: 'Sqm', 3: '150', 4: '80', 5: '12000' }, XS, 1, 164),
    ];
    const items = reconstructBoqItems(rows, COLS, HEADER);
    expect(items).toHaveLength(3);
    expect(items[0].itemNo).toBe('1');
    expect(items[0].description).toBe('Earthwork');
    expect(items[0].quantity).toBe(100);
    expect(items[1].itemNo).toBe('2');
    expect(items[2].itemNo).toBe('3');
  });

  it('merges wrapped description continuation rows', () => {
    const rows: TextRow[] = [
      makeRow({ 0: 'Sr No', 1: 'Description', 2: 'Unit', 3: 'Qty' }, XS, 1, 200), // header
      makeRow({ 0: '1', 1: 'Earthwork excavation', 2: 'Cum', 3: '100' }, XS, 1, 188),
      makeRow({ 1: 'in hard rock strata' }, XS, 1, 176),  // continuation: no item_no, no qty
      makeRow({ 0: '2', 1: 'Brickwork', 2: 'Sqm', 3: '200' }, XS, 1, 164),
    ];
    const items = reconstructBoqItems(rows, COLS, HEADER);
    expect(items).toHaveLength(2);
    expect(items[0].description).toContain('Earthwork excavation');
    expect(items[0].description).toContain('in hard rock strata');
  });

  it('skips rows with no item_no and no description', () => {
    const rows: TextRow[] = [
      makeRow({ 0: 'Sr No', 1: 'Description', 2: 'Unit', 3: 'Qty' }, XS, 1, 200),
      makeRow({ 0: '1', 1: 'Earthwork', 2: 'Cum', 3: '50' }, XS, 1, 188),
      makeRow({}, XS, 1, 176), // empty row
      makeRow({ 0: '2', 1: 'Brickwork', 2: 'Sqm', 3: '100' }, XS, 1, 164),
    ];
    const items = reconstructBoqItems(rows, COLS, HEADER);
    expect(items).toHaveLength(2);
  });
});

describe('parseCurrency (via reconstructBoqItems)', () => {
  const currencyHeader: HeaderDetectionResult = {
    headerRowIndex: 0,
    mapping: { 0: 'item_no', 1: 'description', 2: 'unit', 3: 'quantity', 5: 'amount' },
    confidence: 95,
    mappedCount: 5,
    totalColumns: 6,
  };

  it('parses Indian-formatted amounts correctly', () => {
    const testCases = [
      { raw: '₹1,25,000', expected: 125000 },
      { raw: '125000', expected: 125000 },
      { raw: '1,25,000.50', expected: 125000.50 },
    ];

    for (const { raw, expected } of testCases) {
      const rows: TextRow[] = [
        makeRow({ 0: 'Sr No', 1: 'Desc', 2: 'Unit', 3: 'Qty', 5: 'Amount' }, XS, 1, 200),
        makeRow({ 0: '1', 1: 'Item', 2: 'Nos', 3: '1', 5: raw }, XS, 1, 188),
      ];
      const items = reconstructBoqItems(rows, COLS, currencyHeader);
      expect(items[0].amount).toBeCloseTo(expected, 1);
    }
  });
});
