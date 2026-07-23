import { describe, test, expect } from 'vitest';
import { INITIAL_BOQ, type BOQData } from './types';
import { deriveBidStatus } from './boqReviewStatus';

function boq(overrides: Partial<BOQData> = {}): BOQData {
  return { ...INITIAL_BOQ, ...overrides };
}

describe('deriveBidStatus', () => {
  test('undefined boq → not_started', () => {
    expect(deriveBidStatus(undefined, false, 0, 0).status).toBe('not_started');
  });

  test('finalisedAt set → locked, regardless of mode', () => {
    const b = boq({ finalisedAt: {} as any, quotedAmount: 1000 });
    expect(deriveBidStatus(b, false, 0, 0).status).toBe('locked');
    expect(deriveBidStatus(b, true, 5, 5).status).toBe('locked');
  });

  describe('percentage-rate (isGridMode = false)', () => {
    test('nothing entered → not_started', () => {
      expect(deriveBidStatus(boq(), false, 0, 0).status).toBe('not_started');
    });

    test('estimated amount confirmed, no percentage yet → in_progress', () => {
      const b = boq({ estimatedAmountConfirmed: true, estimatedAmount: 100000 });
      expect(deriveBidStatus(b, false, 0, 0).status).toBe('in_progress');
    });

    test('quotedAmount computed → completed', () => {
      const b = boq({ estimatedAmountConfirmed: true, estimatedAmount: 100000, percentage: 5, quotedAmount: 105000 });
      expect(deriveBidStatus(b, false, 0, 0).status).toBe('completed');
    });
  });

  describe('grid mode (item-rate / lump-sum)', () => {
    test('no rows priced → not_started, even if quotedAmount somehow set', () => {
      const b = boq({ quotedAmount: 0 });
      expect(deriveBidStatus(b, true, 0, 10).status).toBe('not_started');
    });

    test('some rows priced, not all → in_progress (not misreported as completed)', () => {
      const b = boq({ estimatedAmount: 50000, quotedAmount: 8000 });
      expect(deriveBidStatus(b, true, 1, 50).status).toBe('in_progress');
    });

    test('all rows priced → completed', () => {
      const b = boq({ estimatedAmount: 50000, quotedAmount: 52000 });
      expect(deriveBidStatus(b, true, 5, 5).status).toBe('completed');
    });
  });
});
