import { describe, test, expect } from 'vitest';
import { detectTenderValidity } from './detectTenderValidity';

describe('detectTenderValidity', () => {
  test('structured "Bid Validity: 180 Days" -> high confidence, 180 days', () => {
    const r = detectTenderValidity('Clause 12: Bid Validity: 180 Days from the date of opening of the bid.');
    expect(r.days).toBe(180);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('"Contract Period of 6 months" -> converts months to days', () => {
    const r = detectTenderValidity('The Contract Period of 6 months shall commence from the date of work order.');
    expect(r.days).toBe(180);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('"Time for Completion — 1 Year" -> converts years to days', () => {
    const r = detectTenderValidity('Time for Completion : 1 Year from the date of commencement.');
    expect(r.days).toBe(365);
  });

  test('"Tender Validity" phrasing also matches', () => {
    const r = detectTenderValidity('Tender Validity shall be 90 days from the last date of submission.');
    expect(r.days).toBe(90);
  });

  test('"Completion Period" phrasing also matches', () => {
    const r = detectTenderValidity('Completion Period: 45 days.');
    expect(r.days).toBe(45);
  });

  test('no raw-text signal, falls back to AI execution_duration text at lower confidence', () => {
    const r = detectTenderValidity('This tender is for construction of a community hall.', '6 months');
    expect(r.days).toBe(180);
    expect(r.confidence).toBeGreaterThanOrEqual(50);
    expect(r.confidence).toBeLessThan(90);
  });

  test('raw text signal takes priority over the AI fallback when both are present', () => {
    const r = detectTenderValidity('Bid Validity: 120 Days.', '6 months');
    expect(r.days).toBe(120);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('no signal anywhere -> undefined days, low confidence, never guesses', () => {
    const r = detectTenderValidity('This tender is for construction of a community hall.');
    expect(r.days).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });

  test('empty text and no fallback -> undefined days, low confidence', () => {
    const r = detectTenderValidity('');
    expect(r.days).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });
});
