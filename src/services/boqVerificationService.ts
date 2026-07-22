/**
 * BOQ Verification Service — single source of truth for all verification logic.
 *
 * Used by:
 *   - boqExtractionOrchestrator (decides parser-pass vs Vision fallback)
 *   - scripts/verify-boq.ts     (CLI harness)
 *   - BoqDebugView               (browser debug UI)
 *
 * Acceptance rule: reconciliation is a HARD GATE.  A weighted score that
 * passes despite a failed reconciliation is the exact failure mode to avoid.
 * Critical checks gate the result; non-critical checks contribute to score
 * only.
 */

import type { ExtractionResult, VerificationCheck, VerificationResult } from '../types/boq';

// ── Configuration ──────────────────────────────────────────────────────────

export interface VerificationOptions {
  /** Known item count (used for completeness check) */
  expectedItemCount?: number;
  /** Item numbers whose descriptions should be multi-line (spot-check) */
  multilineItems?: string[];
  /** Lowercase title substrings that identify Rate Analysis tables */
  rateAnalysisTitleFragments?: string[];
  /** Regex that flags material/labour/machinery rows leaking into items */
  materialLeakRe?: RegExp;
}

const DEFAULT_MULTILINE_ITEMS = ['13', '14', '26', '34', '36'];
const DEFAULT_RA_FRAGMENTS = ['ra-1', 'ra-2', 'ra-3', 'cost aggregate', 's.d.b.c'];
const DEFAULT_MATERIAL_LEAK_RE = /\b(material|labour|labor|machinery|transport|overhead|profit)\b/i;

// ── Public API ─────────────────────────────────────────────────────────────

export function verifyExtraction(
  result: ExtractionResult,
  options: VerificationOptions = {},
): VerificationResult {
  const { items, tables, rawText } = result;
  const opts = {
    multilineItems:            options.multilineItems            ?? DEFAULT_MULTILINE_ITEMS,
    rateAnalysisTitleFragments:options.rateAnalysisTitleFragments ?? DEFAULT_RA_FRAGMENTS,
    materialLeakRe:            options.materialLeakRe            ?? DEFAULT_MATERIAL_LEAK_RE,
    expectedItemCount:         options.expectedItemCount,
  };

  const statedTotal     = findStatedTotal(rawText);
  const computedTotal   = roundTwo(
    items.filter(i => i.amount !== undefined).reduce((s, i) => s + (i.amount ?? 0), 0),
  );

  const checks: VerificationCheck[] = [
    checkReconciliation(computedTotal, statedTotal),
    checkZeroItems(items.length),
    checkRaIsolation(items, tables, opts.rateAnalysisTitleFragments, opts.materialLeakRe),
    checkItemCompleteness(items, opts.expectedItemCount),
    checkDescriptionQuality(items, opts.multilineItems),
  ];

  const criticalFailures = checks
    .filter(c => c.critical && !c.pass)
    .map(c => c.name);

  // Score: critical gate first; non-critical add up to 40 points
  const criticalPass     = criticalFailures.length === 0;
  const nonCritical      = checks.filter(c => !c.critical);
  const nonCriticalScore = nonCritical.length > 0
    ? (nonCritical.filter(c => c.pass).length / nonCritical.length) * 40
    : 40;
  const score = criticalPass ? Math.round(60 + nonCriticalScore) : 0;

  return {
    pass: criticalPass,
    checks,
    criticalFailures,
    statedTotal,
    computedTotal,
    score,
  };
}

/**
 * Scans raw PDF text for patterns that indicate an authoritative total.
 * Returns the first plausible value, or null if none found.
 */
export function findStatedTotal(rawText: string): number | null {
  const patterns = [
    // Most explicit — "say amount" or "total amount" labels
    /say\s+amount[^₹0-9]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    /grand\s+total[^₹0-9]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    /total\s+amount[^₹0-9]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    /estimated\s+amount[^₹0-9]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    /total\s*=\s*[^₹0-9]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    // "TOTAL COST FOR PART-A ₹58,42,000.00" — lettered summary row in Indian electrical/supply BOQs
    /total\s+cost\s+for\s+part\b[^0-9₹]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
    /total\s+for\s+part\b[^0-9₹]*[₹Rs.\s]*([0-9,]+\.?[0-9]*)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(rawText);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// ── Individual checks ──────────────────────────────────────────────────────

function checkReconciliation(
  computedTotal: number,
  statedTotal: number | null,
): VerificationCheck {
  const diff   = statedTotal !== null ? Math.abs(computedTotal - statedTotal) : null;
  const passes = diff !== null ? diff < 1 : true; // no stated total → skip

  return {
    name:     'Reconciliation',
    pass:     passes,
    critical: true,
    detail: [
      statedTotal !== null
        ? `Stated total : ₹${fmt(statedTotal)}`
        : 'Stated total : not found in document (reconciliation skipped)',
      `Computed total: ₹${fmt(computedTotal)}`,
      diff !== null
        ? `Difference   : ₹${diff.toFixed(2)}${diff < 1 ? ' ✓' : ' ✗'}`
        : '(no comparison possible)',
    ],
  };
}

function checkZeroItems(count: number): VerificationCheck {
  return {
    name:     'Items extracted',
    pass:     count > 0,
    critical: true,
    detail:   [`${count} item${count === 1 ? '' : 's'} extracted`],
  };
}

function checkRaIsolation(
  items: ExtractionResult['items'],
  tables: ExtractionResult['tables'],
  raFragments: string[],
  materialLeakRe: RegExp,
): VerificationCheck {
  const boqTables  = tables.filter(t => t.type === 'boq_schedule');
  const raInBoq    = boqTables.filter(t =>
    raFragments.some(frag => (t.title ?? '').toLowerCase().includes(frag)),
  );
  const leakedRows = items.filter(i =>
    materialLeakRe.test(i.description) && !/^\d+$/.test(i.itemNo),
  );

  return {
    name:     'Rate Analysis isolation',
    pass:     raInBoq.length === 0 && leakedRows.length === 0,
    critical: true,
    detail: [
      `Tables: ${tables.length} total, ${boqTables.length} BOQ, ${tables.filter(t => t.type === 'rate_analysis').length} RA`,
      raInBoq.length > 0
        ? `⚠ RA tables in boq_schedule: ${raInBoq.map(t => t.title).join(', ')}`
        : '✓ No RA tables leaked into boq_schedule',
      leakedRows.length > 0
        ? `⚠ ${leakedRows.length} material/labour rows in items`
        : '✓ No material/labour rows in item list',
    ],
  };
}

function checkItemCompleteness(
  items: ExtractionResult['items'],
  expectedCount: number | undefined,
): VerificationCheck {
  const nos     = items.map(i => i.itemNo.trim());
  const counts  = nos.reduce<Record<string, number>>((acc, n) => {
    acc[n] = (acc[n] ?? 0) + 1; return acc;
  }, {});
  const dupes   = Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
  const missing = expectedCount
    ? Array.from({ length: expectedCount }, (_, i) => String(i + 1)).filter(n => !nos.includes(n))
    : [];

  const pass =
    items.length > 0 &&
    dupes.length === 0 &&
    (expectedCount === undefined || items.length === expectedCount);

  return {
    name:     'Item completeness',
    pass,
    critical: false,
    detail: [
      `Extracted: ${items.length}${expectedCount ? ` / ${expectedCount} expected` : ''}`,
      missing.length > 0 ? `Missing: ${missing.join(', ')}` : '✓ No missing items',
      dupes.length > 0   ? `Duplicates: ${dupes.join(', ')}`  : '✓ No duplicates',
    ],
  };
}

function checkDescriptionQuality(
  items: ExtractionResult['items'],
  multilineNos: string[],
): VerificationCheck {
  const problems: string[] = [];

  for (const no of multilineNos) {
    const item = items.find(i => i.itemNo.trim() === no);
    if (!item) {
      problems.push(`item ${no} not found`);
    } else if (item.description.trim().length < 60) {
      problems.push(`item ${no} description short (${item.description.length}c)`);
    }
  }

  const phantoms = items.filter(i => !i.description.trim() && i.quantity === 0);
  if (phantoms.length > 0) problems.push(`${phantoms.length} phantom rows`);

  return {
    name:     'Description quality',
    pass:     problems.length === 0,
    critical: false,
    detail:   problems.length > 0 ? problems : ['✓ Multi-line descriptions intact, no phantom rows'],
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function roundTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
