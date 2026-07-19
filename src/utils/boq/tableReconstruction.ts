import type { TextRow, ColumnAnchor, HeaderDetectionResult, BoqItem } from '../../types/boq';
import { snapToColumn } from './columnGrouping';

const ITEM_NO_RE = /^[A-Za-z]{0,3}\d+[\d.]*\.?$|^[A-Za-z]$/;

function looksLikeItemNo(text: string): boolean {
  return ITEM_NO_RE.test(text.trim());
}

function parseCurrency(text: string): number | undefined {
  const cleaned = text.replace(/[₹,\s]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : undefined;
}

function buildCellMap(row: TextRow, columns: ColumnAnchor[]): Record<number, string> {
  const cells: Record<number, string> = {};
  for (const block of row.blocks) {
    const colIdx = snapToColumn(block.x, columns);
    cells[colIdx] = cells[colIdx] ? cells[colIdx] + ' ' + block.text : block.text;
  }
  return cells;
}

export function reconstructBoqItems(
  rows: TextRow[],
  columns: ColumnAnchor[],
  header: HeaderDetectionResult,
): BoqItem[] {
  const items: BoqItem[] = [];
  let currentItem: Partial<BoqItem> | null = null;

  const { mapping } = header;

  const getCol = (cells: Record<number, string>, role: string): string | undefined => {
    for (const [colIdx, r] of Object.entries(mapping)) {
      if (r === role && cells[Number(colIdx)] !== undefined) {
        return cells[Number(colIdx)].trim();
      }
    }
    return undefined;
  };

  const finaliseItem = (item: Partial<BoqItem>): BoqItem => {
    const out: BoqItem = {
      id: crypto.randomUUID(),
      itemNo: item.itemNo ?? '',
      description: item.description ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity ?? 0,
    };
    if (item.code !== undefined) out.code = item.code;
    if (item.estimatedRate !== undefined) out.estimatedRate = item.estimatedRate;
    if (item.bidRate !== undefined) out.bidRate = item.bidRate;
    if (item.amount !== undefined) out.amount = item.amount;
    if (item.gst !== undefined) out.gst = item.gst;
    if (item.remarks !== undefined) out.remarks = item.remarks;
    if (item.schedule !== undefined) out.schedule = item.schedule;
    return out;
  };

  // Skip header row
  const dataRows = rows.slice(header.headerRowIndex + 1);

  for (const row of dataRows) {
    const cells = buildCellMap(row, columns);
    const itemNoText = getCol(cells, 'item_no') ?? '';
    const descText = getCol(cells, 'description') ?? '';
    const qtyText = getCol(cells, 'quantity') ?? '';

    const hasItemNo = itemNoText.length > 0 && looksLikeItemNo(itemNoText);
    const hasQty = parseCurrency(qtyText) !== undefined;
    const hasDesc = descText.length > 0;

    // Continuation row: no item number, has description, no quantity
    if (!hasItemNo && hasDesc && !hasQty && currentItem) {
      currentItem.description = (currentItem.description ?? '') + ' ' + descText;
      continue;
    }

    // New item row
    if (hasItemNo) {
      if (currentItem) {
        items.push(finaliseItem(currentItem));
      }
      currentItem = {
        itemNo: itemNoText,
        description: descText,
        unit: getCol(cells, 'unit') ?? '',
        quantity: parseCurrency(qtyText) ?? 0,
      };
      const code = getCol(cells, 'code');
      if (code) currentItem.code = code;
      const schedule = getCol(cells, 'schedule');
      if (schedule) currentItem.schedule = schedule;
      const estRate = parseCurrency(getCol(cells, 'estimated_rate') ?? '');
      if (estRate !== undefined) currentItem.estimatedRate = estRate;
      const bidRate = parseCurrency(getCol(cells, 'bid_rate') ?? '');
      if (bidRate !== undefined) currentItem.bidRate = bidRate;
      const amount = parseCurrency(getCol(cells, 'amount') ?? '');
      if (amount !== undefined) currentItem.amount = amount;
      const gst = parseCurrency(getCol(cells, 'gst') ?? '');
      if (gst !== undefined) currentItem.gst = gst;
      const remarks = getCol(cells, 'remarks');
      if (remarks) currentItem.remarks = remarks;
    }
  }

  if (currentItem) {
    items.push(finaliseItem(currentItem));
  }

  return items;
}
