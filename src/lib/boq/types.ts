export type BOQType =
  | 'percentage_rate'
  | 'item_rate'
  | 'lump_sum_epc'
  | 'hybrid'
  | 'unknown';

export type BOQTypeConfidence = 'high' | 'medium' | 'low';

// One financial value extracted from the tender document
export interface FinancialValueCandidate {
  label: string;        // e.g. "Estimated Amount Put to Tender"
  valueRaw: string;     // e.g. "₹1,25,00,000"
  valueNumber: number;  // e.g. 12500000 (INR, numeric)
  page?: number;        // PDF page number
  clause?: string;      // e.g. "Clause 3.1"
  sourceText?: string;  // verbatim excerpt
}

// BOQ state persisted on the project document
export interface BOQData {
  boqType: BOQType;
  boqTypeConfidence?: BOQTypeConfidence;
  boqTypeScore?: number;    // 0-100 numeric from auto-detection; undefined = manually set
  boqTypeReason?: string;   // decision log from detectBoqTypeFromText / detectBoqTypeFromItems

  // Candidate pool from analysis (stored for re-display after reload)
  financialCandidates?: FinancialValueCandidate[];
  suggestedCandidateIndex?: number;

  // User-confirmed estimated amount
  estimatedAmount: number | null;
  estimatedAmountConfirmed: boolean;
  estimatedAmountEdited: boolean;   // true if user changed the AI-extracted value
  estimatedAmountPage?: number;
  estimatedAmountClause?: string;
  estimatedAmountText?: string;     // source excerpt

  // Pricing
  aboveBelow: 'above' | 'below';
  percentage: number | null;        // e.g. 5 means 5%
  quotedAmount: number | null;
  quotedAmountWords: string | null;
  remarks: string;

  // Annual Rate Contract flag — tri-state via absence. undefined = undetermined
  // (never inferred by code, only ever set by an explicit user click). When
  // true, the BOQ schedule sum is a sum of nominal unit rates, not the
  // contract's expected revenue — see boqExpectedContractValue below.
  isRateContract?: boolean;
  /** Bidder-entered expected contract value/volume — the only number that
   *  drives revenue/margin for a confirmed Rate Contract. Never auto-filled. */
  expectedContractValue?: number | null;

  // Universal Expected Revenue confirmation — extends (never modifies)
  // resolveRateContractRevenue's gating discipline to its previously-ungated
  // fallback branch (non-Rate-Contract types), where quotedAmount was used as
  // revenue with no explicit confirmation step at all. See
  // resolveExpectedRevenueConfirmation in detectRateContract.ts.
  expectedRevenueConfirmed?: boolean;
  /** Snapshot of exactly what was confirmed — compared against the live
   *  suggested value each render; any drift (bid % edited, cess/GST changed,
   *  etc.) auto-reopens the gate without a manual "reconfirm" click. */
  expectedRevenueConfirmedValue?: number | null;
  /** Non-Rate-Contract path only: set when the bidder picks "No, enter
   *  expected value" and types something other than the suggested figure.
   *  For the Rate Contract path, expectedContractValue itself holds this. */
  expectedRevenueOverride?: number | null;

  // Profit metrics (recomputed whenever cost or quote changes)
  totalCost: number | null;
  grossProfit: number | null;
  profitPercent: number | null;
  marginPercent: number | null;

  /** Snapshot of totalCost (materials + labour, computed in ProjectDetails)
   *  at the moment the bidder confirmed it. Derived, not stored as a
   *  boolean: estimatedCostConfirmed = estimatedCostConfirmedValue ===
   *  totalCost && totalCost > 0 — self-healing, re-gates automatically the
   *  moment the underlying cost estimate changes. */
  estimatedCostConfirmedValue?: number | null;

  // Tender Validity — detected from raw tender text (or the AI's
  // execution_duration summary as a weaker fallback signal), confirmed
  // before Finalize. No calculation currently consumes this number; it's a
  // confirmed, displayed fact and a Finalize gate only — see
  // detectTenderValidity.ts.
  tenderValidityDays?: number | null;
  tenderValidityConfirmed?: boolean;
  tenderValidityConfidence?: number;      // 0-100
  tenderValidityReason?: string;          // decision log, mirrors gstCessDetectionReason

  // Statutory additions on top of the net quoted amount — cess applied
  // first, then GST on the cess-inclusive total (see applyCessAndGst in
  // calculator.ts). Optional: undefined means no cess/GST entered yet.
  // BOQ-type-agnostic, and the review/edit UI in BOQSection now covers all
  // boqTypes (previously item_rate/lump_sum only).
  cessPercent?: number;
  gstPercent?: number;
  cessAmount?: number;
  gstAmount?: number;
  totalWithGst?: number;
  roundOff?: number;
  roundedTotal?: number;            // final grand-total figure for the bid

  // GST/Cess detection — from detectGstCess.ts, run once on the extraction's
  // raw text at manual-extract time (never persisted itself; only the
  // structured result is). Tri-state 'unknown' is the explicit default —
  // never guessed. 'yes'/'no' mean no GST addition on top of the subtotal
  // (rates already include it, or it doesn't apply); 'separate' means GST is
  // added on top via applyCessAndGst.
  gstIncluded?: 'yes' | 'no' | 'separate' | 'unknown';
  /** Percentage-rate only — where the bid % applies. Asked (not inferred)
   *  when gstCessConfidence < 90; item-rate/lump-sum have no ambiguity here
   *  since their subtotal is already a real summed total. */
  bidBasis?: 'schedule_total' | 'before_gst' | 'boq_total' | 'not_sure';
  gstCessConfidence?: number;       // 0-100
  gstCessDetectionReason?: string;  // decision log, mirrors boqTypeReason
  /** Presence of a key means that field was human-set and must never be
   *  silently rewritten by re-detection/re-analysis again. */
  manualOverride?: {
    gstIncluded?: true;
    bidBasis?: true;
    scheduleValue?: true;
    tenderValidity?: true;
  };

  // Tracking
  boqLastChangedAt?: number;        // Date.now() on any change
  finalisedAt?: any;                // Firestore Timestamp of last finalize
}

// Immutable bid snapshot stored in the subcollection
export interface BidSnapshot {
  version: number;
  boqType: BOQType;
  estimatedAmount: number;
  estimatedAmountConfirmed: true;
  estimatedAmountEdited: boolean;
  estimatedAmountClause?: string;
  estimatedAmountText?: string;
  aboveBelow: 'above' | 'below';
  percentage: number;
  quotedAmount: number;
  quotedAmountWords: string;
  totalCost: number;
  grossProfit: number;
  profitPercent: number;
  marginPercent: number;
  cessPercent?: number;
  gstPercent?: number;
  cessAmount?: number;
  gstAmount?: number;
  totalWithGst?: number;
  roundOff?: number;
  roundedTotal?: number;

  // Distinctly-named duplicates of the fields above, added so the three
  // concepts (overall tender scale vs. pricing basis vs. quoted figure)
  // can never be confused when reading a snapshot. The original fields
  // above are kept unchanged for backward compatibility — these are
  // additive, not replacements.
  tenderValue?: number;          // bid_recommendation.estimated_value — reference only
  scheduleBAmount?: number;      // = estimatedAmount — the confirmed pricing basis
  quotedScheduleAmount?: number; // = quotedAmount — the bidder's figure against the schedule
  pricingMethod?: string;        // e.g. "Percentage Rate", "Item Rate", "Lump Sum / Package"
  bidPercent?: number;           // = percentage, re-exposed under an unambiguous name

  // Confirmed Expected Revenue and Tender Validity at finalize time —
  // distinct from quotedScheduleAmount (see resolveExpectedRevenueConfirmation).
  expectedRevenue?: number;
  tenderValidityDays?: number;

  remarks: string;
  createdAt: any;
  createdBy: string;
}

export interface BidSnapshotRow extends BidSnapshot {
  id: string;
}

export const INITIAL_BOQ: BOQData = {
  boqType: 'unknown',
  estimatedAmount: null,
  estimatedAmountConfirmed: false,
  estimatedAmountEdited: false,
  aboveBelow: 'above',
  percentage: null,
  quotedAmount: null,
  quotedAmountWords: null,
  remarks: '',
  totalCost: null,
  grossProfit: null,
  profitPercent: null,
  marginPercent: null,
};
