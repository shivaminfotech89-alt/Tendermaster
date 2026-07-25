import { describe, test, expect } from 'vitest';
import type { BoqItem } from '../../types/boq';
import {
  detectTitleMention, detectValueRatio, detectNominalQuantities, buildRateContractHint,
  resolveRateContractRevenue, detectMisenteredScheduleAmount, pickScheduleMatchingCandidateIndex,
  resolveExpectedRevenueConfirmation, preferExactScheduleSum,
} from './detectRateContract';

function item(quantity: number): BoqItem {
  return { id: 'id-' + Math.random(), itemNo: '1', description: 'x', unit: 'Nos', quantity };
}

describe('detectTitleMention', () => {
  test('matches "Annual Rate Contract"', () => {
    expect(detectTitleMention('This is an Annual Rate Contract for road works.')).toBe(true);
  });
  test('matches bare "Rate Contract"', () => {
    expect(detectTitleMention('A rate contract for supply of materials.')).toBe(true);
  });
  test('does not match unrelated text', () => {
    expect(detectTitleMention('This tender is for construction of a bridge.')).toBe(false);
  });
  test('empty text', () => {
    expect(detectTitleMention('')).toBe(false);
  });
});

describe('detectValueRatio', () => {
  test('flags when AI value is far larger than schedule sum (Bareja-shaped: ~52x)', () => {
    expect(detectValueRatio(48265.33, 2500000)).toBe(true);
  });
  test('does not flag a normal ratio', () => {
    expect(detectValueRatio(1000000, 1050000)).toBe(false);
  });
  test('does not flag when schedule amount is missing', () => {
    expect(detectValueRatio(null, 2500000)).toBe(false);
  });
  test('does not flag when AI value is missing', () => {
    expect(detectValueRatio(48265.33, undefined)).toBe(false);
  });
  test('does not flag zero/negative schedule amount', () => {
    expect(detectValueRatio(0, 2500000)).toBe(false);
  });
});

describe('detectNominalQuantities', () => {
  test('flags when all quantities are 1 (Bareja-shaped)', () => {
    const items = Array.from({ length: 41 }, () => item(1));
    expect(detectNominalQuantities(items)).toBe(true);
  });
  test('does not flag varied real quantities (Schedule-B-shaped)', () => {
    const items = [item(2), item(2), item(4), item(4), item(5)];
    expect(detectNominalQuantities(items)).toBe(false);
  });
  test('does not flag when too few items', () => {
    expect(detectNominalQuantities([item(1), item(1)])).toBe(false);
  });
  test('flags at exactly the 80% threshold', () => {
    const items = [...Array.from({ length: 8 }, () => item(1)), item(2), item(3)];
    expect(detectNominalQuantities(items)).toBe(true);
  });
  test('does not flag just under the threshold', () => {
    const items = [...Array.from({ length: 7 }, () => item(1)), item(2), item(3), item(4)];
    expect(detectNominalQuantities(items)).toBe(false);
  });
});

describe('buildRateContractHint', () => {
  test('zero signals for an ordinary percentage-rate tender', () => {
    const hint = buildRateContractHint('Construction of a new bridge over the river.', 1000000, 1050000, false);
    expect(hint.signals).toEqual([]);
    expect(hint.reasons).toEqual([]);
  });

  test('Bareja-shaped data trips all three signals', () => {
    const hint = buildRateContractHint(
      'This is an Annual Rate Contract for road maintenance work.',
      48265.33,
      2500000,
      true,
    );
    expect(hint.signals).toEqual(['title_mentions_rate_contract', 'value_ratio', 'nominal_quantities']);
    expect(hint.reasons).toHaveLength(3);
  });

  test('one signal only', () => {
    const hint = buildRateContractHint('Construction of a new bridge.', 1000000, 1050000, true);
    expect(hint.signals).toEqual(['nominal_quantities']);
  });
});

describe('resolveRateContractRevenue', () => {
  test('zero signals, undetermined: byte-identical fallback (majority case, must not regress)', () => {
    const r = resolveRateContractRevenue(undefined, undefined, 0, 47300);
    expect(r.gated).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.revenue).toBe(47300);
  });

  test('one signal, undetermined: still ungated (only 2+ signals gate)', () => {
    const r = resolveRateContractRevenue(undefined, undefined, 1, 47300);
    expect(r.gated).toBe(false);
    expect(r.revenue).toBe(47300);
  });

  test('two or more signals, undetermined: gated, no revenue, no default in either direction', () => {
    const r = resolveRateContractRevenue(undefined, undefined, 2, 47300);
    expect(r.gated).toBe(true);
    expect(r.revenue).toBeNull();
    expect(r.reason).toMatch(/Confirm Rate Contract status/);
  });

  test('confirmed NOT a rate contract (isRateContract=false): ungated regardless of signal count', () => {
    const r = resolveRateContractRevenue(false, undefined, 3, 47300);
    expect(r.gated).toBe(false);
    expect(r.revenue).toBe(47300);
  });

  test('confirmed rate contract, no expected value yet: gated', () => {
    const r = resolveRateContractRevenue(true, undefined, 3, 47300);
    expect(r.gated).toBe(true);
    expect(r.revenue).toBeNull();
    expect(r.reason).toMatch(/Enter Expected Contract Value/);
  });

  test('confirmed rate contract, zero/negative expected value: still gated', () => {
    expect(resolveRateContractRevenue(true, 0, 3, 47300).gated).toBe(true);
    expect(resolveRateContractRevenue(true, -5, 3, 47300).gated).toBe(true);
  });

  test('confirmed rate contract with an expected value: uses the bidder-entered figure, not the schedule sum', () => {
    const r = resolveRateContractRevenue(true, 1800000, 3, 47300);
    expect(r.gated).toBe(false);
    expect(r.revenue).toBe(1800000);
    expect(r.reason).toBeNull();
  });
});

describe('detectMisenteredScheduleAmount', () => {
  test('flags entering the Tender Value where Schedule-B Amount belongs (Bareja-shaped)', () => {
    // typed ~2,500,000 (close to the AI tender value), real schedule sum is ~48,265
    expect(detectMisenteredScheduleAmount(2500000, 2500000, 48265.33)).toBe(true);
  });

  test('does not flag a value close to the real schedule sum', () => {
    expect(detectMisenteredScheduleAmount(48265.33, 2500000, 48265.33)).toBe(false);
  });

  test('does not flag when entered value is far from the tender value too', () => {
    expect(detectMisenteredScheduleAmount(100000, 2500000, 48265.33)).toBe(false);
  });

  test('does not flag when no AI tender value exists to compare against', () => {
    expect(detectMisenteredScheduleAmount(2500000, null, 48265.33)).toBe(false);
  });

  test('does not flag when the actual schedule sum is unavailable (nothing to compare against)', () => {
    expect(detectMisenteredScheduleAmount(2500000, 2500000, null)).toBe(false);
  });

  test('does not flag a normal, non-ARC percentage-rate tender (schedule sum close to tender value)', () => {
    expect(detectMisenteredScheduleAmount(1050000, 1050000, 1000000)).toBe(false);
  });
});

describe('pickScheduleMatchingCandidateIndex', () => {
  test('Bareja-shaped: prefers the schedule-matching candidate over the AI-suggested tender-value one', () => {
    // candidates: [0] "Estimated Schedule B Unit Rate Sum" ~48265, [1] "Approximate Overall Project Budget" 2500000
    // AI suggested index 1 (wrong) — the real schedule sum (48265.33) should override it to index 0.
    const idx = pickScheduleMatchingCandidateIndex([48265, 2500000], 48265.33, 1);
    expect(idx).toBe(0);
  });

  test('falls back to the AI-suggested index when the real schedule sum is not yet known', () => {
    const idx = pickScheduleMatchingCandidateIndex([48265, 2500000], null, 1);
    expect(idx).toBe(1);
  });

  test('falls back to the AI-suggested index when there are no candidates', () => {
    expect(pickScheduleMatchingCandidateIndex([], 48265.33, 0)).toBe(0);
  });

  test('single candidate that already matches the schedule sum stays selected', () => {
    expect(pickScheduleMatchingCandidateIndex([48265.33], 48265.33, 0)).toBe(0);
  });

  test('skips candidates with no usable value', () => {
    const idx = pickScheduleMatchingCandidateIndex([undefined, 48265.33, 2500000], 48265.33, 0);
    expect(idx).toBe(1);
  });

  test('does not override when the AI-suggested candidate is already the closest match', () => {
    const idx = pickScheduleMatchingCandidateIndex([48265.33, 2500000], 48265.33, 0);
    expect(idx).toBe(0);
  });
});

describe('resolveExpectedRevenueConfirmation', () => {
  test('Rate Contract gated (status undetermined, 2+ signals): passes through unchanged, reason and all', () => {
    const rcr = resolveRateContractRevenue(undefined, undefined, 2, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, false, null);
    expect(r.gated).toBe(true);
    expect(r.reason).toMatch(/Confirm Rate Contract status/);
    expect(r.revenue).toBeNull();
  });

  test('Rate Contract gated (confirmed true, no Expected Contract Value yet): passes through unchanged', () => {
    const rcr = resolveRateContractRevenue(true, undefined, 3, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, false, null);
    expect(r.gated).toBe(true);
    expect(r.reason).toMatch(/Enter Expected Contract Value/);
    expect(r.revenue).toBeNull();
  });

  test('Rate Contract ungated (value entered) but not yet confirmed here: gated with the new reason', () => {
    const rcr = resolveRateContractRevenue(true, 1800000, 3, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, false, null);
    expect(r.gated).toBe(true);
    expect(r.reason).toBe('Confirm Expected Revenue below to see margin');
    expect(r.revenue).toBeNull();
  });

  test('Rate Contract ungated and confirmed with the matching value: ungated, revenue passes through', () => {
    const rcr = resolveRateContractRevenue(true, 1800000, 3, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, true, 1800000);
    expect(r.gated).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.revenue).toBe(1800000);
  });

  test('majority case (not a Rate Contract), unconfirmed: NEW gate — previously silently ungated, now blocked', () => {
    const rcr = resolveRateContractRevenue(false, undefined, 0, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, false, null);
    expect(r.gated).toBe(true);
    expect(r.reason).toBe('Confirm Expected Revenue below to see margin');
    expect(r.revenue).toBeNull();
  });

  test('majority case, confirmed with the matching value: ungated', () => {
    const rcr = resolveRateContractRevenue(false, undefined, 0, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, true, 47300);
    expect(r.gated).toBe(false);
    expect(r.revenue).toBe(47300);
  });

  test('confirmed then the underlying revenue drifts (e.g. bid % edited): gate reopens automatically', () => {
    const rcr = resolveRateContractRevenue(false, undefined, 0, 52000); // fallbackRevenue changed since confirmation
    const r = resolveExpectedRevenueConfirmation(rcr, true, 47300); // stale confirmedValue
    expect(r.gated).toBe(true);
    expect(r.reason).toBe('Confirm Expected Revenue below to see margin');
    expect(r.revenue).toBeNull();
  });

  test('undetermined with <2 signals (ordinary tender, ungated by resolveRateContractRevenue), unconfirmed: still gated here', () => {
    const rcr = resolveRateContractRevenue(undefined, undefined, 1, 47300);
    const r = resolveExpectedRevenueConfirmation(rcr, false, null);
    expect(r.gated).toBe(true);
    expect(r.revenue).toBeNull();
  });
});

describe('preferExactScheduleSum', () => {
  test('Bareja-shaped regression: AI-rounded candidate (48266) within tolerance of the exact scheduleSum (48265.33) -> uses the exact figure', () => {
    expect(preferExactScheduleSum(48266, 48265.33)).toBe(48265.33);
  });

  test('candidate already exactly matches scheduleSum -> unchanged (no-op substitution)', () => {
    expect(preferExactScheduleSum(48265.33, 48265.33)).toBe(48265.33);
  });

  test('candidate is a genuinely different, unrelated figure (no schedule-shaped candidate exists) -> left untouched, not silently replaced', () => {
    expect(preferExactScheduleSum(2500000, 48265.33)).toBe(2500000);
  });

  test('no scheduleSum known yet (extraction not complete) -> candidate value used as-is', () => {
    expect(preferExactScheduleSum(48266, null)).toBe(48266);
    expect(preferExactScheduleSum(48266, undefined)).toBe(48266);
  });

  test('no candidate value at all -> falls back to scheduleSum if known', () => {
    expect(preferExactScheduleSum(null, 48265.33)).toBe(48265.33);
    expect(preferExactScheduleSum(undefined, 48265.33)).toBe(48265.33);
  });

  test('no candidate and no scheduleSum -> null/undefined passes through', () => {
    expect(preferExactScheduleSum(null, null)).toBeNull();
    expect(preferExactScheduleSum(undefined, undefined)).toBeUndefined();
  });

  test('zero/negative scheduleSum treated as unknown -> candidate value used as-is', () => {
    expect(preferExactScheduleSum(48266, 0)).toBe(48266);
    expect(preferExactScheduleSum(48266, -5)).toBe(48266);
  });

  test('just outside the 0.5% tolerance -> candidate value left untouched', () => {
    // 48265.33 * 0.5% = ~241.33 -> a diff of 300 should NOT be substituted
    expect(preferExactScheduleSum(48565.33, 48265.33)).toBe(48565.33);
  });

  test('just inside the 0.5% tolerance -> substituted', () => {
    // diff of 200 is within ~241.33 tolerance
    expect(preferExactScheduleSum(48465.33, 48265.33)).toBe(48265.33);
  });
});
