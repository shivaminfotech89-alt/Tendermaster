import type { TextBlock, TextRow } from '../../types/boq';

const Y_TOLERANCE = 4;

export function groupIntoRows(blocks: TextBlock[]): TextRow[] {
  const sorted = [...blocks].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return b.y - a.y; // higher y = top of page in PDF coords
  });

  const rows: TextRow[] = [];

  for (const block of sorted) {
    let placed = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.page !== block.page) break;
      if (Math.abs(row.baseY - block.y) <= Y_TOLERANCE) {
        row.blocks.push(block);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push({ page: block.page, baseY: block.y, blocks: [block] });
    }
  }

  for (const row of rows) {
    row.blocks.sort((a, b) => a.x - b.x);
  }

  return rows;
}

export function rowText(row: TextRow): string {
  return row.blocks.map(b => b.text).join(' ');
}

export function estimateMedianLineHeight(rows: TextRow[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (prev.page === curr.page) {
      gaps.push(Math.abs(prev.baseY - curr.baseY));
    }
  }
  if (gaps.length === 0) return 12;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function detectRowGap(rowA: TextRow, rowB: TextRow, medianLineHeight: number): boolean {
  if (rowA.page !== rowB.page) return true;
  const gap = Math.abs(rowA.baseY - rowB.baseY);
  return gap > medianLineHeight * 1.5;
}
