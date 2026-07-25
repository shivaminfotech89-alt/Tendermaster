import { describe, test, expect } from 'vitest';
import { detectBidValidity, detectCompletionPeriod } from './detectTenderValidity';

describe('detectBidValidity', () => {
  test('"Bid Validity: 180 Days" -> high confidence, 180 days', () => {
    const r = detectBidValidity('Clause 12: Bid Validity: 180 Days from the date of opening of the bid.');
    expect(r.days).toBe(180);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('"Tender Validity" phrasing also matches', () => {
    const r = detectBidValidity('Tender Validity shall be 90 days from the last date of submission.');
    expect(r.days).toBe(90);
  });

  test('does NOT match Completion Period phrasing (the two concepts stay separate)', () => {
    const r = detectBidValidity('Period of Completion: 12 Months.');
    expect(r.days).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });

  test('no signal -> undefined days, low confidence, never guesses', () => {
    const r = detectBidValidity('This tender is for construction of a community hall.');
    expect(r.days).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });

  test('empty text -> undefined days, low confidence', () => {
    const r = detectBidValidity('');
    expect(r.days).toBeUndefined();
  });
});

describe('detectCompletionPeriod', () => {
  test('the real-world regression case: "Period of Completion: 12 Months" -> 360 days', () => {
    const r = detectCompletionPeriod('Special Conditions: Period of Completion: 12 Months from the date of work order.');
    expect(r.days).toBe(360);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('"Completion Period" (the other word order) also matches', () => {
    const r = detectCompletionPeriod('Completion Period: 45 days.');
    expect(r.days).toBe(45);
  });

  test('"Contract Period of 6 months" -> converts months to days', () => {
    const r = detectCompletionPeriod('The Contract Period of 6 months shall commence from the date of work order.');
    expect(r.days).toBe(180);
  });

  test('"Time for Completion — 1 Year" -> converts years to days', () => {
    const r = detectCompletionPeriod('Time for Completion : 1 Year from the date of commencement.');
    expect(r.days).toBe(365);
  });

  test('does NOT match Bid Validity phrasing (the two concepts stay separate)', () => {
    const r = detectCompletionPeriod('Bid Validity: 180 Days.');
    expect(r.days).toBeUndefined();
  });

  test('no raw-text signal, falls back to AI execution_duration text at lower confidence', () => {
    const r = detectCompletionPeriod('This tender is for construction of a community hall.', '6 months');
    expect(r.days).toBe(180);
    expect(r.confidence).toBeGreaterThanOrEqual(50);
    expect(r.confidence).toBeLessThan(90);
  });

  test('raw text signal takes priority over the AI fallback when both are present', () => {
    const r = detectCompletionPeriod('Period of Completion: 12 Months.', '6 months');
    expect(r.days).toBe(360);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('no signal anywhere -> undefined days, low confidence, never guesses', () => {
    const r = detectCompletionPeriod('This tender is for construction of a community hall.');
    expect(r.days).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });
});

describe('both Bid Validity and Completion Period present in the same document', () => {
  const text = 'Bid Validity: 180 Days. Period of Completion: 12 Months from the date of work order.';

  test('detectBidValidity picks up only the Bid Validity figure', () => {
    expect(detectBidValidity(text).days).toBe(180);
  });

  test('detectCompletionPeriod picks up only the Completion Period figure', () => {
    expect(detectCompletionPeriod(text).days).toBe(360);
  });
});
