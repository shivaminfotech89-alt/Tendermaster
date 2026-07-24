export type WarningLevel = 'ok' | 'amber' | 'red';

export interface ProfitMetrics {
  grossProfit: number;
  profitPercent: number;   // grossProfit / quotedAmount × 100
  marginPercent: number;   // grossProfit / totalCost × 100
}

export interface WarningResult {
  level: WarningLevel;
  messages: string[];      // empty when level is 'ok'
}

export function netBidAmount(
  estimated: number,
  percentage: number,
  aboveBelow: 'above' | 'below',
): number {
  return aboveBelow === 'above'
    ? estimated * (1 + percentage / 100)
    : estimated * (1 - percentage / 100);
}

export function calcProfit(quotedAmount: number, totalCost: number): ProfitMetrics {
  const grossProfit = quotedAmount - totalCost;
  return {
    grossProfit,
    profitPercent: quotedAmount > 0 ? (grossProfit / quotedAmount) * 100 : 0,
    marginPercent: totalCost  > 0 ? (grossProfit / totalCost)    * 100 : 0,
  };
}

export function getBidWarnings(
  quotedAmount: number,
  totalCost: number,
  percentage: number,
  metrics: ProfitMetrics,
): WarningResult {
  const messages: string[] = [];
  let level: WarningLevel = 'ok';

  // Hard: bid is below cost
  if (totalCost > 0 && quotedAmount < totalCost) {
    const loss = totalCost - quotedAmount;
    messages.push(
      `Below cost — you will lose ₹${loss.toLocaleString('en-IN')}`,
    );
    level = 'red';
  }

  // Soft: thin margin
  if (level !== 'red' && totalCost > 0 && metrics.marginPercent < 5) {
    messages.push(
      `Low margin (${metrics.marginPercent.toFixed(1)}% — below 5%)`,
    );
    level = 'amber';
  }

  // Likely typo
  if (Math.abs(percentage) > 20) {
    messages.push(`Percentage exceeds 20% — please check for a typo`);
    if (level === 'ok') level = 'amber';
  }

  return { level, messages };
}

export function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

export interface CessGstBreakdown {
  netAmount: number;
  cessPercent: number;
  cessAmount: number;
  amountAfterCess: number;
  gstPercent: number;
  gstAmount: number;
  totalWithGst: number;
  roundedTotal: number;
  roundOff: number;
}

/**
 * Applies welfare cess before GST — cess is computed on the net quoted
 * amount, then GST is computed on the cess-inclusive total. Several Gujarat
 * tenders (and the Schedule-B fixture in scripts/fixtures) compute the
 * grand total in this order; applying GST first would understate the total.
 */
export interface GstCalculationMode {
  /** true when gstIncluded is unresolved — no cess/GST total should be computed at all. */
  gated: boolean;
  /** the gstPercent applyCessAndGst should actually be called with. */
  effectiveGstPercent: number;
}

/**
 * Two arithmetic behaviors, not three, despite gstIncluded having 4 states:
 * 'yes' (rates already include GST) and 'no' (GST doesn't apply) both mean no
 * GST addition — pass gstPercent 0 downstream. 'separate' means GST is added
 * on top of the cess-inclusive subtotal — pass the real rate. 'unknown' gates
 * the whole calculation; never silently defaults to a guessed rate.
 */
export function resolveGstCalculationMode(
  gstIncluded: 'yes' | 'no' | 'separate' | 'unknown' | undefined,
  gstPercent: number | undefined,
): GstCalculationMode {
  if (gstIncluded == null || gstIncluded === 'unknown') {
    return { gated: true, effectiveGstPercent: 0 };
  }
  if (gstIncluded === 'separate') {
    return { gated: false, effectiveGstPercent: gstPercent ?? 0 };
  }
  return { gated: false, effectiveGstPercent: 0 };
}

export function applyCessAndGst(
  netAmount: number,
  cessPercent: number,
  gstPercent: number,
): CessGstBreakdown {
  const cessAmount = netAmount * cessPercent / 100;
  const amountAfterCess = netAmount + cessAmount;
  const gstAmount = amountAfterCess * gstPercent / 100;
  const totalWithGst = amountAfterCess + gstAmount;
  const roundedTotal = Math.round(totalWithGst);
  return {
    netAmount,
    cessPercent,
    cessAmount,
    amountAfterCess,
    gstPercent,
    gstAmount,
    totalWithGst,
    roundedTotal,
    roundOff: roundedTotal - totalWithGst,
  };
}
