export type RevenueSource = 'auto' | 'manual';

export interface RevenueSyncDecision {
  /** New revenue value to apply directly, or null if nothing should change. */
  applyRevenue: number | null;
  /** New pendingRevenueSync value to hold for confirmation, or null to clear it. */
  pendingSync: number | null;
}

/**
 * Decision logic for BOQSection's onRevenueSync callback. Pure — the
 * component wires the result into setRevenue/setPendingRevenueSync.
 *
 * 'auto' (today's behavior, unchanged): apply directly, no prompt.
 * 'manual': never overwrite directly. Hold the incoming value as a pending
 * suggestion instead, unless it already matches what's stored (nothing to
 * confirm, and clears any stale pending suggestion).
 */
export function decideRevenueSync(
  revenueSource: RevenueSource,
  currentRevenue: number,
  incomingAmount: number,
): RevenueSyncDecision {
  if (revenueSource === 'auto') {
    return { applyRevenue: incomingAmount, pendingSync: null };
  }
  if (incomingAmount === currentRevenue) {
    return { applyRevenue: null, pendingSync: null };
  }
  return { applyRevenue: null, pendingSync: incomingAmount };
}

/**
 * One-time migration inference for projects that predate revenueSource:
 * if the stored revenue exactly matches what auto-sync would compute right
 * now, it's safe to resume auto-syncing. If it diverges, assume the bidder
 * had a reason and protect it as 'manual'.
 */
export function inferRevenueSource(
  storedRevenue: number,
  computedAutoRevenue: number | null,
): RevenueSource {
  if (computedAutoRevenue != null && storedRevenue === computedAutoRevenue) return 'auto';
  return 'manual';
}
