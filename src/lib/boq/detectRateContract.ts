import type { BoqItem } from '../../types/boq';

/**
 * Weak, advisory signals that a percentage-rate tender is structurally an
 * Annual Rate Contract (ARC) — BOQ quantities are nominal unit-rate
 * placeholders, not real measured work volume, so the schedule sum is not
 * the contract's expected revenue. None of these ever auto-set
 * boq.isRateContract; they only inform how prominently the confirmation
 * banner is shown (see buildRateContractHint).
 */
export type RateContractSignal = 'title_mentions_rate_contract' | 'value_ratio' | 'nominal_quantities';

export interface RateContractHint {
  signals: RateContractSignal[];
  reasons: string[];
}

const TITLE_PATTERN = /\b(annual\s+)?rate\s+contract\b/i;

/** AI-estimated value flagged when it's more than this multiple of the schedule sum. */
const VALUE_RATIO_THRESHOLD = 5;

/** Quantities flagged as nominal when this fraction of items share one value. */
const NOMINAL_QUANTITY_FRACTION = 0.8;
const MIN_ITEMS_FOR_QUANTITY_SIGNAL = 3;

/**
 * Text is AI-summarized (tender_simplified.scope_of_work / bid_recommendation
 * fields), not the raw PDF — analysis text doesn't reliably preserve the
 * literal document title, but a genuine Annual Rate Contract's defining
 * characteristic is likely to surface somewhere in the AI's own summary.
 */
export function detectTitleMention(text: string): boolean {
  return TITLE_PATTERN.test(text);
}

export function detectValueRatio(
  scheduleAmount: number | null | undefined,
  aiEstimatedValue: number | null | undefined,
): boolean {
  if (!scheduleAmount || scheduleAmount <= 0 || !aiEstimatedValue || aiEstimatedValue <= 0) return false;
  return aiEstimatedValue / scheduleAmount > VALUE_RATIO_THRESHOLD;
}

export function detectNominalQuantities(items: BoqItem[]): boolean {
  if (items.length < MIN_ITEMS_FOR_QUANTITY_SIGNAL) return false;
  const counts = new Map<number, number>();
  for (const item of items) {
    counts.set(item.quantity, (counts.get(item.quantity) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount / items.length >= NOMINAL_QUANTITY_FRACTION;
}

/**
 * Combines the three signals into one hint. `nominalQuantities` is computed
 * by the caller (BOQViewer, which has `items`; BOQSection doesn't) and
 * passed in — this function itself does no BoqItem-level work.
 */
export function buildRateContractHint(
  analysisText: string,
  scheduleAmount: number | null | undefined,
  aiEstimatedValue: number | null | undefined,
  nominalQuantities: boolean,
): RateContractHint {
  const signals: RateContractSignal[] = [];
  const reasons: string[] = [];

  if (detectTitleMention(analysisText)) {
    signals.push('title_mentions_rate_contract');
    reasons.push('Tender summary mentions a Rate Contract');
  }

  if (detectValueRatio(scheduleAmount, aiEstimatedValue)) {
    signals.push('value_ratio');
    const ratio = aiEstimatedValue! / scheduleAmount!;
    reasons.push(`AI-estimated contract value is ~${ratio.toFixed(0)}x the BOQ schedule total`);
  }

  if (nominalQuantities) {
    signals.push('nominal_quantities');
    reasons.push('Most BOQ quantities share the same nominal value (e.g. 1)');
  }

  return { signals, reasons };
}

const CONFIRM_STATUS_REASON = 'Confirm Rate Contract status above to see margin';
const ENTER_VALUE_REASON = 'Enter Expected Contract Value below to see margin';

export interface RateContractRevenueResult {
  /** true when margin must not be computed/shown/finalized at all. */
  gated: boolean;
  /** Human-readable reason, set whenever gated is true. */
  reason: string | null;
  /** The revenue figure margin/profit calculations should use, or null
   *  while gated — never a schedule-derived number for a confirmed Rate
   *  Contract with no bidder-entered value. */
  revenue: number | null;
}

/**
 * Resolves what revenue figure (if any) should drive Gross Profit/Margin —
 * the single source of truth both BOQSection and ProjectDetails' Bid Engine
 * panel must agree on, so they can never show conflicting numbers.
 *
 *   isRateContract undetermined + 2 or more hint signals → gated, no default
 *     in either direction (not "assume yes", not "assume no").
 *   isRateContract === true, no bidder-entered value yet → gated.
 *   isRateContract === true, value entered                → that value.
 *   isRateContract === false, or undetermined with <2 signals → fallbackRevenue
 *     (today's behavior: the schedule-derived quotedAmount) — the majority
 *     case, must stay byte-identical to before this feature existed.
 */
export function resolveRateContractRevenue(
  isRateContract: boolean | undefined,
  expectedContractValue: number | null | undefined,
  hintSignalCount: number,
  fallbackRevenue: number | null,
): RateContractRevenueResult {
  if (isRateContract === undefined && hintSignalCount >= 2) {
    return { gated: true, reason: CONFIRM_STATUS_REASON, revenue: null };
  }
  if (isRateContract === true) {
    if (expectedContractValue == null || expectedContractValue <= 0) {
      return { gated: true, reason: ENTER_VALUE_REASON, revenue: null };
    }
    return { gated: false, reason: null, revenue: expectedContractValue };
  }
  return { gated: false, reason: null, revenue: fallbackRevenue };
}

/** "Close to Tender Value" tolerance for the Step 1 mis-entry warning. */
const CLOSE_TO_TENDER_VALUE_TOLERANCE = 0.1;

/**
 * Advisory-only: flags when a value being typed into "Schedule-B Amount"
 * looks like it might actually be the overall Tender Value instead — close
 * to the AI-read tender value, while far from the BOQ's actual extracted
 * schedule sum. Purely a UI warning on the input; never blocks confirmation,
 * never feeds resolveRateContractRevenue or any pricing calculation.
 */
export function detectMisenteredScheduleAmount(
  enteredValue: number,
  tenderValue: number | null | undefined,
  actualScheduleSum: number | null | undefined,
): boolean {
  if (!tenderValue || tenderValue <= 0) return false;
  const closeToTenderValue = Math.abs(enteredValue - tenderValue) / tenderValue < CLOSE_TO_TENDER_VALUE_TOLERANCE;
  if (!closeToTenderValue) return false;
  return detectValueRatio(actualScheduleSum, enteredValue);
}
