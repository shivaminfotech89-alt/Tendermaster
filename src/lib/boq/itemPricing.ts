import type { BoqItem } from '../../types/boq';
import type { ItemPricing, ItemValidation } from '../../types/boqPricing';
import { checkBoqItemDataQuality } from './boqDataQuality';

/** Rate below this fraction of the estimated rate is flagged "extremely low". */
const LOW_RATE_RATIO = 0.5;
/** Rate above this multiple of the estimated rate is flagged "extremely high". */
const HIGH_RATE_RATIO = 2.0;

export function computeQuotedAmount(quantity: number, bidRate: number | undefined): number | undefined {
  if (bidRate === undefined) return undefined;
  return quantity * bidRate;
}

/**
 * Stable key for joining pricing data to BoqItem rows. Keyed by itemNo
 * (not BoqItem.id — linearReconstruction.ts assigns a fresh
 * crypto.randomUUID() to `id` on every extraction run, so `id` does not
 * survive a manual re-extract). Duplicate itemNo values — a known BOQ
 * data-quality issue also flagged by checkItemCompleteness in
 * boqVerificationService.ts — are disambiguated by occurrence index so
 * they don't silently collide in the pricing map.
 */
export function buildPricingKeys(items: BoqItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map(item => {
    const no = item.itemNo.trim();
    const count = (seen.get(no) ?? 0) + 1;
    seen.set(no, count);
    return count === 1 ? no : `${no}#${count}`;
  });
}

export function findDuplicateItemNos(items: BoqItem[]): string[] {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const no = item.itemNo.trim();
    acc[no] = (acc[no] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).filter(([, c]) => c > 1).map(([no]) => no);
}

export function validateItemPricing(item: BoqItem, pricing: ItemPricing | undefined, isDuplicate: boolean): ItemValidation {
  // Department-data sanity (quantity/unit/rate/amount) is shared with the
  // read-only table via boqDataQuality.ts — folded in here so the pricing
  // grid surfaces the same warnings, not just its own bid-rate checks.
  const dataQuality = checkBoqItemDataQuality(item);
  const issues: string[] = [...dataQuality.issues];
  let level: 'ok' | 'warning' | 'error' = dataQuality.level;

  const rate = pricing?.bidRate;
  const estimated = item.estimatedRate;

  if (rate === undefined) {
    issues.push('Quoted Rate missing');
    if (level === 'ok') level = 'warning';
  } else if (rate < 0) {
    issues.push('Negative quoted rate');
    level = 'error';
  } else if (rate === 0) {
    issues.push('Zero quoted rate');
    if (level === 'ok') level = 'warning';
  } else if (estimated !== undefined && estimated > 0) {
    if (rate < estimated * LOW_RATE_RATIO) {
      issues.push(`${(100 - (rate / estimated) * 100).toFixed(0)}% below estimated rate`);
      if (level === 'ok') level = 'warning';
    } else if (rate > estimated * HIGH_RATE_RATIO) {
      issues.push(`${(rate / estimated).toFixed(1)}x above estimated rate`);
      if (level === 'ok') level = 'warning';
    }
  }

  if (isDuplicate) {
    issues.push('Duplicate item number');
    level = 'error';
  }

  return { level, issues };
}

export interface ItemRateTotals {
  estimatedAmount: number;
  quotedAmount: number;
  pricedItemCount: number;
  duplicateItemNos: string[];
}

export function sumItemRateTotals(items: BoqItem[], pricingMap: Record<string, ItemPricing>, keys: string[]): ItemRateTotals {
  let estimatedAmount = 0;
  let quotedAmount = 0;
  let pricedItemCount = 0;

  items.forEach((item, i) => {
    estimatedAmount += item.amount ?? 0;
    const pricing = pricingMap[keys[i]];
    if (pricing?.quotedAmount !== undefined) {
      quotedAmount += pricing.quotedAmount;
      pricedItemCount += 1;
    }
  });

  return {
    estimatedAmount,
    quotedAmount,
    pricedItemCount,
    duplicateItemNos: findDuplicateItemNos(items),
  };
}
