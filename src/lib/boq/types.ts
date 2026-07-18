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

  // Profit metrics (recomputed whenever cost or quote changes)
  totalCost: number | null;
  grossProfit: number | null;
  profitPercent: number | null;
  marginPercent: number | null;

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
