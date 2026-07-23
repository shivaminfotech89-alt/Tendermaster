import type { BoqItem } from '../../types/boq';

export type DataQualityLevel = 'ok' | 'warning';

export interface DataQualityResult {
  level: DataQualityLevel;
  issues: string[];
}

/** Amount is flagged when it differs from Quantity × Department Rate by more than this fraction. */
const AMOUNT_MISMATCH_TOLERANCE = 0.01;

/**
 * Mode-agnostic sanity checks on the department's extracted BOQ data
 * (quantity/unit/rate/amount) — shared by the read-only table and the
 * editable pricing grid so both surface the same warnings from one
 * implementation. Has no concept of bidder rates; see itemPricing.ts for
 * pricing-specific validation (missing/extreme bid rate, duplicates).
 */
const COMPARE_SUFFIX = 'Please compare with the original BOQ.';

export function checkBoqItemDataQuality(item: BoqItem): DataQualityResult {
  const issues: string[] = [];

  if (item.quantity <= 0) {
    issues.push(`Quantity could not be confidently extracted. ${COMPARE_SUFFIX}`);
  }

  if (!item.unit || !item.unit.trim()) {
    issues.push(`Unit could not be confidently extracted. ${COMPARE_SUFFIX}`);
  }

  if (item.estimatedRate === undefined || item.estimatedRate <= 0) {
    issues.push(`Rate could not be confidently extracted. ${COMPARE_SUFFIX}`);
  }

  if (item.estimatedRate !== undefined && item.amount !== undefined && item.quantity > 0) {
    const expected = item.quantity * item.estimatedRate;
    if (expected > 0 && Math.abs(item.amount - expected) / expected > AMOUNT_MISMATCH_TOLERANCE) {
      issues.push(`Amount does not match Quantity × Rate. ${COMPARE_SUFFIX}`);
    }
  }

  return { level: issues.length > 0 ? 'warning' : 'ok', issues };
}
