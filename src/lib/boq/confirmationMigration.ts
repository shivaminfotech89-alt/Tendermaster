import type { BOQData } from './types';

/**
 * One-time migration inference for projects that predate the Financial
 * Review / Profit Logic / Tender Validation confirmation gates (GST
 * confirm, Total Estimated Cost confirm, Tender Validity confirm, Expected
 * Revenue confirm). Every new gate reads a field that's `undefined` both for
 * a genuinely brand-new project (which SHOULD go through the full new
 * confirm flow) and for an already-finalized/actively-priced legacy project
 * (which should NOT suddenly be re-blocked). This tells the two apart.
 *
 * `isLegacy` requires positive evidence the project was already in active
 * use under the old rules — either it was finalized at least once, or it
 * already has non-null computed metrics (grossProfit + quotedAmount), which
 * only happens once a bidder has gone through pricing. A brand-new project
 * has neither, so it correctly falls through untouched.
 *
 * Mirrors the existing `inferRevenueSource` precedent in revenueSync.ts:
 * pure, comparison-based, no batch script needed — self-heals on next load.
 */
export function inferLegacyConfirmations(boq: BOQData): Partial<BOQData> {
  const isLegacy = boq.finalisedAt != null || (boq.grossProfit != null && boq.quotedAmount != null);
  if (!isLegacy) return {};

  const patch: Partial<BOQData> = {};

  if (boq.manualOverride?.gstIncluded === undefined && boq.gstIncluded && boq.gstIncluded !== 'unknown') {
    patch.manualOverride = { ...boq.manualOverride, gstIncluded: true };
  }

  if (boq.estimatedCostConfirmedValue == null && boq.totalCost != null) {
    patch.estimatedCostConfirmedValue = boq.totalCost;
  }

  if (boq.tenderValidityConfirmed === undefined) {
    patch.tenderValidityConfirmed = true;
  }

  if (boq.expectedRevenueConfirmed === undefined && boq.quotedAmount != null) {
    const legacyRevenue = boq.isRateContract === true ? boq.expectedContractValue ?? undefined : boq.quotedAmount;
    if (legacyRevenue != null) {
      patch.expectedRevenueConfirmed = true;
      patch.expectedRevenueConfirmedValue = legacyRevenue;
    }
  }

  return patch;
}
