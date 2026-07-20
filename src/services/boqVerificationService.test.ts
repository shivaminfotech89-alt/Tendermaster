import { describe, it, expect } from 'vitest';
import { verifyExtraction, findStatedTotal } from './boqVerificationService';
import type { ExtractionResult } from '../types/boq';

function makeResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    items: [],
    rateAnalyses: [],
    tables: [],
    detectedBoqType: 'unknown',
    isScanned: false,
    rawText: '',
    confidence: { overallConfidence: 0, headerConfidence: 0, rowsExtracted: 0, tablesDetected: 0, warnings: [] },
    ...overrides,
  };
}

function makeItems(count: number, amount = 1000): ExtractionResult['items'] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    itemNo: String(i + 1),
    description: 'Test item description that is long enough to pass quality check easily',
    unit: 'Nos',
    quantity: 1,
    estimatedRate: amount,
    amount,
  }));
}

describe('findStatedTotal', () => {
  it('extracts total from "Say Amount Rs. 48266.00"', () => {
    expect(findStatedTotal('Say Amount Rs. 48266.00')).toBeCloseTo(48266, 0);
  });

  it('extracts total from "Grand Total Rs. 1,25,000.00"', () => {
    expect(findStatedTotal('Grand Total Rs. 1,25,000.00')).toBeCloseTo(125000, 0);
  });

  it('returns null when no pattern matches', () => {
    expect(findStatedTotal('Normal tender text without totals')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(findStatedTotal('')).toBeNull();
  });
});

describe('verifyExtraction', () => {
  it('passes when computed total matches stated total within ₹1', () => {
    const items = makeItems(3, 100);  // total = 300
    const result = makeResult({ items, rawText: 'Say Amount Rs. 300.00' });
    const v = verifyExtraction(result);
    expect(v.pass).toBe(true);
    expect(v.criticalFailures).toHaveLength(0);
  });

  it('fails reconciliation when diff > ₹1 (critical)', () => {
    const items = makeItems(3, 100);  // total = 300
    const result = makeResult({ items, rawText: 'Say Amount Rs. 500.00' });
    const v = verifyExtraction(result);
    expect(v.pass).toBe(false);
    expect(v.criticalFailures).toContain('Reconciliation');
    expect(v.score).toBe(0);
  });

  it('passes reconciliation when no stated total is found', () => {
    const items = makeItems(3, 100);
    const result = makeResult({ items, rawText: 'No totals here' });
    const v = verifyExtraction(result);
    const reconCheck = v.checks.find(c => c.name === 'Reconciliation');
    expect(reconCheck?.pass).toBe(true);
  });

  it('fails zero-items check (critical)', () => {
    const result = makeResult({ items: [], rawText: '' });
    const v = verifyExtraction(result);
    expect(v.pass).toBe(false);
    expect(v.criticalFailures).toContain('Items extracted');
  });

  it('score is 0 when critical check fails', () => {
    const result = makeResult({ items: [] });
    const v = verifyExtraction(result);
    expect(v.score).toBe(0);
  });

  it('score is > 60 when all critical checks pass', () => {
    const items = makeItems(5, 200);  // 1000 total
    const result = makeResult({ items, rawText: 'Say Amount Rs. 1000.00' });
    const v = verifyExtraction(result);
    expect(v.score).toBeGreaterThan(60);
  });

  it('non-critical check failure does not set pass=false', () => {
    const items = makeItems(5, 200);  // 1000 total, no description quality issues
    const result = makeResult({ items, rawText: 'Say Amount Rs. 1000.00' });
    // multilineItems set to items we know are short (all test items have long desc)
    const v = verifyExtraction(result, { multilineItems: ['99'] });  // item 99 not present
    // Item 99 not found is a non-critical failure, pass should still depend on critical
    expect(v.pass).toBe(true);   // critical checks pass
  });

  it('computedTotal is sum of item.amount values', () => {
    const items = makeItems(4, 250);  // 4 × 250 = 1000
    const result = makeResult({ items, rawText: '' });
    const v = verifyExtraction(result);
    expect(v.computedTotal).toBe(1000);
  });

  it('statedTotal is null when not found', () => {
    const items = makeItems(2, 100);
    const result = makeResult({ items, rawText: 'Nothing here' });
    const v = verifyExtraction(result);
    expect(v.statedTotal).toBeNull();
  });
});
