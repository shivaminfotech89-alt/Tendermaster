import { describe, test, expect } from 'vitest';
import { detectGstCess } from './detectGstCess';

// Real extracted text from scripts/fixtures/3__Schedule_-_B_online_copy.pdf
// (row-ordered, as ExtractionResult.rawText produces).
const SCHEDULE_B_TEXT = `
Schedule-B - Estimated Price break up
Sr. No. Particulars Cost per unit Total Cost
A TOTAL COST FOR PART-A ₹ 58,42,000.00
B Bidder's offer (+/-) in % ONLINE ONLY 0.0000%
C Bidder's offer (+/-) in Rs. ₹ -
D Total End cost without GST and cess in Rs. ₹ 58,42,000.00
E Applicable Welfare Cess on total end cost in % 1%
F Applicable Welfare Cess on total end cost in Rs. ₹ 58,420.00
G Total End Cost With Welfare Cess and Without GST in Rs. ₹ 59,00,420.00
H Applicable GST and Cess on total end cost in % 18%
I Applicable GST and Cess on total end cost in Rs. ₹ 10,62,075.60
J Total End cost including GST and cess in Rs. ₹ 69,62,495.60
`;

// Real extracted text from scripts/fixtures/part1.pdf (Bareja).
const BAREJA_TEXT = `
BID DOCUMENTS FOR ANNUAL RATE CONTRACT FOR R.C.C. / C.C. ROAD AND ASPHALT ROAD
1. The Contractor shall exhibit a board with detailed specification and details of work as directed by the Engineer-In-Charge for which no extra payment shall be made.
2. The labour cess will be deducted as per prevailing rules i.e. 1% of the work done.
3. GST and Income tax TDS will be deducted at a source while making payments of bills
5. Bidder has to quote rates without GST, GST will be applicable extra on tender rate.
`;

describe('detectGstCess', () => {
  test('Schedule-B: structured labeled rows -> high confidence, exact rates', () => {
    const r = detectGstCess(SCHEDULE_B_TEXT);
    expect(r.gstIncluded).toBe('separate');
    expect(r.gstRate).toBe(18);
    expect(r.cessRate).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  test('Bareja: prose-only mentions -> medium confidence, cess rate found, no GST rate', () => {
    const r = detectGstCess(BAREJA_TEXT);
    expect(r.gstIncluded).toBe('separate');
    expect(r.cessRate).toBe(1);
    expect(r.gstRate).toBeUndefined();
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.confidence).toBeLessThan(90);
  });

  test('empty text -> unknown, low confidence', () => {
    const r = detectGstCess('');
    expect(r.gstIncluded).toBe('unknown');
    expect(r.confidence).toBeLessThan(50);
  });

  test('no GST/cess signal at all -> unknown, low confidence, never guesses', () => {
    const r = detectGstCess('This tender is for construction of a community hall.');
    expect(r.gstIncluded).toBe('unknown');
    expect(r.cessRate).toBeUndefined();
    expect(r.gstRate).toBeUndefined();
    expect(r.confidence).toBeLessThan(50);
  });

  test('"inclusive of GST" prose -> yes, medium confidence', () => {
    const r = detectGstCess('The quoted rates shall be inclusive of GST and all other taxes.');
    expect(r.gstIncluded).toBe('yes');
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.confidence).toBeLessThan(90);
  });

  test('cess mentioned alone, no GST inclusion statement -> unknown but cess rate captured', () => {
    const r = detectGstCess('A welfare cess of 2% shall apply to all payments under this contract.');
    expect(r.gstIncluded).toBe('unknown');
    expect(r.cessRate).toBe(2);
  });

  test('conflicting GST statements -> unknown, never guesses which wins', () => {
    const r = detectGstCess('Rates are inclusive of GST. Note: GST will be applicable extra on the final bill.');
    expect(r.gstIncluded).toBe('unknown');
    expect(r.confidence).toBeLessThan(50);
  });

  test('exclusive of GST phrasing is also recognized as separate', () => {
    const r = detectGstCess('All quoted rates are exclusive of GST.');
    expect(r.gstIncluded).toBe('separate');
  });
});
