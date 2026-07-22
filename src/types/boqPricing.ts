/**
 * Per-item BOQ pricing — stored separately from extraction data
 * (`saved_tenders/{id}/boq_pricing/latest`) and joined client-side against
 * extracted `BoqItem[]` by `itemNo`. Aggregate bid totals (quoted amount,
 * profit, cess/GST) live on the existing `BOQData` shape in
 * `src/lib/boq/types.ts`, not here.
 */

export type ItemValidationLevel = 'ok' | 'warning' | 'error';

export interface ItemValidation {
  level: ItemValidationLevel;
  issues: string[];
}

export interface ItemPricing {
  bidRate?: number;
  discountPercent?: number;
  premiumPercent?: number;
  remarks?: string;
  /** Computed = quantity × bidRate, persisted for fast reads. */
  quotedAmount?: number;
  validation: ItemValidation;
}

export interface PricingDoc {
  items: Record<string, ItemPricing>;
  updatedAt: unknown;
}
