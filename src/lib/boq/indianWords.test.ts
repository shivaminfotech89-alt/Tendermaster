import { describe, test, expect } from 'vitest';
import { toIndianWords } from './indianWords';

describe('toIndianWords', () => {
  // ── edge cases ─────────────────────────────────────────────────────────────
  test('zero', () => expect(toIndianWords(0)).toBe('Rupees Zero Only'));
  test('negative', () => expect(toIndianWords(-1)).toBe('Invalid Amount'));
  test('NaN',      () => expect(toIndianWords(NaN)).toBe('Invalid Amount'));
  test('Infinity', () => expect(toIndianWords(Infinity)).toBe('Invalid Amount'));

  // ── ones and teens ─────────────────────────────────────────────────────────
  test('1',  () => expect(toIndianWords(1)).toBe('Rupees One Only'));
  test('9',  () => expect(toIndianWords(9)).toBe('Rupees Nine Only'));
  test('11', () => expect(toIndianWords(11)).toBe('Rupees Eleven Only'));
  test('13', () => expect(toIndianWords(13)).toBe('Rupees Thirteen Only'));
  test('19', () => expect(toIndianWords(19)).toBe('Rupees Nineteen Only'));

  // ── compound tens (hyphen required) ────────────────────────────────────────
  test('21',  () => expect(toIndianWords(21)).toBe('Rupees Twenty-One Only'));
  test('45',  () => expect(toIndianWords(45)).toBe('Rupees Forty-Five Only'));
  test('78',  () => expect(toIndianWords(78)).toBe('Rupees Seventy-Eight Only'));
  test('99',  () => expect(toIndianWords(99)).toBe('Rupees Ninety-Nine Only'));

  // ── hundreds ───────────────────────────────────────────────────────────────
  test('100', () => expect(toIndianWords(100)).toBe('Rupees One Hundred Only'));
  test('200', () => expect(toIndianWords(200)).toBe('Rupees Two Hundred Only'));
  test('409', () => expect(toIndianWords(409)).toBe('Rupees Four Hundred Nine Only'));
  test('999', () => expect(toIndianWords(999)).toBe('Rupees Nine Hundred Ninety-Nine Only'));

  // ── thousands ──────────────────────────────────────────────────────────────
  test('1000',  () => expect(toIndianWords(1000)).toBe('Rupees One Thousand Only'));
  test('1001',  () => expect(toIndianWords(1001)).toBe('Rupees One Thousand One Only'));
  test('10000', () => expect(toIndianWords(10000)).toBe('Rupees Ten Thousand Only'));
  test('45678', () => expect(toIndianWords(45678)).toBe(
    'Rupees Forty-Five Thousand Six Hundred Seventy-Eight Only'));

  // ── lakhs ──────────────────────────────────────────────────────────────────
  test('1 lakh',         () => expect(toIndianWords(100000)).toBe('Rupees One Lakh Only'));
  test('25 lakh',        () => expect(toIndianWords(2500000)).toBe('Rupees Twenty-Five Lakh Only'));
  test('spec example',   () => expect(toIndianWords(7800409)).toBe(
    'Rupees Seventy-Eight Lakh Four Hundred Nine Only'));
  test('99,99,999',      () => expect(toIndianWords(9999999)).toBe(
    'Rupees Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine Only'));

  // ── crores ─────────────────────────────────────────────────────────────────
  test('1 crore',     () => expect(toIndianWords(10000000)).toBe('Rupees One Crore Only'));
  test('combined',    () => expect(toIndianWords(12345678)).toBe(
    'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only'));
  test('100 crore',   () => expect(toIndianWords(1000000000)).toBe('Rupees One Hundred Crore Only'));
  test('999 crore',   () => expect(toIndianWords(9990000000)).toBe('Rupees Nine Hundred Ninety-Nine Crore Only'));

  // ── >999 crore (large infra tenders) ──────────────────────────────────────
  test('1000 crore',  () => expect(toIndianWords(10000000000)).toBe('Rupees One Thousand Crore Only'));
  test('5000 crore',  () => expect(toIndianWords(50000000000)).toBe('Rupees Five Thousand Crore Only'));
  test('9900 crore',  () => expect(toIndianWords(99000000000)).toBe(
    'Rupees Nine Thousand Nine Hundred Crore Only'));

  // ── paise ──────────────────────────────────────────────────────────────────
  test('with 50 paise',   () => expect(toIndianWords(100.50)).toBe(
    'Rupees One Hundred and Fifty Paise Only'));
  test('zero rupees paise only', () => expect(toIndianWords(0.75)).toBe(
    'Rupees Zero and Seventy-Five Paise Only'));
  test('99.99',          () => expect(toIndianWords(99.99)).toBe(
    'Rupees Ninety-Nine and Ninety-Nine Paise Only'));

  // ── floating-point safety ─────────────────────────────────────────────────
  test('fp safety 1', () => expect(toIndianWords(0.1 + 0.2)).toBe(
    'Rupees Zero and Thirty Paise Only'));  // 0.1+0.2 = 0.30000...4 → round to 30 paise
  test('fp safety 2', () => expect(toIndianWords(1999.99)).toBe(
    'Rupees One Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only'));
});
