/**
 * Diagnostic: print rows in a range, showing cell attribution using the
 * calibrated locked column map so we can verify reconstruction will work.
 */
import fs from 'fs';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoRows } from '../src/utils/boq/rowGrouping';
import { findAnchorRow } from '../src/utils/boq/anchorDetection';
import { extractCells, classifyRow } from '../src/utils/boq/rowClassifier';
import type { TextBlock } from '../src/types/boq';

GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const pdfPath = process.argv[2] ?? 'C:\\Users\\Administrator\\Downloads\\part1.pdf';
const buf = fs.readFileSync(pdfPath);
const pdf = await getDocument({ data: new Uint8Array(buf.buffer as ArrayBuffer) }).promise;
const allBlocks: TextBlock[] = [];

for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (typeof item !== 'object' || !item || !('str' in item)) continue;
    const str = (item as any).str.trim();
    if (!str) continue;
    const [,,, d, x, y] = (item as any).transform;
    allBlocks.push({ text: str, x, y, width: (item as any).width, height: (item as any).height, page: p, fontSize: Math.abs(d) });
  }
}

const rows = groupIntoRows(allBlocks);
const map = findAnchorRow(rows, 60);

if (!map) {
  console.log('NO ANCHOR FOUND');
  process.exit(1);
}

console.log(`Anchor at row ${map.anchorRowIndex}, confidence=${map.anchorConfidence.toFixed(1)}`);
console.log(`Header: "${map.headerText}"`);
console.log('Boundaries:');
map.boundaries.forEach(b => console.log(`  ${b.role}: [${b.minX}, ${b.maxX})`));

console.log('\n--- DATA ROWS (anchor+1 to end, compact) ---');
const start = map.anchorRowIndex + 1;
const end = rows.length;

for (let ri = start; ri < end; ri++) {
  const row = rows[ri];
  const classified = classifyRow(row, map);
  const cells = classified.cells;
  const cls = classified.rowClass;
  const marker = cls === 'new_item' ? '>>>' : cls === 'section_break' ? '===' : cls === 'skip' ? '---' : '   ';

  const cellStr = [
    cells.item_no   ? `itemNo="${cells.item_no}"` : '',
    cells.description ? `desc="${cells.description.slice(0, 40)}"` : '',
    cells.quantity  ? `qty=${cells.quantity}` : '',
    cells.unit      ? `unit=${cells.unit}` : '',
    cells.estimated_rate ? `rate=${cells.estimated_rate}` : '',
    cells.amount    ? `amt=${cells.amount}` : '',
  ].filter(Boolean).join(' ');

  console.log(`${marker}[${ri}] p${row.page} y=${Math.round(row.baseY)} ${cls}: ${cellStr}`);
}
