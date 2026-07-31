// Decides whether a freshly-extracted BOQ candidate may become the active
// boq_extraction/latest, must be held as a pending revision awaiting user
// confirmation, or must be discarded outright — used identically by every
// write site (Tier-1 immediate extraction, manual re-extract, Tier-2
// auto-trigger) so none of them can independently clobber a BOQ the user
// has already priced. Pure decision logic only — never touches the BOQ
// parsers or the Financial Engine, and never itself performs any I/O.
import type { BOQData } from './types';

export interface BoqCandidateSummary {
  itemCount: number;
  totalAmount: number;
  verificationScore: number;
  verificationPass: boolean;
  /** 0-100 overall extraction confidence, if available — the weakest
   *  tie-breaker, used only when score and item count both match. */
  overallConfidence?: number;
}

export interface ExistingBoqSlot {
  status?: string; // 'done' | 'no_boq_found' | 'failed' | 'running' | 'not_attempted' | undefined
  itemCount?: number;
  totalAmount?: number;
  verificationScore?: number;
}

/** Minimum item count for a candidate to be considered a real BOQ at all —
 *  mirrors the MIN_ITEM_ROWS convention already used by the xlsx parser's
 *  own recognition gate. A candidate below this can never replace, or even
 *  be offered as a pending revision for, an existing real BOQ. */
const MIN_REAL_ITEMS = 3;

export function isEligibleBoqCandidate(c: BoqCandidateSummary): boolean {
  return c.itemCount >= MIN_REAL_ITEMS && c.verificationPass;
}

function existingIsReal(existing: ExistingBoqSlot | null): boolean {
  return !!existing && existing.status === 'done' && (existing.itemCount ?? 0) >= MIN_REAL_ITEMS;
}

/**
 * Ranks two ELIGIBLE candidates against each other. Deliberately never
 * compares totalAmount — a blank-rate rate-contract SOR legitimately totals
 * ₹0 while still being the correct, higher-quality BOQ (populated
 * quantities, clean header match, real items) versus, say, a PDF candidate
 * with a nonzero total but far fewer/weaker items. Ranked by
 * verification.score first (the harness's own combined judgment), then
 * item count, then overall extraction confidence.
 */
export function isBetterBoqCandidate(candidate: BoqCandidateSummary, existing: BoqCandidateSummary): boolean {
  if (candidate.verificationScore !== existing.verificationScore) {
    return candidate.verificationScore > existing.verificationScore;
  }
  if (candidate.itemCount !== existing.itemCount) {
    return candidate.itemCount > existing.itemCount;
  }
  return (candidate.overallConfidence ?? 0) > (existing.overallConfidence ?? 0);
}

/** Same item count and total as what's already active — a redundant
 *  re-extraction of the same content, not a genuine revision. Exact
 *  equality only: a near-miss is treated as a real change, never silently
 *  collapsed into "nothing changed." */
export function isIdenticalToExisting(candidate: BoqCandidateSummary, existing: ExistingBoqSlot): boolean {
  return candidate.itemCount === (existing.itemCount ?? -1)
    && candidate.totalAmount === (existing.totalAmount ?? Number.NaN);
}

/**
 * True when the active BOQ has any sign of real user work at risk —
 * intentionally broad (any one signal is enough) since the cost of an
 * unnecessary confirmation prompt is far lower than silently discarding a
 * priced bid. Covers both percentage-rate (estimatedAmountConfirmed/
 * percentage/GST/finalisedAt) and grid/item-rate (quotedAmount, populated
 * via the pricing grid's own totals sync) paths.
 */
export function hasUserBidWork(boq: BOQData | null | undefined): boolean {
  if (!boq) return false;
  return boq.estimatedAmountConfirmed === true
    || boq.estimatedAmountEdited === true
    || boq.quotedAmount != null
    || boq.percentage != null
    || boq.finalisedAt != null
    || (boq.gstIncluded != null && boq.gstIncluded !== 'unknown')
    || !!(boq.manualOverride && Object.keys(boq.manualOverride).length > 0);
}

export type BoqReplacementDecision = 'apply' | 'pending' | 'discard';

/**
 * The single decision point every write site defers to:
 *  - Not eligible (empty/failed) → always 'discard'. An empty extraction
 *    can never replace, or even be offered as a revision of, a real one —
 *    this is unconditional, independent of whether the user has priced
 *    anything.
 *  - Nothing real currently active → 'apply' directly (nothing to protect).
 *  - Eligible, but identical to what's already active → 'discard' (no-op,
 *    not worth surfacing as a "revision").
 *  - Eligible and different, but the user hasn't done any bid work yet →
 *    'apply' directly (the "nothing to lose" edge case).
 *  - Eligible, different, AND the user has bid work at risk → 'pending' —
 *    never applied until the user explicitly confirms.
 */
export function decideBoqReplacement(
  candidate: BoqCandidateSummary,
  existing: ExistingBoqSlot | null,
  currentBoq: BOQData | null | undefined,
): BoqReplacementDecision {
  if (!isEligibleBoqCandidate(candidate)) return 'discard';
  if (!existingIsReal(existing)) return 'apply';
  if (isIdenticalToExisting(candidate, existing!)) return 'discard';
  if (!hasUserBidWork(currentBoq)) return 'apply';
  return 'pending';
}
