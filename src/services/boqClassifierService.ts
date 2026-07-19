import type { TableType, DetectedBoqType, DetectedTable, TextRow, HeaderDetectionResult } from '../types/boq';

const BOQ_TITLE_PATTERNS: RegExp[] = [
  /bill of quantities?/i,
  /\bboq\b/i,
  /price schedule/i,
  /schedule[- ]?[A-Z]?\d*/i,
  /statement of quantities?/i,
  /tender schedule/i,
  /work schedule/i,
  /abstract of quantities?/i,
];

const RATE_ANALYSIS_PATTERNS: RegExp[] = [
  /\bra[-\s]?\d+/i,
  /rate analysis/i,
  /cost aggregate/i,
  /material cost/i,
  /labour cost/i,
  /machinery charge/i,
  /transport charge/i,
  /analysis of rate/i,
];

const PERCENTAGE_RATE_PATTERNS: RegExp[] = [
  /willing to carry out/i,
  /\d+\s*%?\s*above/i,
  /\d+\s*%?\s*below/i,
  /percentage above/i,
  /percentage below/i,
  /quote (?:your )?percentage/i,
  /above (?:the )?estimated (?:cost|amount)/i,
  /below (?:the )?estimated (?:cost|amount)/i,
  /rate @\s*[\d.]*\s*%/i,
  /@\s*[\d.]*\s*%\s*(?:above|below)/i,
];

export function classifyTableTitle(titleText: string): TableType {
  for (const pattern of BOQ_TITLE_PATTERNS) {
    if (pattern.test(titleText)) return 'boq_schedule';
  }
  for (const pattern of RATE_ANALYSIS_PATTERNS) {
    if (pattern.test(titleText)) return 'rate_analysis';
  }
  return 'other';
}

export function classifyTable(
  headerResult: HeaderDetectionResult | null,
  titleRows: TextRow[],
): TableType {
  for (const row of titleRows) {
    const titleText = row.blocks.map(b => b.text).join(' ');
    const fromTitle = classifyTableTitle(titleText);
    if (fromTitle !== 'other') return fromTitle;
  }

  if (!headerResult) return 'other';

  const roles = new Set(Object.values(headerResult.mapping));
  const hasBoqRoles =
    (roles.has('quantity') || roles.has('unit')) &&
    (roles.has('description') || roles.has('item_no'));

  if (hasBoqRoles) {
    const hasRateAnalysis =
      roles.has('estimated_rate') &&
      !roles.has('quantity') &&
      roles.has('description');
    if (hasRateAnalysis) return 'rate_analysis';
    return 'boq_schedule';
  }

  return 'other';
}

export function detectTenderBoqType(
  rawText: string,
  tables: DetectedTable[],
): DetectedBoqType {
  for (const pattern of PERCENTAGE_RATE_PATTERNS) {
    if (pattern.test(rawText)) return 'percentage_rate';
  }

  const hasItemRateBoq = tables.some(t => {
    if (t.type !== 'boq_schedule' || !t.header) return false;
    const roles = new Set(Object.values(t.header.mapping));
    return roles.has('quantity') && roles.has('unit');
  });

  if (hasItemRateBoq) return 'item_rate';
  return 'unknown';
}
