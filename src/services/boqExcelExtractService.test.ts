import { describe, test, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSheet, parseWorkbookForBoq, toExtractionResult, buildAnalysisText } from './boqExcelExtractService';

// Mirrors the real "Torrent Power Revised_SOR_Smart_Meter.xlsx" structure
// reported in the bug: sheet "Smart_Meter", A1:F35 —
//   rows 1-4  preamble (Vendor Name / Schedule of Rate / title / instructions)
//   row 5     header: Sr. No. | Service Code | Activity | UoM | Qty. | Unit Rate\n[Rs.]
//   rows 6-15 10 line items — quantities filled, Unit Rate BLANK (rate-contract SOR)
//   row 16    Total Basic Cost (blank amount)
//   row 17    GST | 0.18
//   row 18    Total Landed Cost (blank)
//   rows 19-27 Terms & Conditions
//   rows 30-34 signature block
function buildSmartMeterRows(): unknown[][] {
  const rows: unknown[][] = [];
  rows.push(['Vendor Name:', '', '', '', '', '']);
  rows.push(['Schedule of Rate', '', '', '', '', '']);
  rows.push(['Smart Meter Installation ARC Activities - AMDIST', '', '', '', '', '']);
  rows.push(['Kindly submit your offer against the below activities', '', '', '', '', '']);
  rows.push(['Sr. No.', 'Service Code', 'Activity', 'UoM', 'Qty.', 'Unit Rate\n[Rs.]']);
  const activities = [
    'Installation of Single Phase Smart Meter',
    'Installation of Three Phase Smart Meter',
    'Dismantling of Old Meter',
    'Meter Testing and Sealing',
    'CT/PT Verification',
    'Meter Box Fixing',
    'Cable Termination',
    'Data Configuration and Commissioning',
    'Site Survey and Documentation',
    'Customer Handover and Demo',
  ];
  activities.forEach((activity, i) => {
    rows.push([i + 1, `SC-${100 + i}`, activity, 'EA', 500 + i * 10, '']);
  });
  rows.push(['', '', 'Total Basic Cost', '', '', '']);
  rows.push(['', '', 'GST', '', '', 0.18]);
  rows.push(['', '', 'Total Landed Cost', '', '', '']);
  rows.push(['Terms & Conditions', '', '', '', '', '']);
  rows.push(['Contract Period: 01.08.2026 to 31.07.2027 (1 Years)', '', '', '', '', '']);
  rows.push(['Validity: 90 days', '', '', '', '', '']);
  rows.push(['BOCW Cess Extra @ 1%', '', '', '', '', '']);
  rows.push(['Penalty Matrix as per SOW', '', '', '', '', '']);
  rows.push(['GCC Ver-07', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Authorised Signatory', '', '', '', '', '']);
  rows.push(['Name:', '', '', '', '', '']);
  rows.push(['Designation:', '', '', '', '', '']);
  rows.push(['Date:', '', '', '', '', '']);
  return rows;
}

function buildSmartMeterWorkbook(): XLSX.WorkBook {
  const rows = buildSmartMeterRows();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Smart_Meter');
  return workbook;
}

describe('parseSheet — Smart_Meter SOR structure', () => {
  test('finds the header on row 5 (index 4), not row 1', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    expect(result.headerRowIndex).toBe(4);
  });

  test('maps all 6 columns including the multi-line Unit Rate header', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    const roles = Object.values(result.columnMapping);
    expect(roles).toContain('item_no');
    expect(roles).toContain('code');
    expect(roles).toContain('description');
    expect(roles).toContain('unit');
    expect(roles).toContain('quantity');
    expect(roles).toContain('estimated_rate');
  });

  test('extracts exactly 10 line items', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    expect(result.items).toHaveLength(10);
  });

  test('items have descriptions and quantities, but blank rates', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    for (const item of result.items) {
      expect(item.description.trim().length).toBeGreaterThan(0);
      expect(item.quantity).toBeGreaterThan(0);
      expect(item.estimatedRate).toBeUndefined();
      expect(item.amount).toBeUndefined();
    }
  });

  test('is recognized as a valid BOQ despite blank rates (rate-contract SOR)', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    expect(result.recognized).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('stops item extraction at the Total Basic Cost row — no bogus items', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    const descriptions = result.items.map(i => i.description);
    expect(descriptions).not.toContain('Total Basic Cost');
    expect(descriptions.some(d => /total|gst|terms/i.test(d))).toBe(false);
    expect(result.items).toHaveLength(10);
  });

  test('captures GST% as summary metadata, not a line item', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    expect(result.totals.gstPercent).toBe(18);
  });

  test('leaves totalBasicCost/totalLandedCost undefined when blank (never 0)', () => {
    const result = parseSheet('Smart_Meter', buildSmartMeterRows());
    expect(result.totals.totalBasicCost).toBeUndefined();
    expect(result.totals.totalLandedCost).toBeUndefined();
  });

  test('captures a populated totals row when present (non-blank-rate SOR)', () => {
    const rows = buildSmartMeterRows();
    // row 16 (index 15) is "Total Basic Cost" — populate its amount cell
    rows[15] = ['', '', 'Total Basic Cost', '', '', 525000];
    rows[17] = ['', '', 'Total Landed Cost', '', '', 619500];
    const result = parseSheet('Smart_Meter', rows);
    expect(result.totals.totalBasicCost).toBe(525000);
    expect(result.totals.totalLandedCost).toBe(619500);
  });
});

describe('parseWorkbookForBoq — multi-sheet handling', () => {
  test('single-sheet workbook (Smart_Meter) is picked correctly regardless of sheet name', () => {
    const workbook = buildSmartMeterWorkbook();
    const result = parseWorkbookForBoq(workbook);
    expect(result.sheetName).toBe('Smart_Meter');
    expect(result.recognized).toBe(true);
    expect(result.items).toHaveLength(10);
  });

  test('picks the sheet that clears the BOQ bar over a non-BOQ instructions sheet, regardless of order', () => {
    const workbook = XLSX.utils.book_new();
    const instructionsSheet = XLSX.utils.aoa_to_sheet([
      ['Instructions'],
      ['Please read carefully before bidding.'],
      ['Submit by the deadline.'],
    ]);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
    const boqSheet = XLSX.utils.aoa_to_sheet(buildSmartMeterRows());
    XLSX.utils.book_append_sheet(workbook, boqSheet, 'Smart_Meter');

    const result = parseWorkbookForBoq(workbook);
    expect(result.sheetName).toBe('Smart_Meter');
    expect(result.recognized).toBe(true);
    expect(result.items).toHaveLength(10);
  });

  test('a workbook with no recognizable BOQ sheet returns recognized: false, not a crash', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Notes'],
      ['This document has no tabular schedule at all.'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Notes');
    const result = parseWorkbookForBoq(workbook);
    expect(result.recognized).toBe(false);
    expect(result.items).toHaveLength(0);
  });
});

describe('buildAnalysisText — guardrail: AI text must never include the item table', () => {
  test('excludes every item-row Activity description and quantity', () => {
    const workbook = buildSmartMeterWorkbook();
    const text = buildAnalysisText(workbook);
    const parse = parseSheet('Smart_Meter', buildSmartMeterRows());
    for (const item of parse.items) {
      expect(text).not.toContain(item.description);
      // Service Code values (e.g. "SC-100") are also item-row-only data.
      expect(text).not.toContain(item.code);
    }
  });

  test('excludes the header row itself', () => {
    const workbook = buildSmartMeterWorkbook();
    const text = buildAnalysisText(workbook);
    expect(text).not.toContain('Service Code');
    expect(text).not.toContain('Unit Rate');
  });

  test('includes preamble and Terms & Conditions text (Contract Period, Validity, GST, Cess, Penalty, GCC)', () => {
    const workbook = buildSmartMeterWorkbook();
    const text = buildAnalysisText(workbook);
    expect(text).toContain('Smart Meter Installation ARC Activities');
    expect(text).toContain('Contract Period: 01.08.2026 to 31.07.2027');
    expect(text).toContain('Validity: 90 days');
    expect(text).toContain('BOCW Cess Extra @ 1%');
    expect(text).toContain('Penalty Matrix as per SOW');
    expect(text).toContain('GCC Ver-07');
    expect(text).toContain('GST');
  });

  test('includes other sheets in full when a workbook has more than one', () => {
    const workbook = XLSX.utils.book_new();
    const instructionsRows = [
      ['Instructions'],
      ['Please submit rates for every activity listed in the Smart_Meter tab.'],
    ];
    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsRows);
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
    const boqSheet = XLSX.utils.aoa_to_sheet(buildSmartMeterRows());
    XLSX.utils.book_append_sheet(workbook, boqSheet, 'Smart_Meter');

    const text = buildAnalysisText(workbook);
    expect(text).toContain('Please submit rates for every activity listed');
    expect(text).toContain('Contract Period: 01.08.2026');
  });

  test('when no sheet is recognized as a BOQ, includes the whole workbook verbatim', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Notes'],
      ['This document has no tabular schedule at all.'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Notes');
    const text = buildAnalysisText(workbook);
    expect(text).toContain('This document has no tabular schedule at all.');
  });
});

describe('toExtractionResult', () => {
  test('produces the same ExtractionResult shape items/tables/confidence the PDF pipeline uses', () => {
    const parse = parseSheet('Smart_Meter', buildSmartMeterRows());
    const result = toExtractionResult(parse, 'some rawText');
    expect(result.items).toHaveLength(10);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].type).toBe('boq_schedule');
    expect(result.detectedBoqType).toBe('item_rate');
    expect(result.confidence.rowsExtracted).toBe(10);
    expect(result.rawText).toBe('some rawText');
  });

  test('unrecognized sheet produces zero items and a warning, never a thrown error', () => {
    const parse = parseSheet('Notes', [['Notes'], ['nothing tabular here']]);
    const result = toExtractionResult(parse, '');
    expect(result.items).toHaveLength(0);
    expect(result.confidence.warnings.length).toBeGreaterThan(0);
  });
});
