import { describe, test, expect } from 'vitest';
import { computeBidPrintSummary } from './printSummary';
import type { BOQData } from './types';

function baseBoq(overrides: Partial<BOQData> = {}): BOQData {
  return {
    boqType: 'percentage_rate',
    estimatedAmount: 100000,
    estimatedAmountConfirmed: true,
    estimatedAmountEdited: false,
    aboveBelow: 'above',
    percentage: 5,
    quotedAmount: null,
    quotedAmountWords: null,
    remarks: '',
    totalCost: null,
    grossProfit: null,
    profitPercent: null,
    marginPercent: null,
    ...overrides,
  };
}

describe('computeBidPrintSummary', () => {
  test('percentage-rate, GST separate, revenue confirmed — matches BOQSection math', () => {
    const boq = baseBoq({
      gstIncluded: 'separate',
      gstPercent: 18,
      cessPercent: 1,
      manualOverride: { gstIncluded: true },
      expectedRevenueConfirmed: true,
      expectedRevenueConfirmedValue: 105000, // netBidAmount(100000, 5, 'above')
    });
    const result = computeBidPrintSummary(boq, {}, 60000);

    expect(result.quotedAmount).toBe(105000);
    expect(result.derivedAboveBelow).toBe('above');
    expect(result.derivedPercentage).toBe(5);
    expect(result.expectedRevenue.gated).toBe(false);
    expect(result.expectedRevenue.revenue).toBe(105000);
    expect(result.metrics?.grossProfit).toBe(45000);
    expect(result.cessGst).not.toBeNull();
    expect(result.cessGst!.cessAmount).toBeCloseTo(1050, 5); // 1% of 105000
    expect(result.cessGst!.gstAmount).toBeCloseTo((105000 + 1050) * 0.18, 5);
    expect(result.warnings?.level).toBe('ok');
  });

  test('estimatedAmount not yet confirmed — quotedAmount and revenue stay null (not zero)', () => {
    const boq = baseBoq({ estimatedAmountConfirmed: false });
    const result = computeBidPrintSummary(boq, {}, 0);

    expect(result.quotedAmount).toBeNull();
    expect(result.words).toBeNull();
    expect(result.expectedRevenue.gated).toBe(true);
    expect(result.expectedRevenue.revenue).toBeNull();
    expect(result.cessGst).toBeNull();
  });

  test('item-rate grid mode reads quotedAmount directly, derives above/below', () => {
    const boq = baseBoq({
      boqType: 'item_rate',
      quotedAmount: 92000,
      expectedRevenueConfirmed: true,
      expectedRevenueConfirmedValue: 92000,
    });
    const result = computeBidPrintSummary(boq, {}, 80000);

    expect(result.isGridMode).toBe(true);
    expect(result.quotedAmount).toBe(92000);
    expect(result.derivedAboveBelow).toBe('below'); // 92000 < 100000 estimatedAmount
    expect(result.expectedRevenue.revenue).toBe(92000);
  });

  test('confirmed Rate Contract with no Expected Contract Value — gated, no schedule-derived fallback', () => {
    const boq = baseBoq({
      isRateContract: true,
      expectedContractValue: null,
      estimatedAmountConfirmed: true,
    });
    const result = computeBidPrintSummary(boq, {}, 10000);

    expect(result.quotedAmount).toBe(105000); // schedule-derived quote still computable
    expect(result.expectedRevenue.gated).toBe(true); // but revenue/margin stays gated
    expect(result.expectedRevenue.revenue).toBeNull();
    expect(result.metrics).toBeNull();
  });

  test('gstIncluded unknown — cessGst stays null, never guesses a rate', () => {
    const boq = baseBoq({
      gstIncluded: 'unknown',
      expectedRevenueConfirmed: true,
      expectedRevenueConfirmedValue: 105000,
    });
    const result = computeBidPrintSummary(boq, {}, 50000);

    expect(result.cessGst).toBeNull();
    expect(result.gstIncluded).toBe('unknown');
  });
});
