export const PLANS = [
  { amountRupees: 999,  amountPaise: 99900,  days: 90,  label: "Quarterly", duration: "3 months" },
  { amountRupees: 1999, amountPaise: 199900, days: 365, label: "Annual",    duration: "1 year"   },
] as const;

export type Plan = typeof PLANS[number];

export const PLAN_DAYS_FALLBACK = 30;
