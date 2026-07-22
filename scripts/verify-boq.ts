/**
 * verify-boq.ts — CLI harness for BOQ extraction verification.
 *
 * Delegates all verification logic to boqVerificationService (single source
 * of truth shared with the browser debug view and the orchestrator).
 *
 * Usage:
 *   npx tsx scripts/verify-boq.ts path/to/Schedule-B1.pdf
 *   npx tsx scripts/verify-boq.ts --fixture bareja
 *   npx tsx scripts/verify-boq.ts --fixture schedule-b
 *   npx tsx scripts/verify-boq.ts path/to/Schedule-B1.pdf --json > report.json
 *
 * Available fixture names: bareja, schedule-b
 * PDF files must be placed in scripts/fixtures/
 */

import './node-globals'; // must be first: polyfills DOMMatrix/Path2D before pdfjs-dist loads
import fs from 'fs';
import path from 'path';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoRows, rowText } from '../src/utils/boq/rowGrouping';
import { findAnchorRow } from '../src/utils/boq/anchorDetection';
import { reconstructBoqLinear } from '../src/utils/boq/linearReconstruction';
import { calculateConfidence } from '../src/utils/boq/confidenceScoring';
import { detectTenderBoqType } from '../src/services/boqClassifierService';
import { verifyExtraction } from '../src/services/boqVerificationService';
import { findFixture } from './fixtures';
import type { TextBlock, ExtractionResult } from '../src/types/boq';

GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

// ── PDF extraction (mirrors boqPdfExtractService without the browser worker) ─

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

// ── Output helpers ─────────────────────────────────────────────────────────

const C = { green: '\x1b[32m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m' };

function pass(msg: string)    { console.log(`  ${C.green}✓ PASS${C.reset}  ${msg}`); }
function fail(msg: string)    { console.log(`  ${C.red}✗ FAIL${C.reset}  ${msg}`); }
function info(msg: string)    { console.log(`         ${msg}`); }
function section(title: string) {
  console.log(`\n${C.bold}${'─'.repeat(64)}\n${title}\n${'─'.repeat(64)}${C.reset}`);
}

// ── CLI arg parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const fixtureIdx = args.indexOf('--fixture');

let pdfArg: string;
let expectedItemCount: number | undefined;
let multilineItems: string[] | undefined;

if (fixtureIdx !== -1) {
  const fixtureName = args[fixtureIdx + 1];
  if (!fixtureName) {
    console.error('Usage: npx tsx scripts/verify-boq.ts --fixture <name>');
    console.error('Available fixtures: bareja, schedule-b');
    process.exit(1);
  }
  const fixture = findFixture(fixtureName);
  if (!fixture) {
    console.error(`Unknown fixture: "${fixtureName}"`);
    console.error('Available fixtures: bareja, schedule-b');
    process.exit(1);
  }
  pdfArg = fixture.pdfPath;
  expectedItemCount = fixture.expectedItemCount;
  multilineItems = fixture.multilineItems;
  console.log(`\nFixture: ${fixture.description}`);
} else {
  pdfArg = args.find(a => !a.startsWith('--')) ?? '';
  if (!pdfArg) {
    console.error('Usage: npx tsx scripts/verify-boq.ts <path-to-pdf> [--json]');
    console.error('       npx tsx scripts/verify-boq.ts --fixture <name>');
    process.exit(1);
  }
  // No fixture: run without expectedItemCount so only structural checks apply
  expectedItemCount = undefined;
  multilineItems = [];
}

if (!fs.existsSync(pdfArg)) {
  console.error(`File not found: ${pdfArg}`);
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n${C.bold}BOQ Extraction Verification — ${path.basename(pdfArg)}${C.reset}`);

const t0 = Date.now();
const result = await extractFromPdf(pdfArg);
const parserMs = Date.now() - t0;

const t1 = Date.now();
const verification = verifyExtraction(result, {
  expectedItemCount,
  multilineItems,
});
const verifyMs = Date.now() - t1;

console.log(`Parser: ${parserMs}ms   Verification: ${verifyMs}ms   Items: ${result.items.length}\n`);
if (verification.statedTotal !== null) {
  console.log(`Stated total: ₹${verification.statedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(`Computed total: ₹${verification.computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n`);
}

// Print each check
for (let i = 0; i < verification.checks.length; i++) {
  const chk = verification.checks[i];
  section(`CHECK ${i + 1} — ${chk.name.toUpperCase()}${chk.critical ? ' [CRITICAL]' : ''}`);
  if (chk.pass) pass(chk.name); else fail(chk.name);
  chk.detail.forEach(d => info(d));
}

// Per-item table
section('ITEMS');
info(`${'#'.padEnd(4)} ${'No'.padEnd(8)} ${'Amount'.padStart(12)}  Description`);
for (const item of result.items) {
  const amtStr = item.amount !== undefined ? `₹${item.amount.toFixed(2)}` : '(no amount)';
  const desc = item.description.slice(0, 60);
  info(`${String(result.items.indexOf(item) + 1).padEnd(4)} ${item.itemNo.padEnd(8)} ${amtStr.padStart(12)}  ${desc}`);
}

// Summary
section('SUMMARY');
const passCount = verification.checks.filter(c => c.pass).length;
const total     = verification.checks.length;
console.log(`Score : ${verification.score}/100`);
console.log(`Checks: ${passCount}/${total} passed`);
if (verification.pass) {
  console.log(`\n${C.green}${C.bold}✓ ALL CRITICAL CHECKS PASSED${C.reset}\n`);
} else {
  console.log(`\n${C.red}${C.bold}✗ VERIFICATION FAILED${C.reset}`);
  verification.criticalFailures.forEach(f => console.log(`  • ${f}`));
  console.log();
}

if (jsonMode) {
  const reportPath = 'boq-verify-report.json';
  fs.writeFileSync(reportPath, JSON.stringify({
    pdfPath: pdfArg,
    parserMs,
    verifyMs,
    items: result.items,
    verification,
    tables: result.tables.map(t => ({ type: t.type, title: t.title, itemCount: t.items.length, headerConfidence: t.header?.confidence, mapping: t.header?.mapping })),
  }, null, 2));
  console.log(`Report written to ${reportPath}`);
}
