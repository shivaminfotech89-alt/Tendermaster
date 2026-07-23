import type { BOQData } from './types';

export type BidStatus = 'not_started' | 'in_progress' | 'completed' | 'locked';

export interface BidStatusResult {
  status: BidStatus;
  label: string;
}

const LABELS: Record<BidStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  locked: 'Locked',
};

/**
 * Pure display-label derivation — no new state, no enforcement. "Locked"
 * reflects that a bid_snapshots entry exists (boq.finalisedAt set); it does
 * not disable further edits (BOQSection already allows re-finalizing, and
 * changing that would be a snapshot-behavior change, out of scope here).
 *
 * Grid mode (item-rate/lump-sum) note: boq.quotedAmount goes non-null as
 * soon as the FIRST row is priced (see BOQViewer's onItemRateTotalsChange
 * gating), so "Completed" for grid mode is judged by pricedItemCount vs
 * totalItems, not by quotedAmount alone — otherwise pricing one row out of
 * 500 would misreport as "Completed".
 */
export function deriveBidStatus(
  boq: BOQData | undefined,
  isGridMode: boolean,
  pricedItemCount: number,
  totalItems: number,
): BidStatusResult {
  if (!boq) return { status: 'not_started', label: LABELS.not_started };

  if (boq.finalisedAt != null) {
    return { status: 'locked', label: LABELS.locked };
  }

  if (isGridMode) {
    if (totalItems > 0 && pricedItemCount >= totalItems) {
      return { status: 'completed', label: LABELS.completed };
    }
    if (pricedItemCount > 0) {
      return { status: 'in_progress', label: LABELS.in_progress };
    }
    return { status: 'not_started', label: LABELS.not_started };
  }

  // Percentage-rate: no per-row partial state, just estimated-amount →
  // percentage → quoted-amount.
  if (boq.quotedAmount != null) {
    return { status: 'completed', label: LABELS.completed };
  }
  if (boq.estimatedAmountConfirmed) {
    return { status: 'in_progress', label: LABELS.in_progress };
  }
  return { status: 'not_started', label: LABELS.not_started };
}
