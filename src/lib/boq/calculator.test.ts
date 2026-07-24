import { describe, test, expect } from 'vitest';
import { applyCessAndGst, netBidAmount, resolveGstCalculationMode } from './calculator';

describe('applyCessAndGst', () => {
  // Real Schedule-B fixture (scripts/fixtures/3__Schedule_-_B_online_copy.pdf):
  //   Total end cost without GST     ₹58,42,000.00
  //   Welfare Cess 1%                    ₹58,420.00
  //   Total with cess, without GST    ₹59,00,420.00
  //   GST 18%                         ₹10,62,075.60
  //   Total including GST and cess    ₹69,62,495.60
  test('Schedule-B fixture: cess applied before GST', () => {
    const r = applyCessAndGst(5842000, 1, 18);
    expect(r.cessAmount).toBeCloseTo(58420, 2);
    expect(r.amountAfterCess).toBeCloseTo(5900420, 2);
    expect(r.gstAmount).toBeCloseTo(1062075.6, 2);
    expect(r.totalWithGst).toBeCloseTo(6962495.6, 2);
    expect(r.roundedTotal).toBe(6962496);
    expect(r.roundOff).toBeCloseTo(0.4, 2);
  });

  test('zero cess: GST applies directly to net amount', () => {
    const r = applyCessAndGst(100000, 0, 18);
    expect(r.cessAmount).toBe(0);
    expect(r.amountAfterCess).toBe(100000);
    expect(r.gstAmount).toBeCloseTo(18000, 2);
    expect(r.totalWithGst).toBeCloseTo(118000, 2);
  });

  test('zero GST: total stops after cess', () => {
    const r = applyCessAndGst(100000, 2, 0);
    expect(r.cessAmount).toBeCloseTo(2000, 2);
    expect(r.gstAmount).toBe(0);
    expect(r.totalWithGst).toBeCloseTo(102000, 2);
  });

  test('zero cess and zero GST: total equals net amount, no round off beyond rounding', () => {
    const r = applyCessAndGst(50000, 0, 0);
    expect(r.totalWithGst).toBe(50000);
    expect(r.roundedTotal).toBe(50000);
    expect(r.roundOff).toBe(0);
  });
});

describe('resolveGstCalculationMode', () => {
  test('unknown -> gated, no effective rate', () => {
    expect(resolveGstCalculationMode('unknown', 18)).toEqual({ gated: true, effectiveGstPercent: 0 });
  });

  test('undefined -> gated (same as unknown, never a silent default)', () => {
    expect(resolveGstCalculationMode(undefined, 18)).toEqual({ gated: true, effectiveGstPercent: 0 });
  });

  test('yes (rates already include GST) -> ungated, effective rate 0 (no addition)', () => {
    expect(resolveGstCalculationMode('yes', 18)).toEqual({ gated: false, effectiveGstPercent: 0 });
  });

  test('no (GST not applicable) -> ungated, effective rate 0', () => {
    expect(resolveGstCalculationMode('no', 18)).toEqual({ gated: false, effectiveGstPercent: 0 });
  });

  test('separate -> ungated, effective rate is the real GST rate', () => {
    expect(resolveGstCalculationMode('separate', 18)).toEqual({ gated: false, effectiveGstPercent: 18 });
  });

  test('separate with no rate entered yet -> ungated, effective rate 0 until entered', () => {
    expect(resolveGstCalculationMode('separate', undefined)).toEqual({ gated: false, effectiveGstPercent: 0 });
  });
});

// User-verified real-world cases from the Universal Financial Bid Engine milestone.
describe('two-mode GST calculation — verified against user-supplied real numbers', () => {
  test('Case 1: Bareja-shaped — Schedule-B ₹48,265.33, 1% Above -> ₹48,747.98 (bid % math, no GST involved)', () => {
    const quoted = netBidAmount(48265.33, 1, 'above');
    expect(quoted).toBeCloseTo(48747.98, 2);
  });

  test('Case 2: Subtotal ₹8,43,600, GST 18%, gstIncluded=separate -> Schedule Total ₹9,95,448', () => {
    const mode = resolveGstCalculationMode('separate', 18);
    const r = applyCessAndGst(843600, 0, mode.effectiveGstPercent);
    expect(r.roundedTotal).toBe(995448);
  });

  test('Case 2 variant: gstIncluded=yes (already included in rates) -> total stays at the subtotal, no GST added', () => {
    const mode = resolveGstCalculationMode('yes', 18);
    const r = applyCessAndGst(843600, 0, mode.effectiveGstPercent);
    expect(r.roundedTotal).toBe(843600);
  });

  test('Case 2 variant: gstIncluded=no (not applicable) -> total stays at the subtotal, no GST added', () => {
    const mode = resolveGstCalculationMode('no', 18);
    const r = applyCessAndGst(843600, 0, mode.effectiveGstPercent);
    expect(r.roundedTotal).toBe(843600);
  });

  test('gstIncluded=unknown -> calculation is gated entirely, caller must not call applyCessAndGst', () => {
    const mode = resolveGstCalculationMode('unknown', 18);
    expect(mode.gated).toBe(true);
  });
});
