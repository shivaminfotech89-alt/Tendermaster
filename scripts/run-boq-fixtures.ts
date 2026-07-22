/**
 * run-boq-fixtures.ts — Run all registered BOQ fixtures and print a summary.
 *
 * Usage:
 *   npx tsx scripts/run-boq-fixtures.ts
 *
 * PDF files must be present in scripts/fixtures/
 * Missing PDFs are reported as SKIP, not failures.
 */

import './node-globals'; // must be first: polyfills DOMMatrix/Path2D before pdfjs-dist loads
import fs from 'fs';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoRows, rowText } from '../src/utils/boq/rowGrouping';
import { findAnchorRow } from '../src/utils/boq/anchorDetection';
import { reconstructBoqLinear } from '../src/utils/boq/linearReconstruction';
import { calculateConfidence } from '../src/utils/boq/confidenceScoring';
import { detectTenderBoqType } from '../src/services/boqClassifierService';
import { verifyExtraction } from '../src/services/boqVerificationService';
import { FIXTURES } from './fixtures';
import type { TextBlock, ExtractionResult } from '../src/types/boq';

GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

function isTextItem(item: unknown): item is { str: string; transform: number[]; width: number; height: number } {
  return typeof item === 'object' && item !== null &&
    'str' in item && typeof (item as Record<string, unknown>).str === 'string';
}

async function extractFromPdf(pdfPath: string): Promise<ExtractionResult> {
  const buf = fs.readFileSync(pdfPath);
  const pdf = await getDocument({ data: new Uint8Array(buf.buffer as ArrayBuffer) }).promise;
  const allBlocks: TextBlock[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!isTextItem(item)) continue;
      const str = item.str.trim();
      if (!str) continue;
      const [, , , d, x, y] = item.transform;
      allBlocks.push({ text: str, x, y, width: item.width, height: item.height, page: p, fontSize: Math.abs(d) });
    }
  }
  const rows    = groupIntoRows(allBlocks);
  const rawText = rows.map(rowText).join('\n');
  const locked  = findAnchorRow(rows, 60);
  const { items, warnings } = locked
    ? reconstructBoqLinear(rows, locked)
    : { items: [], warnings: ['No anchor row found'] };
  const confidence = calculateConfidence([], warnings);
  const detectedBoqType = detectTenderBoqType(rawText, []);
  return { items, rateAnalyses: [], tables: [], detectedBoqType, isScanned: false, rawText, confidence };
}

const C = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };

console.log(`\n${C.bold}BOQ Fixture Suite${C.reset}`);
console.log('─'.repeat(72));

let passed = 0, failed = 0, skipped = 0;

for (const fixture of FIXTURES) {
  if (!fs.existsSync(fixture.pdfPath)) {
    console.log(`${C.yellow}SKIP${C.reset}  ${fixture.name.padEnd(14)} — PDF not found at ${fixture.pdfPath}`);
    skipped++;
    continue;
  }

  try {
    const result = await extractFromPdf(fixture.pdfPath);
    const v = verifyExtraction(result, {
      expectedItemCount: fixture.expectedItemCount,
      multilineItems: fixture.multilineItems ?? [],
      expectedQuantities: fixture.expectedQuantities,
    });

    const totalOk = v.statedTotal !== null
      ? Math.abs(v.computedTotal - (v.statedTotal ?? 0)) < 1
      : null;

    if (v.pass) {
      const itemsOk = result.items.length === fixture.expectedItemCount;
      const totalLabel = v.statedTotal !== null
        ? (totalOk ? ` ₹${v.computedTotal.toFixed(2)} ✓` : ` ₹${v.computedTotal.toFixed(2)} ✗ (expected ₹${fixture.expectedTotal})`)
        : ' (no stated total in PDF)';
      const mark = itemsOk && totalOk !== false ? C.green + 'PASS' : C.yellow + 'WARN';
      console.log(`${mark}${C.reset}  ${fixture.name.padEnd(14)}  ${result.items.length}/${fixture.expectedItemCount} items  score ${v.score}/100${totalLabel}`);
      if (itemsOk && totalOk !== false) passed++; else failed++;
    } else {
      console.log(`${C.red}FAIL${C.reset}  ${fixture.name.padEnd(14)}  ${result.items.length}/${fixture.expectedItemCount} items  score ${v.score}/100  failures: ${v.criticalFailures.join(', ')}`);
      failed++;
    }
  } catch (e) {
    console.log(`${C.red}ERR ${C.reset}  ${fixture.name.padEnd(14)}  ${String(e)}`);
    failed++;
  }
}

console.log('─'.repeat(72));
console.log(`${C.bold}${passed} passed, ${failed} failed, ${skipped} skipped${C.reset}\n`);
process.exit(failed > 0 ? 1 : 0);
