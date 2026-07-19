import type { TextRow, ColumnAnchor } from '../../types/boq';

const X_TOLERANCE = 8;

export function detectColumns(rows: TextRow[]): ColumnAnchor[] {
  const xPositions: number[] = [];
  for (const row of rows) {
    for (const block of row.blocks) {
      xPositions.push(block.x);
    }
  }

  if (xPositions.length === 0) return [];

  const sorted = [...xPositions].sort((a, b) => a - b);
  const clusters: { x: number; xs: number[]; maxWidth: number }[] = [];

  for (const x of sorted) {
    const existing = clusters.find(c => Math.abs(c.x - x) <= X_TOLERANCE);
    if (existing) {
      existing.xs.push(x);
      existing.x = existing.xs.reduce((s, v) => s + v, 0) / existing.xs.length;
    } else {
      clusters.push({ x, xs: [x], maxWidth: 0 });
    }
  }

  // Compute span width from corresponding blocks
  for (const cluster of clusters) {
    let maxW = 0;
    for (const row of rows) {
      for (const block of row.blocks) {
        if (Math.abs(block.x - cluster.x) <= X_TOLERANCE) {
          if (block.width > maxW) maxW = block.width;
        }
      }
    }
    cluster.maxWidth = maxW;
  }

  return clusters
    .sort((a, b) => a.x - b.x)
    .map((c, i) => ({ index: i, x: c.x, spanWidth: c.maxWidth }));
}

export function snapToColumn(x: number, columns: ColumnAnchor[]): number {
  if (columns.length === 0) return 0;
  let nearest = 0;
  let minDist = Math.abs(columns[0].x - x);
  for (let i = 1; i < columns.length; i++) {
    const dist = Math.abs(columns[i].x - x);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  }
  return nearest;
}
