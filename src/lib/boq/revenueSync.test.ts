import { describe, test, expect } from 'vitest';
import { decideRevenueSync, inferRevenueSource } from './revenueSync';

describe('decideRevenueSync', () => {
  test('auto: applies directly, no prompt — unchanged today behavior', () => {
    const d = decideRevenueSync('auto', 47300, 50000);
    expect(d.applyRevenue).toBe(50000);
    expect(d.pendingSync).toBeNull();
  });

  test('auto: applies even when the incoming amount equals current (idempotent)', () => {
    const d = decideRevenueSync('auto', 47300, 47300);
    expect(d.applyRevenue).toBe(47300);
    expect(d.pendingSync).toBeNull();
  });

  test('manual: never applies directly — holds as a pending suggestion instead', () => {
    const d = decideRevenueSync('manual', 1500000, 47300);
    expect(d.applyRevenue).toBeNull();
    expect(d.pendingSync).toBe(47300);
  });

  test('manual: no prompt when the incoming amount already matches stored revenue', () => {
    const d = decideRevenueSync('manual', 1500000, 1500000);
    expect(d.applyRevenue).toBeNull();
    expect(d.pendingSync).toBeNull();
  });

  test('manual: a second, different sync attempt still holds (never overwrites)', () => {
    const first = decideRevenueSync('manual', 1500000, 47300);
    expect(first.pendingSync).toBe(47300);
    // simulating another change before the user responds to the first prompt
    const second = decideRevenueSync('manual', 1500000, 52000);
    expect(second.applyRevenue).toBeNull();
    expect(second.pendingSync).toBe(52000);
  });
});

describe('inferRevenueSource', () => {
  test('matches the live-computed auto value → auto (safe to resume syncing)', () => {
    expect(inferRevenueSource(47300, 47300)).toBe('auto');
  });

  test('diverges from the live-computed auto value → manual (protect it)', () => {
    expect(inferRevenueSource(1500000, 47300)).toBe('manual');
  });

  test('no computable auto value → manual (nothing to compare against, protect it)', () => {
    expect(inferRevenueSource(1500000, null)).toBe('manual');
  });
});
