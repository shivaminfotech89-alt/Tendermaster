export const PLANS = [
  { id: 'starter',    amountRupees: 9999,  amountPaise: 999900,  credits: 10, label: 'Starter',    adminOnly: false },
  { id: 'pro',        amountRupees: 14999, amountPaise: 1499900, credits: 20, label: 'Pro',         adminOnly: false },
  { id: 'admin_test', amountRupees: 1,     amountPaise: 100,     credits: 1,  label: 'Admin Test',  adminOnly: true  },
] as const;

export type Plan = typeof PLANS[number];
export const TRIAL_CREDITS = 1;
export const TRIAL_DOC_LIMIT = 1;
export const CREDIT_VALIDITY_MONTHS = 24;
