import { describe, test, expect } from 'vitest';
import type { BoqItem } from '../../types/boq';
import { checkBoqItemDataQuality } from './boqDataQuality';

function item(overrides: Partial<BoqItem> = {}): BoqItem {
  return {
    id: 'id-' + Math.random(),
    itemNo: '1',
    description: 'Test item',
    unit: 'Nos',
    quantity: 2,
    estimatedRate: 100,
    amount: 200,
    ...overrides,
  };
}

describe('checkBoqItemDataQuality', () => {
  test('clean item → ok, no issues', () => {
    const r = checkBoqItemDataQuality(item());
    expect(r.level).toBe('ok');
    expect(r.issues).toEqual([]);
  });

  test('zero quantity → warning', () => {
    const r = checkBoqItemDataQuality(item({ quantity: 0 }));
    expect(r.level).toBe('warning');
    expect(r.issues).toContain('Quantity could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('negative quantity → warning', () => {
    const r = checkBoqItemDataQuality(item({ quantity: -3 }));
    expect(r.issues).toContain('Quantity could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('missing unit → warning', () => {
    const r = checkBoqItemDataQuality(item({ unit: '' }));
    expect(r.level).toBe('warning');
    expect(r.issues).toContain('Unit could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('whitespace-only unit → warning', () => {
    const r = checkBoqItemDataQuality(item({ unit: '   ' }));
    expect(r.issues).toContain('Unit could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('missing department rate → warning', () => {
    const r = checkBoqItemDataQuality(item({ estimatedRate: undefined }));
    expect(r.level).toBe('warning');
    expect(r.issues).toContain('Rate could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('zero department rate → warning', () => {
    const r = checkBoqItemDataQuality(item({ estimatedRate: 0 }));
    expect(r.issues).toContain('Rate could not be confidently extracted. Please compare with the original BOQ.');
  });

  test('amount matches quantity × rate exactly → no mismatch flagged', () => {
    const r = checkBoqItemDataQuality(item({ quantity: 4, estimatedRate: 25, amount: 100 }));
    expect(r.issues.some(i => i.includes('does not match'))).toBe(false);
  });

  test('amount within 1% tolerance → no mismatch flagged', () => {
    const r = checkBoqItemDataQuality(item({ quantity: 1, estimatedRate: 1000, amount: 1005 }));
    expect(r.issues.some(i => i.includes('does not match'))).toBe(false);
  });

  test('amount far from quantity × rate → flagged', () => {
    const r = checkBoqItemDataQuality(item({ quantity: 2, estimatedRate: 100, amount: 500 }));
    expect(r.level).toBe('warning');
    expect(r.issues).toContain('Amount does not match Quantity × Rate. Please compare with the original BOQ.');
  });

  test('amount check skipped when rate is missing (already flagged separately)', () => {
    const r = checkBoqItemDataQuality(item({ estimatedRate: undefined, amount: 999999 }));
    expect(r.issues.some(i => i.includes('does not match'))).toBe(false);
  });

  test('multiple issues accumulate together', () => {
    const r = checkBoqItemDataQuality(item({ quantity: 0, unit: '', estimatedRate: undefined, amount: undefined }));
    expect(r.level).toBe('warning');
    expect(r.issues.length).toBe(3);
  });
});
