// Read-only mirror of BOQSection.tsx's own derivation (its "Computed values"
// section, through gstConfirmed) — same pure functions, same BOQData input,
// so the print report can never show a figure that disagrees with the Bid
// Engine tab. Deliberately excludes BOQSection's sync effects (which call
// setBoq/onRevenueSync) — this module only reads, never writes.
import type { BOQData } from './types';
import {
  netBidAmount, calcProfit, getBidWarnings, applyCessAndGst, resolveGstCalculationMode,
  type ProfitMetrics, type WarningResult, type CessGstBreakdown,
} from './calculator';
import {
  buildRateContractHint, resolveRateContractRevenue, resolveExpectedRevenueConfirmation,
  type ExpectedRevenueConfirmation,
} from './detectRateContract';
import { extractAnalysisText, extractBidRecommendationEstimatedValue } from './detectBoqType';
import { toIndianWords } from './indianWords';

export interface BidPrintSummary {
  isGridMode: boolean;
  modeLabel: string;
  aiEstimatedValue: number | null;
  quotedAmount: number | null;
  words: string | null;
  derivedPercentage: number | null;
  derivedAboveBelow: 'above' | 'below';
  expectedRevenue: ExpectedRevenueConfirmation;
  metrics: ProfitMetrics | null;
  warnings: WarningResult | null;
  gstIncluded: 'yes' | 'no' | 'separate' | 'unknown';
  cessGst: CessGstBreakdown | null;
}

export function computeBidPrintSummary(
  boq: BOQData,
  analysisResult: unknown,
  totalCost: number,
): BidPrintSummary {
  const isGridMode = boq.boqType === 'item_rate' || boq.boqType === 'lump_sum_epc';
  const modeLabel = boq.boqType === 'lump_sum_epc' ? 'Lump Sum / Package' : 'Item Rate';

  const aiEstimatedValue = extractBidRecommendationEstimatedValue(analysisResult);
  const rateContractHint = boq.boqType === 'percentage_rate'
    ? buildRateContractHint(
        extractAnalysisText(analysisResult),
        boq.estimatedAmount,
        aiEstimatedValue,
        false, // nominalQuantitiesSignal — BOQViewer-only signal, unavailable here; only affects hint prominence, never the resolved revenue figure once isRateContract is explicitly set
      )
    : { signals: [], reasons: [] };

  const canCompute = isGridMode
    ? boq.quotedAmount != null && boq.estimatedAmount != null
    : (boq.estimatedAmountConfirmed && boq.estimatedAmount != null && boq.percentage != null);

  const quotedAmount = isGridMode
    ? boq.quotedAmount
    : (canCompute ? netBidAmount(boq.estimatedAmount!, boq.percentage!, boq.aboveBelow) : null);

  const words = quotedAmount != null ? toIndianWords(quotedAmount) : null;

  const rateContractRevenue = resolveRateContractRevenue(
    boq.isRateContract, boq.expectedContractValue, rateContractHint.signals.length, quotedAmount,
  );

  const expectedRevenue = resolveExpectedRevenueConfirmation(
    rateContractRevenue, boq.expectedRevenueConfirmed ?? false, boq.expectedRevenueConfirmedValue,
  );

  const metrics = expectedRevenue.revenue != null && totalCost > 0
    ? calcProfit(expectedRevenue.revenue, totalCost)
    : null;

  const derivedPercentage = isGridMode && quotedAmount != null && boq.estimatedAmount
    ? Math.abs((quotedAmount - boq.estimatedAmount) / boq.estimatedAmount) * 100
    : boq.percentage;
  const derivedAboveBelow: 'above' | 'below' = isGridMode && quotedAmount != null && boq.estimatedAmount != null
    ? (quotedAmount >= boq.estimatedAmount ? 'above' : 'below')
    : boq.aboveBelow;

  const warnings = expectedRevenue.revenue != null && derivedPercentage != null
    ? getBidWarnings(expectedRevenue.revenue, totalCost, derivedPercentage, metrics ?? {
        grossProfit: 0, profitPercent: 0, marginPercent: 0,
      })
    : null;

  const gstIncluded = boq.gstIncluded ?? 'unknown';
  const gstMode = resolveGstCalculationMode(gstIncluded, boq.gstPercent);
  const cessGst = !gstMode.gated && quotedAmount != null
    ? applyCessAndGst(quotedAmount, boq.cessPercent ?? 0, gstMode.effectiveGstPercent)
    : null;

  return {
    isGridMode, modeLabel, aiEstimatedValue, quotedAmount, words,
    derivedPercentage, derivedAboveBelow, expectedRevenue, metrics, warnings,
    gstIncluded, cessGst,
  };
}
