import { describe, test, expect } from 'vitest';
import { inferLegacyConfirmations } from './confirmationMigration';
import { INITIAL_BOQ } from './types';

describe('inferLegacyConfirmations', () => {
  test('brand-new project (no finalisedAt, no computed metrics): untouched, goes through the full new flow', () => {
    const patch = inferLegacyConfirmations({ ...INITIAL_BOQ });
    expect(patch).toEqual({});
  });

  test('already-finalized project: grandfathers in all four gates at once', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      gstIncluded: 'separate' as const,
      totalCost: 500000,
      quotedAmount: 950000,
      isRateContract: false,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.manualOverride?.gstIncluded).toBe(true);
    expect(patch.estimatedCostConfirmedValue).toBe(500000);
    expect(patch.completionPeriodConfirmed).toBe(true);
    expect(patch.expectedRevenueConfirmed).toBe(true);
    expect(patch.expectedRevenueConfirmedValue).toBe(950000);
  });

  test('actively-priced-but-not-yet-finalized project (grossProfit and quotedAmount both already computed): also grandfathered', () => {
    const boq = {
      ...INITIAL_BOQ,
      grossProfit: 120000,
      quotedAmount: 950000,
      totalCost: 500000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.estimatedCostConfirmedValue).toBe(500000);
    expect(patch.completionPeriodConfirmed).toBe(true);
    expect(patch.expectedRevenueConfirmed).toBe(true);
  });

  test('mid-flow new project (quotedAmount set but no grossProfit/finalisedAt yet): not legacy, untouched', () => {
    const boq = { ...INITIAL_BOQ, quotedAmount: 950000 };
    const patch = inferLegacyConfirmations(boq);
    expect(patch).toEqual({});
  });

  test('legacy Rate Contract project: expectedRevenueConfirmedValue comes from expectedContractValue, not quotedAmount', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      isRateContract: true,
      expectedContractValue: 1800000,
      quotedAmount: 47300, // schedule-derived, must NOT be used as the legacy revenue here
      totalCost: 500000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.expectedRevenueConfirmedValue).toBe(1800000);
  });

  test('legacy Rate Contract project with no expectedContractValue on record: leaves Expected Revenue ungrandfathered (nothing safe to infer)', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      isRateContract: true,
      expectedContractValue: null,
      quotedAmount: 47300,
      totalCost: 500000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.expectedRevenueConfirmed).toBeUndefined();
  });

  test('legacy project whose gstIncluded is already manually overridden: does not touch manualOverride again', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      gstIncluded: 'yes' as const,
      manualOverride: { gstIncluded: true as const },
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.manualOverride).toBeUndefined();
  });

  test('legacy project with gstIncluded unknown: does not fabricate a confirmation for it', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      gstIncluded: 'unknown' as const,
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.manualOverride).toBeUndefined();
  });

  test('legacy project already re-gated on the NEW field (completionPeriodConfirmed already false, not undefined): not re-grandfathered', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      completionPeriodConfirmed: false,
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.completionPeriodConfirmed).toBeUndefined();
  });

  test('legacy field rename: old tenderValidityDays/tenderValidityConfirmed (pre-split, still in Firestore) map onto completionPeriodDays/completionPeriodConfirmed', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      totalCost: 500000,
      quotedAmount: 950000,
      tenderValidityDays: 360,
      tenderValidityConfirmed: true,
    } as any;
    const patch = inferLegacyConfirmations(boq);
    expect(patch.completionPeriodDays).toBe(360);
    expect(patch.completionPeriodConfirmed).toBe(true);
  });

  test('legacy field rename: old field present but never confirmed (mid-flow) -> preserved as unconfirmed, not silently grandfathered to true', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      totalCost: 500000,
      quotedAmount: 950000,
      tenderValidityDays: 360,
      tenderValidityConfirmed: false,
    } as any;
    const patch = inferLegacyConfirmations(boq);
    expect(patch.completionPeriodDays).toBe(360);
    expect(patch.completionPeriodConfirmed).toBe(false);
  });

  test('legacy project with no old field at all: falls through to the plain grandfather-in-as-confirmed rule', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.completionPeriodDays).toBeUndefined();
    expect(patch.completionPeriodConfirmed).toBe(true);
  });

  test('Bid Validity is never grandfathered — new, non-blocking split with no old equivalent', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.bidValidityConfirmed).toBeUndefined();
  });
});
