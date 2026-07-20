/**
 * Diagnostic: print the top anchor candidates and first 50 rows with their
 * role-match scores so we can see what the real header looks like.
 */
import fs from 'fs';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoRows, rowText } from '../src/utils/boq/rowGrouping';
import { detectRoleForText } from '../src/utils/boq/headerDetection';
import type { TextBlock, TextRow } from '../src/types/boq';

GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: npx tsx scripts/diagnose-anchor.ts path.pdf'); process.exit(1); }

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
console.log(`Total rows: ${rows.length}`);
console.log('\n--- FIRST 80 ROWS with block details ---');

for (let ri = 0; ri < Math.min(80, rows.length); ri++) {
  const row = rows[ri];
  const blocks = row.blocks.map(b => {
    const { role, score } = detectRoleForText(b.text);
    return `"${b.text}"@x=${Math.round(b.x)}[${role}:${score}]`;
  }).join('  ');
  console.log(`[${ri}] p${row.page} y=${Math.round(row.baseY)}: ${blocks}`);
}

console.log('\n--- ANCHOR CANDIDATES (rows with ≥3 role matches) ---');
for (let ri = 0; ri < rows.length; ri++) {
  const row = rows[ri];
  const hits = row.blocks.map(b => detectRoleForText(b.text)).filter(h => h.role !== 'unknown');
  const roles = new Set(hits.map(h => h.role));
  if (roles.size >= 3) {
    const hasItemNo = roles.has('item_no');
    const hasDesc = roles.has('description');
    console.log(`\nRow ${ri} (p${row.page} y=${Math.round(row.baseY)}) — ${roles.size} roles, hasItemNo=${hasItemNo}, hasDesc=${hasDesc}`);
    console.log(`  Text: ${rowText(row)}`);
    row.blocks.forEach(b => {
      const { role, score } = detectRoleForText(b.text);
      if (role !== 'unknown') console.log(`    "${b.text}"@x=${Math.round(b.x)} → ${role}(${score})`);
    });
  }
}
