import { describe, test, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractBoqFromExcelWithVerification } from './boqExcelExtractionOrchestrator';

function buildSmartMeterRows(): unknown[][] {
  const rows: unknown[][] = [];
  rows.push(['Vendor Name:', '', '', '', '', '']);
  rows.push(['Schedule of Rate', '', '', '', '', '']);
  rows.push(['Smart Meter Installation ARC Activities - AMDIST', '', '', '', '', '']);
  rows.push(['Kindly submit your offer against the below activities', '', '', '', '', '']);
  rows.push(['Sr. No.', 'Service Code', 'Activity', 'UoM', 'Qty.', 'Unit Rate\n[Rs.]']);
  const activities = [
    'Installation of Single Phase Smart Meter', 'Installation of Three Phase Smart Meter',
    'Dismantling of Old Meter', 'Meter Testing and Sealing', 'CT/PT Verification',
    'Meter Box Fixing', 'Cable Termination', 'Data Configuration and Commissioning',
    'Site Survey and Documentation', 'Customer Handover and Demo',
  ];
  activities.forEach((activity, i) => rows.push([i + 1, `SC-${100 + i}`, activity, 'EA', 500 + i * 10, '']));
  rows.push(['', '', 'Total Basic Cost', '', '', '']);
  rows.push(['', '', 'GST', '', '', 0.18]);
  rows.push(['', '', 'Total Landed Cost', '', '', '']);
  rows.push(['Terms & Conditions', '', '', '', '', '']);
  rows.push(['Contract Period: 01.08.2026 to 31.07.2027 (1 Years)', '', '', '', '', '']);
  rows.push(['Validity: 90 days', '', '', '', '', '']);
  return rows;
}

function bufferFromRows(rows: unknown[][], sheetName = 'Smart_Meter'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

describe('extractBoqFromExcelWithVerification — blank-rate SOR (guardrail #3)', () => {
  test('recognizes the BOQ and passes verification despite every rate being blank', async () => {
    const buffer = bufferFromRows(buildSmartMeterRows());
    const result = await extractBoqFromExcelWithVerification(buffer);

    expect(result.boqRecognized).toBe(true);
    expect(result.extraction.items).toHaveLength(10);
    expect(result.verification.pass).toBe(true);
    expect(result.verification.criticalFailures).toHaveLength(0);
  });

  test('rawText and analysisText both exclude the item table', () => {
    const buffer = bufferFromRows(buildSmartMeterRows());
    return extractBoqFromExcelWithVerification(buffer).then(result => {
      expect(result.extraction.rawText).not.toContain('Installation of Single Phase Smart Meter');
      expect(result.analysisText).not.toContain('Installation of Single Phase Smart Meter');
      expect(result.analysisText).toContain('Contract Period: 01.08.2026');
    });
  });

  test('a workbook with no BOQ sheet reports boqRecognized: false without throwing', async () => {
    const buffer = bufferFromRows([['Notes'], ['nothing tabular here']], 'Notes');
    const result = await extractBoqFromExcelWithVerification(buffer);
    expect(result.boqRecognized).toBe(false);
    expect(result.extraction.items).toHaveLength(0);
  });
});
