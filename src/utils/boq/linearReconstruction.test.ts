import { describe, it, expect } from 'vitest';
import { reconstructBoqLinear } from './linearReconstruction';
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

// Anchor row + locked map (anchor is row 0)
const ANCHOR: LockedColumnMap = {
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

const ANCHOR_ROW = makeRow(
  ['Sr. No.', 'Description of Items', 'Unit', 'Qty.', 'Rate', 'Amount'],
  [30,         70,                     360,    400,    440,    490],
  1, 750,
);

describe('reconstructBoqLinear', () => {
  it('extracts 3 simple items', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Earthwork', 'Cum', '100', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      makeRow(['2.00', 'Brickwork', 'Sqm', '50',  '200.00','10000.00'],[30,70,360,400,440,490], 1, 722),
      makeRow(['3.00', 'Plastering','Sqm', '200', '80.00', '16000.00'],[30,70,360,400,440,490], 1, 708),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].itemNo).toBe('1');
    expect(result.items[1].itemNo).toBe('2');
    expect(result.items[2].itemNo).toBe('3');
  });

  it('merges continuation rows into the preceding item description', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Earthwork excavation', 'Cum', '100', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      makeRow(['in hard strata complete.'], [70], 1, 722),
      makeRow(['2.00', 'Brickwork', 'Sqm', '50', '200.00', '10000.00'], [30,70,360,400,440,490], 1, 708),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].description).toContain('Earthwork excavation');
    expect(result.items[0].description).toContain('in hard strata complete');
  });

  it('never overwrites quantity already captured from the item row', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Some item', 'Cum', '100', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      // Continuation row that also has a numeric value in the qty column — must NOT overwrite
      makeRow(['continuation text', '', '', '999', '', ''], [70, 360, 400, 400, 440, 490], 1, 722),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items[0].quantity).toBe(100);   // original value preserved
  });

  it('fills in missing quantity from continuation when item row had none', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      // Item row has no quantity (quantity=0 means "not set" here)
      makeRow(['1.00', 'Long description', '', '', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      makeRow(['end of description', '', '', '10', '', ''],            [70, 360, 400, 400, 440, 490], 1, 722),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items[0].quantity).toBe(10);
  });

  it('stops at a section break and does not include RA rows', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Earthwork', 'Cum', '100', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      makeRow(['Rate Analysis RA-1'], [30], 1, 700),
      makeRow(['Labour', 'Cum', '1', '100', '100.00', '100.00'], [30,70,360,400,440,490], 1, 686),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemNo).toBe('1');
    expect(result.sectionBreakRowIndex).toBe(2);
  });

  it('handles cross-page rows transparently', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Item on page 1', 'Cum', '100', '50.00', '5000.00'], [30,70,360,400,440,490], 1, 736),
      makeRow(['2.00', 'Item on page 2', 'Sqm', '50',  '200.00','10000.00'],[30,70,360,400,440,490], 2, 736),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items).toHaveLength(2);
    expect(result.items[1].itemNo).toBe('2');
  });

  it('skips repeated header rows (page-break artefact)', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Item A', 'Cum', '100', '50.00', '5000.00'],   [30,70,360,400,440,490], 1, 736),
      // Repeated header at page break
      makeRow(['Sr. No.', 'Description of Items', 'Unit', 'Qty.', 'Rate', 'Amount'], [30,70,360,400,440,490], 2, 780),
      makeRow(['2.00', 'Item B', 'Sqm', '50',  '200.00','10000.00'], [30,70,360,400,440,490], 2, 766),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items).toHaveLength(2);
  });

  it('description is trimmed and whitespace normalised', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', '  Earthwork  ', 'Cum', '10', '50', '500'], [30,70,360,400,440,490], 1, 736),
      makeRow(['  continuation  '], [70], 1, 722),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items[0].description).toBe('Earthwork continuation');
  });

  it('parses Indian comma-formatted amounts', () => {
    const rows: TextRow[] = [
      ANCHOR_ROW,
      makeRow(['1.00', 'Item', 'Nos', '1', '1,030.81', '1,030.81'], [30,70,360,400,440,490], 1, 736),
    ];
    const result = reconstructBoqLinear(rows, ANCHOR);
    expect(result.items[0].estimatedRate).toBeCloseTo(1030.81, 1);
    expect(result.items[0].amount).toBeCloseTo(1030.81, 1);
  });
});
