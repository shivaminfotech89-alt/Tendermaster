import { describe, test, expect } from 'vitest';
import type { BoqItem } from '../../types/boq';
import type { ItemPricing } from '../../types/boqPricing';
import {
  computeQuotedAmount, buildPricingKeys, findDuplicateItemNos,
  validateItemPricing, sumItemRateTotals,
} from './itemPricing';

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

describe('computeQuotedAmount', () => {
  test('quantity × bidRate', () => {
    expect(computeQuotedAmount(5, 10)).toBe(50);
  });
  test('undefined bidRate → undefined', () => {
    expect(computeQuotedAmount(5, undefined)).toBeUndefined();
  });
  test('zero bidRate is a valid quoted amount of 0', () => {
    expect(computeQuotedAmount(5, 0)).toBe(0);
  });
});

describe('buildPricingKeys', () => {
  test('unique itemNos map to themselves', () => {
    const items = [item({ itemNo: '1' }), item({ itemNo: '2' }), item({ itemNo: '3' })];
    expect(buildPricingKeys(items)).toEqual(['1', '2', '3']);
  });
  test('duplicate itemNos get a #N suffix from the 2nd occurrence', () => {
    const items = [item({ itemNo: '12' }), item({ itemNo: '12' }), item({ itemNo: '12' }), item({ itemNo: '13' })];
    expect(buildPricingKeys(items)).toEqual(['12', '12#2', '12#3', '13']);
  });
});

describe('findDuplicateItemNos', () => {
  test('no duplicates', () => {
    expect(findDuplicateItemNos([item({ itemNo: '1' }), item({ itemNo: '2' })])).toEqual([]);
  });
  test('flags itemNos appearing more than once', () => {
    const dupes = findDuplicateItemNos([item({ itemNo: '1' }), item({ itemNo: '1' }), item({ itemNo: '2' })]);
    expect(dupes).toEqual(['1']);
  });
});

describe('validateItemPricing', () => {
  const base = item({ estimatedRate: 100 });

  function pricing(bidRate: number | undefined): ItemPricing {
    return { bidRate, validation: { level: 'ok', issues: [] } };
  }

  test('missing rate → warning', () => {
    const v = validateItemPricing(base, pricing(undefined), false);
    expect(v.level).toBe('warning');
    expect(v.issues).toContain('Rate missing');
  });

  test('negative rate → error', () => {
    const v = validateItemPricing(base, pricing(-5), false);
    expect(v.level).toBe('error');
    expect(v.issues).toContain('Negative rate');
  });

  test('zero rate → warning', () => {
    const v = validateItemPricing(base, pricing(0), false);
    expect(v.level).toBe('warning');
    expect(v.issues).toContain('Zero rate');
  });

  test('rate far below estimated → warning', () => {
    const v = validateItemPricing(base, pricing(30), false); // 70% below
    expect(v.level).toBe('warning');
    expect(v.issues.some(i => i.includes('below estimated rate'))).toBe(true);
  });

  test('rate far above estimated → warning', () => {
    const v = validateItemPricing(base, pricing(250), false); // 2.5x
    expect(v.level).toBe('warning');
    expect(v.issues.some(i => i.includes('above estimated rate'))).toBe(true);
  });

  test('rate within normal band → ok', () => {
    const v = validateItemPricing(base, pricing(110), false);
    expect(v.level).toBe('ok');
    expect(v.issues).toEqual([]);
  });

  test('duplicate item number → error regardless of rate', () => {
    const v = validateItemPricing(base, pricing(110), true);
    expect(v.level).toBe('error');
    expect(v.issues).toContain('Duplicate item number');
  });

  test('no estimated rate present: skips the low/high comparison', () => {
    const noEst = item({ estimatedRate: undefined });
    const v = validateItemPricing(noEst, pricing(1), false);
    expect(v.level).toBe('ok');
  });
});

describe('sumItemRateTotals', () => {
  test('sums estimated amounts always; quoted amounts only when priced', () => {
    const items = [
      item({ itemNo: '1', amount: 200 }),
      item({ itemNo: '2', amount: 300 }),
    ];
    const keys = buildPricingKeys(items);
    const pricingMap: Record<string, ItemPricing> = {
      [keys[0]]: { bidRate: 90, quotedAmount: 180, validation: { level: 'ok', issues: [] } },
      // second item not priced yet
    };
    const totals = sumItemRateTotals(items, pricingMap, keys);
    expect(totals.estimatedAmount).toBe(500);
    expect(totals.quotedAmount).toBe(180);
    expect(totals.pricedItemCount).toBe(1);
  });

  test('reports duplicate itemNos in the totals', () => {
    const items = [item({ itemNo: '1' }), item({ itemNo: '1' })];
    const keys = buildPricingKeys(items);
    const totals = sumItemRateTotals(items, {}, keys);
    expect(totals.duplicateItemNos).toEqual(['1']);
  });
});
