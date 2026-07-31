import { describe, test, expect } from 'vitest';
import {
  isEligibleBoqCandidate, isBetterBoqCandidate, isIdenticalToExisting,
  hasUserBidWork, decideBoqReplacement, type BoqCandidateSummary,
} from './boqReplacementGate';
import type { BOQData } from './types';

function candidate(overrides: Partial<BoqCandidateSummary> = {}): BoqCandidateSummary {
  return { itemCount: 10, totalAmount: 500000, verificationScore: 80, verificationPass: true, ...overrides };
}

function baseBoq(overrides: Partial<BOQData> = {}): BOQData {
  return {
    boqType: 'item_rate',
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
    ...overrides,
  };
}

describe('isEligibleBoqCandidate', () => {
  test('rejects zero items', () => {
    expect(isEligibleBoqCandidate(candidate({ itemCount: 0 }))).toBe(false);
  });
  test('rejects too few items even if verification passed', () => {
    expect(isEligibleBoqCandidate(candidate({ itemCount: 2, verificationPass: true }))).toBe(false);
  });
  test('rejects failed verification even with many items', () => {
    expect(isEligibleBoqCandidate(candidate({ itemCount: 20, verificationPass: false }))).toBe(false);
  });
  test('accepts a real, verified candidate with totalAmount 0 (blank-rate SOR)', () => {
    expect(isEligibleBoqCandidate(candidate({ itemCount: 10, totalAmount: 0, verificationPass: true }))).toBe(true);
  });
});

describe('isBetterBoqCandidate — never compares totalAmount', () => {
  test('higher verification score wins regardless of totalAmount', () => {
    const weak = candidate({ verificationScore: 60, totalAmount: 5000000, itemCount: 3 });
    const strong = candidate({ verificationScore: 95, totalAmount: 0, itemCount: 10 });
    expect(isBetterBoqCandidate(strong, weak)).toBe(true);
    expect(isBetterBoqCandidate(weak, strong)).toBe(false);
  });
  test('tie on score falls back to item count', () => {
    const a = candidate({ verificationScore: 80, itemCount: 5 });
    const b = candidate({ verificationScore: 80, itemCount: 10 });
    expect(isBetterBoqCandidate(b, a)).toBe(true);
  });
  test('tie on score and item count falls back to overall confidence', () => {
    const a = candidate({ verificationScore: 80, itemCount: 10, overallConfidence: 50 });
    const b = candidate({ verificationScore: 80, itemCount: 10, overallConfidence: 90 });
    expect(isBetterBoqCandidate(b, a)).toBe(true);
  });
});

describe('isIdenticalToExisting', () => {
  test('true on exact item count + total match', () => {
    expect(isIdenticalToExisting(candidate({ itemCount: 10, totalAmount: 500000 }), { status: 'done', itemCount: 10, totalAmount: 500000 })).toBe(true);
  });
  test('false on any difference', () => {
    expect(isIdenticalToExisting(candidate({ itemCount: 10, totalAmount: 500000 }), { status: 'done', itemCount: 9, totalAmount: 500000 })).toBe(false);
    expect(isIdenticalToExisting(candidate({ itemCount: 10, totalAmount: 500000 }), { status: 'done', itemCount: 10, totalAmount: 500001 })).toBe(false);
  });
});

describe('hasUserBidWork', () => {
  test('false for a fresh, untouched boq', () => {
    expect(hasUserBidWork(baseBoq())).toBe(false);
  });
  test('false for null/undefined', () => {
    expect(hasUserBidWork(null)).toBe(false);
    expect(hasUserBidWork(undefined)).toBe(false);
  });
  test('true once estimatedAmountConfirmed', () => {
    expect(hasUserBidWork(baseBoq({ estimatedAmountConfirmed: true }))).toBe(true);
  });
  test('true once a grid-mode quotedAmount exists (priced via the pricing grid)', () => {
    expect(hasUserBidWork(baseBoq({ quotedAmount: 117098600 }))).toBe(true);
  });
  test('true once percentage is set', () => {
    expect(hasUserBidWork(baseBoq({ percentage: 5 }))).toBe(true);
  });
  test('true once finalised', () => {
    expect(hasUserBidWork(baseBoq({ finalisedAt: Date.now() }))).toBe(true);
  });
  test('true once GST treatment is resolved (not unknown)', () => {
    expect(hasUserBidWork(baseBoq({ gstIncluded: 'separate' }))).toBe(true);
    expect(hasUserBidWork(baseBoq({ gstIncluded: 'unknown' }))).toBe(false);
  });
  test('true once any manualOverride flag is set', () => {
    expect(hasUserBidWork(baseBoq({ manualOverride: { gstIncluded: true } }))).toBe(true);
  });
});

describe('decideBoqReplacement — the full decision matrix', () => {
  test('empty/ineligible candidate never overwrites, never becomes pending — always discard', () => {
    const empty = candidate({ itemCount: 0, totalAmount: 0 });
    expect(decideBoqReplacement(empty, { status: 'done', itemCount: 10, totalAmount: 500000 }, baseBoq({ quotedAmount: 500000 }))).toBe('discard');
    expect(decideBoqReplacement(empty, null, baseBoq())).toBe('discard');
    expect(decideBoqReplacement(empty, { status: 'no_boq_found' }, baseBoq())).toBe('discard');
  });

  test('nothing real currently active → apply directly, regardless of user work', () => {
    const real = candidate({ itemCount: 10 });
    expect(decideBoqReplacement(real, null, baseBoq({ quotedAmount: 1 }))).toBe('apply');
    expect(decideBoqReplacement(real, { status: 'no_boq_found' }, baseBoq())).toBe('apply');
    expect(decideBoqReplacement(real, { status: 'done', itemCount: 0 }, baseBoq())).toBe('apply');
  });

  test('identical to active → discard as a no-op, even with user work present', () => {
    const same = candidate({ itemCount: 10, totalAmount: 500000 });
    const existing = { status: 'done', itemCount: 10, totalAmount: 500000 };
    expect(decideBoqReplacement(same, existing, baseBoq({ quotedAmount: 500000 }))).toBe('discard');
  });

  test('different + eligible + NO user bid work yet → apply directly (nothing to lose)', () => {
    const revised = candidate({ itemCount: 12, totalAmount: 600000 });
    const existing = { status: 'done', itemCount: 10, totalAmount: 500000 };
    expect(decideBoqReplacement(revised, existing, baseBoq())).toBe('apply');
  });

  test('THE CORE CASE — different + eligible + user has priced the active BOQ → pending, never silently applied', () => {
    const revised = candidate({ itemCount: 12, totalAmount: 600000 });
    const existing = { status: 'done', itemCount: 10, totalAmount: 500000 };
    const pricedBoq = baseBoq({ quotedAmount: 1170_98_600, estimatedAmountConfirmed: true });
    expect(decideBoqReplacement(revised, existing, pricedBoq)).toBe('pending');
  });

  test('a WEAKER candidate arriving while the user has priced the active BOQ is still only "pending", never silently discarded as unimportant — the caller decides, this function never applies it', () => {
    // decideBoqReplacement doesn't rank "better" for the pending case at all —
    // any eligible, non-identical candidate is offered for review when work is at risk.
    const weaker = candidate({ itemCount: 3, totalAmount: 100 });
    const existing = { status: 'done', itemCount: 10, totalAmount: 500000 };
    const pricedBoq = baseBoq({ quotedAmount: 500000 });
    expect(decideBoqReplacement(weaker, existing, pricedBoq)).toBe('pending');
  });
});
