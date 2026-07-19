import { describe, it, expect } from 'vitest';
import { groupIntoRows, rowText, estimateMedianLineHeight, detectRowGap } from './rowGrouping';
import type { TextBlock } from '../../types/boq';

function makeBlock(overrides: Partial<TextBlock> & { x: number; y: number; page?: number }): TextBlock {
  return {
    text: 'text',
    x: overrides.x,
    y: overrides.y,
    width: 50,
    height: 12,
    page: overrides.page ?? 1,
    fontSize: 10,
    ...overrides,
  };
}

describe('groupIntoRows', () => {
  it('groups blocks with same Y into one row', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'A', x: 10, y: 100 }),
      makeBlock({ text: 'B', x: 100, y: 102 }), // within Y_TOLERANCE=4
    ];
    const rows = groupIntoRows(blocks);
    expect(rows).toHaveLength(1);
    expect(rows[0].blocks.map(b => b.text)).toEqual(['A', 'B']);
  });

  it('splits blocks beyond Y tolerance into separate rows', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'A', x: 10, y: 100 }),
      makeBlock({ text: 'B', x: 10, y: 90 }), // gap > 4
    ];
    const rows = groupIntoRows(blocks);
    expect(rows).toHaveLength(2);
  });

  it('separates blocks on different pages', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'A', x: 10, y: 100, page: 1 }),
      makeBlock({ text: 'B', x: 10, y: 100, page: 2 }),
    ];
    const rows = groupIntoRows(blocks);
    expect(rows).toHaveLength(2);
    expect(rows[0].page).toBe(1);
    expect(rows[1].page).toBe(2);
  });

  it('sorts blocks within row left-to-right by x', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'Right', x: 200, y: 100 }),
      makeBlock({ text: 'Left', x: 50, y: 100 }),
    ];
    const rows = groupIntoRows(blocks);
    expect(rows[0].blocks[0].text).toBe('Left');
    expect(rows[0].blocks[1].text).toBe('Right');
  });
});

describe('rowText', () => {
  it('joins blocks with spaces', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'Hello', x: 10, y: 100 }),
      makeBlock({ text: 'World', x: 60, y: 100 }),
    ];
    const rows = groupIntoRows(blocks);
    expect(rowText(rows[0])).toBe('Hello World');
  });
});

describe('estimateMedianLineHeight', () => {
  it('returns correct median of gaps between consecutive rows', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'A', x: 10, y: 100 }),
      makeBlock({ text: 'B', x: 10, y: 88 }),  // gap 12
      makeBlock({ text: 'C', x: 10, y: 74 }),  // gap 14
      makeBlock({ text: 'D', x: 10, y: 60 }),  // gap 14
    ];
    const rows = groupIntoRows(blocks);
    const h = estimateMedianLineHeight(rows);
    expect(h).toBe(14); // median of [12, 14, 14]
  });

  it('returns 12 when not enough data', () => {
    const blocks: TextBlock[] = [
      makeBlock({ text: 'A', x: 10, y: 100 }),
    ];
    const rows = groupIntoRows(blocks);
    expect(estimateMedianLineHeight(rows)).toBe(12);
  });
});

describe('detectRowGap', () => {
  it('returns false for consecutive rows within 1.5x median', () => {
    const row1 = { page: 1, baseY: 100, blocks: [] };
    const row2 = { page: 1, baseY: 86, blocks: [] }; // gap=14, median=12, 14 < 18
    expect(detectRowGap(row1, row2, 12)).toBe(false);
  });

  it('returns true for gap > 1.5x median', () => {
    const row1 = { page: 1, baseY: 100, blocks: [] };
    const row2 = { page: 1, baseY: 70, blocks: [] }; // gap=30 > 18
    expect(detectRowGap(row1, row2, 12)).toBe(true);
  });

  it('returns true for different pages', () => {
    const row1 = { page: 1, baseY: 100, blocks: [] };
    const row2 = { page: 2, baseY: 100, blocks: [] };
    expect(detectRowGap(row1, row2, 12)).toBe(true);
  });
});
