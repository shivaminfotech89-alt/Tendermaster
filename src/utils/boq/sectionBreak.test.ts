import { describe, it, expect } from 'vitest';
import { checkSectionBreak, DEFAULT_SECTION_BREAK_PATTERNS } from './sectionBreak';

describe('checkSectionBreak', () => {
  it('matches Rate Analysis RA-1', () => {
    expect(checkSectionBreak('Rate Analysis RA-1')).not.toBeNull();
  });

  it('matches "RA 2" (spaced)', () => {
    expect(checkSectionBreak('RA 2 Cost Breakdown')).not.toBeNull();
  });

  it('matches cost aggregate', () => {
    expect(checkSectionBreak('S.D.B.C. Cost Aggregate')).not.toBeNull();
  });

  it('matches SDBC alone', () => {
    expect(checkSectionBreak('SDBC details below')).not.toBeNull();
  });

  it('matches "analysis of rates"', () => {
    expect(checkSectionBreak('analysis of rates for item 15')).not.toBeNull();
  });

  it('matches Terms and Conditions', () => {
    expect(checkSectionBreak('Terms and Conditions of Contract')).not.toBeNull();
  });

  it('matches "Terms & Conditions"', () => {
    expect(checkSectionBreak('Terms & Conditions')).not.toBeNull();
  });

  it('does NOT match normal BOQ description text', () => {
    expect(checkSectionBreak('Providing and laying drainage blocks with hardner material')).toBeNull();
  });

  it('does NOT match item amount rows', () => {
    expect(checkSectionBreak('21.00 1.00 Cu.M 553.79 553.79')).toBeNull();
  });

  it('does NOT match empty string', () => {
    expect(checkSectionBreak('')).toBeNull();
  });

  it('returns label and type on match', () => {
    const m = checkSectionBreak('Rate Analysis RA-1');
    expect(m?.label).toBe('Rate Analysis');
    expect(m?.type).toBe('rate_analysis');
  });

  it('accepts custom patterns', () => {
    const custom = [{ re: /my_custom_break/i, label: 'Custom', type: 'end_of_boq' as const }];
    expect(checkSectionBreak('this is my_custom_break here', custom)).not.toBeNull();
    expect(checkSectionBreak('Rate Analysis RA-1', custom)).toBeNull();
  });
});
