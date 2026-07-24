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
    expect(patch.tenderValidityConfirmed).toBe(true);
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
    expect(patch.tenderValidityConfirmed).toBe(true);
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

  test('legacy project already re-gated by an explicit user change (tenderValidityConfirmed already false, not undefined): not re-grandfathered', () => {
    const boq = {
      ...INITIAL_BOQ,
      finalisedAt: { seconds: 123 },
      tenderValidityConfirmed: false,
      totalCost: 500000,
      quotedAmount: 950000,
    };
    const patch = inferLegacyConfirmations(boq);
    expect(patch.tenderValidityConfirmed).toBeUndefined();
  });
});
