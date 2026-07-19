import { describe, it, expect } from 'vitest';
import { detectTenderBoqType, classifyTableTitle } from './boqClassifierService';
import type { DetectedTable } from '../types/boq';

function makeBoqTable(roles: string[]): DetectedTable {
  const mapping: Record<number, string> = {};
  roles.forEach((r, i) => { mapping[i] = r; });
  return {
    type: 'boq_schedule',
    startRowIndex: 0,
    endRowIndex: 10,
    header: {
      headerRowIndex: 0,
      mapping: mapping as any,
      confidence: 90,
      mappedCount: roles.length,
      totalColumns: roles.length,
    },
    items: [],
    rateAnalyses: [],
  };
}

describe('detectTenderBoqType', () => {
  it('detects percentage_rate from "willing to carry out the work @ 5% above"', () => {
    const result = detectTenderBoqType('willing to carry out the work @ 5% above', []);
    expect(result).toBe('percentage_rate');
  });

  it('detects percentage_rate from "% Below the estimated cost"', () => {
    const result = detectTenderBoqType('The contractor shall quote % Below the estimated cost', []);
    expect(result).toBe('percentage_rate');
  });

  it('detects percentage_rate from "percentage above"', () => {
    const result = detectTenderBoqType('Quote percentage above DSR rates', []);
    expect(result).toBe('percentage_rate');
  });

  it('detects item_rate when tables have quantity + unit roles', () => {
    const tables = [makeBoqTable(['item_no', 'description', 'unit', 'quantity', 'estimated_rate', 'amount'])];
    const result = detectTenderBoqType('Normal BOQ content without percentage references', tables);
    expect(result).toBe('item_rate');
  });

  it('returns unknown when no indicators present', () => {
    const result = detectTenderBoqType('General Terms and Conditions', []);
    expect(result).toBe('unknown');
  });

  it('percentage_rate takes priority over item_rate tables', () => {
    const tables = [makeBoqTable(['item_no', 'description', 'unit', 'quantity'])];
    const result = detectTenderBoqType('willing to carry out the work 5% above the DSR', tables);
    expect(result).toBe('percentage_rate');
  });
});

describe('classifyTableTitle', () => {
  it('"Bill of Quantities" → boq_schedule', () => {
    expect(classifyTableTitle('Bill of Quantities')).toBe('boq_schedule');
  });

  it('"SCHEDULE-B" → boq_schedule', () => {
    expect(classifyTableTitle('SCHEDULE-B')).toBe('boq_schedule');
  });

  it('"BOQ" → boq_schedule', () => {
    expect(classifyTableTitle('BOQ')).toBe('boq_schedule');
  });

  it('"Rate Analysis RA-1" → rate_analysis', () => {
    expect(classifyTableTitle('Rate Analysis RA-1')).toBe('rate_analysis');
  });

  it('"Material Cost" → rate_analysis', () => {
    expect(classifyTableTitle('Material Cost')).toBe('rate_analysis');
  });

  it('"Terms and Conditions" → other', () => {
    expect(classifyTableTitle('Terms and Conditions')).toBe('other');
  });

  it('"Abstract of Quantities" → boq_schedule', () => {
    expect(classifyTableTitle('Abstract of Quantities')).toBe('boq_schedule');
  });
});
