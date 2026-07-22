import { describe, test, expect } from 'vitest';
import { applyCessAndGst } from './calculator';

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
