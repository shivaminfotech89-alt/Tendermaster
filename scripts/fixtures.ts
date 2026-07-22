/**
 * BOQ test fixture registry.
 *
 * Drop the PDF files into scripts/fixtures/ then run:
 *   npx tsx scripts/verify-boq.ts --fixture bareja
 *   npx tsx scripts/verify-boq.ts --fixture schedule-b
 *   npx tsx scripts/run-boq-fixtures.ts   (runs all fixtures)
 */

export interface BoqFixture {
  name: string;
  description: string;
  pdfPath: string;
  expectedItemCount: number;
  expectedTotal: number;
  multilineItems?: string[];
  /** Per-item quantities in extraction order, for regression-testing that the
   *  parser never silently defaults a missing/unparsed quantity (matching the
   *  aggregate total alone can't rule out compensating errors). */
  expectedQuantities?: number[];
}

export const FIXTURES: BoqFixture[] = [
  {
    name: 'bareja',
    description: 'Bareja BOQ — civil works, Schedule-B1, 41 items',
    pdfPath: 'scripts/fixtures/part1.pdf',
    expectedItemCount: 41,
    expectedTotal: 48265.33,
    multilineItems: ['13', '14', '26', '34', '36'],
  },
  {
    name: 'schedule-b',
    description: 'Electrical / transformer supply BOQ — 5 items, percentage-rate tender',
    pdfPath: 'scripts/fixtures/3__Schedule_-_B_online_copy.pdf',
    expectedItemCount: 5,
    expectedTotal: 5842000.00,
    multilineItems: [],
    expectedQuantities: [2, 2, 4, 4, 5],
  },
];

export function findFixture(name: string): BoqFixture | undefined {
  return FIXTURES.find(f => f.name === name);
}
