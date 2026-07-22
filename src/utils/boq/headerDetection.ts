import type { TextRow, ColumnAnchor, ColumnMapping, ColumnRole, HeaderDetectionResult } from '../../types/boq';
import { snapToColumn } from './columnGrouping';

// ROLE = semantic function, not literal wording.
// "Particulars" and "DESCRIPTION" are both the description column.
// "Cost per unit" and "RATE" are both the unit rate column.
// "Total Cost" and "AMOUNT" are both the total-amount column.
// Add synonyms here when a new BOQ format uses unfamiliar column names.
const ROLE_PATTERNS: Record<ColumnRole, string[]> = {
  item_no: ['item no', 'sr no', 'sr', 'no', 'sno', 's no', 'item', '#', 'sl no', 'sl', 'seq no', 'serial no', 'item number', 'sr number', 'schedule item', 'itemno'],
  description: ['description', 'item description', 'particulars', 'work description', 'specification', 'details', 'name of work', 'nature of work', 'desc', 'item particulars'],
  unit: ['unit', 'uom', 'units', 'unit of measure', 'u m', 'uom'],
  quantity: ['quantity', 'qty', 'quantities', 'quantities estimated but may be more or less', 'nos', 'number', 'quantit', 'quantity in nos', 'qty nos'],
  code: ['code', 'item code', 'sor code', 'dsr code', 'work code', 'sor'],
  schedule: ['schedule', 'bill', 'chapter', 'section', 'part'],
  // "Cost per unit" / "Unit Cost" / "Rate per No" are all unit-rate columns
  estimated_rate: ['rate', 'estimated rate', 'basic rate', 'unit rate', 'sor rate', 'scheduled rate', 'dsr rate', 'rate per unit', 'market rate', 'est rate', 'cost per unit', 'unit cost', 'rate per no', 'cost per no', 'price per unit'],
  bid_rate: ['bid rate', 'quoted rate', 'offered rate', 'tendered rate', 'your rate', 'bidder rate', 'bid price', 'quoted price'],
  // "Total Cost" and "Total" are both the amount column; listed before bare "cost" so they
  // score 100 (exact match) and prevent "cost per unit" from accidentally mapping here.
  amount: ['amount', 'total amount', 'total cost', 'total', 'value', 'estimated amount', 'total value', 'est amount', 'cost'],
  gst: ['gst', 'tax', 'gst amount', 'cgst', 'sgst', 'igst', 'vat'],
  remarks: ['remarks', 'note', 'notes', 'observation', 'remark'],
  unknown: [],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return (1 - levenshtein(a, b) / maxLen) * 100;
}

export function detectRoleForText(text: string): { role: ColumnRole; score: number } {
  const norm = normalize(text);
  let bestRole: ColumnRole = 'unknown';
  let bestScore = 0;

  for (const [roleKey, patterns] of Object.entries(ROLE_PATTERNS)) {
    if (roleKey === 'unknown') continue;
    const role = roleKey as ColumnRole;

    for (const pattern of patterns) {
      let score = 0;
      if (norm === pattern) {
        score = 100;
      } else if (norm.startsWith(pattern) || pattern.startsWith(norm)) {
        score = 92;
      } else if (norm.includes(pattern) || pattern.includes(norm)) {
        score = 85;
      } else {
        const sim = levenshteinSimilarity(norm, pattern);
        if (sim >= 60) {
          score = sim;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestRole = role;
      }
    }
  }

  if (bestScore < 60) {
    return { role: 'unknown', score: 0 };
  }
  return { role: bestRole, score: bestScore };
}

export function detectHeader(rows: TextRow[], columns: ColumnAnchor[]): HeaderDetectionResult | null {
  const scanCount = Math.min(20, rows.length);
  let bestResult: HeaderDetectionResult | null = null;
  let bestScore = 0;

  for (let ri = 0; ri < scanCount; ri++) {
    const row = rows[ri];
    const mapping: ColumnMapping = {};
    const scores: number[] = [];
    const assignedRoles = new Set<ColumnRole>();

    for (const block of row.blocks) {
      const colIdx = snapToColumn(block.x, columns);
      const { role, score } = detectRoleForText(block.text);
      if (role !== 'unknown' && !assignedRoles.has(role)) {
        if (!mapping[colIdx] || score > (scores[colIdx] ?? 0)) {
          mapping[colIdx] = role;
          scores[colIdx] = score;
          assignedRoles.add(role);
        }
      }
    }

    const mappedCount = Object.keys(mapping).length;
    if (mappedCount < 2) continue;

    const avgScore = scores.filter(Boolean).reduce((s, v) => s + v, 0) / scores.filter(Boolean).length;
    const coverageRatio = mappedCount / Math.max(columns.length, 1);
    const confidence = avgScore * 0.6 + coverageRatio * 100 * 0.4;

    if (confidence > bestScore) {
      bestScore = confidence;
      bestResult = {
        headerRowIndex: ri,
        mapping,
        confidence: Math.min(100, confidence),
        mappedCount,
        totalColumns: columns.length,
      };
    }
  }

  return bestResult;
}

export function isRepeatedHeader(row: TextRow, knownHeader: HeaderDetectionResult & { headerText: string }): boolean {
  const rowNorm = normalize(row.blocks.map(b => b.text).join(' '));
  const headerNorm = normalize(knownHeader.headerText);
  if (rowNorm === headerNorm) return true;
  return levenshteinSimilarity(rowNorm, headerNorm) >= 80;
}
