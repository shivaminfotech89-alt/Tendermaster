import { describe, it, expect } from 'vitest';
import { detectColumns, snapToColumn } from './columnGrouping';
import type { TextRow, TextBlock } from '../../types/boq';

function makeRow(xs: number[]): TextRow {
  return {
    page: 1,
    baseY: 100,
    blocks: xs.map(x => ({
      text: 'cell', x, y: 100, width: 40, height: 12, page: 1, fontSize: 10,
    } satisfies TextBlock)),
  };
}

describe('detectColumns', () => {
  it('clusters blocks within X_TOLERANCE=8 into same column', () => {
    const rows = [
      makeRow([10, 100, 200]),
      makeRow([12, 102, 203]), // within tolerance
    ];
    const cols = detectColumns(rows);
    expect(cols).toHaveLength(3);
  });

  it('treats blocks beyond X_TOLERANCE as separate columns', () => {
    const rows = [makeRow([10, 100, 200, 300])];
    const cols = detectColumns(rows);
    expect(cols).toHaveLength(4);
  });

  it('returns columns sorted left-to-right', () => {
    const rows = [makeRow([300, 50, 150])];
    const cols = detectColumns(rows);
    expect(cols[0].x).toBeLessThan(cols[1].x);
    expect(cols[1].x).toBeLessThan(cols[2].x);
  });

  it('returns empty array for empty input', () => {
    expect(detectColumns([])).toHaveLength(0);
  });
});

describe('snapToColumn', () => {
  const cols = [
    { index: 0, x: 10, spanWidth: 40 },
    { index: 1, x: 100, spanWidth: 40 },
    { index: 2, x: 200, spanWidth: 40 },
  ];

  it('snaps to nearest column', () => {
    expect(snapToColumn(15, cols)).toBe(0);
    expect(snapToColumn(95, cols)).toBe(1);
    expect(snapToColumn(210, cols)).toBe(2);
  });

  it('returns 0 for single-column list', () => {
    expect(snapToColumn(999, [{ index: 0, x: 10, spanWidth: 40 }])).toBe(0);
  });
});
