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

  // Legacy field rename: the original single "Tender Validity" concept
  // (tenderValidityDays/tenderValidityConfirmed) predates the Bid
  // Validity/Completion Period split and no longer exists on BOQData — but a
  // project saved during that window may still have it in Firestore. Map it
  // onto completionPeriodDays/completionPeriodConfirmed once (Completion
  // Period, which blocks Finalize, was the dominant real-world shape that
  // field was standing in for — Bid Validity is a new, non-blocking split
  // with no old equivalent, so it isn't grandfathered here at all). Falls
  // through to the same "just grandfather it in" rule as the other gates
  // when there's no old field to carry forward either.
  const legacy = boq as unknown as { tenderValidityDays?: number | null; tenderValidityConfirmed?: boolean };
  if (boq.completionPeriodDays === undefined && legacy.tenderValidityDays != null) {
    patch.completionPeriodDays = legacy.tenderValidityDays;
  }
  if (boq.completionPeriodConfirmed === undefined) {
    patch.completionPeriodConfirmed = legacy.tenderValidityConfirmed ?? true;
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
