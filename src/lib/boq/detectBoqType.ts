import type { BOQType, BOQTypeConfidence } from './types';

export interface BoqTypeDetectionResult {
  type: BOQType;
  confidence: BOQTypeConfidence;
}

// Raw tender text patterns — boilerplate phrases in Indian govt percentage-rate tenders
const PCT_HIGH: RegExp[] = [
  /willing\s+to\s+carry\s+out(?:\s+the\s+work)?/i,
  /\d[\d,.]*\s*%\s*above\s+(?:the\s+)?(?:estimated|tendered|scheduled)/i,
  /\d[\d,.]*\s*%\s*below\s+(?:the\s+)?(?:estimated|tendered|scheduled)/i,
  /above\s*[/|&]\s*below\s+(?:the\s+)?(?:estimated|tendered)/i,
  /percentage\s+tender\b/i,
  /(?:add|deduct)\s+[\d.]+\s*%/i,
  /of\s+the\s+estimated\s+(?:rate|amount|cost)/i,
  /(?:above|below)\s+the\s+(?:estimated|scheduled)\s+(?:amount|cost|rate)/i,
  /quote\s+(?:a\s+)?percentage\s+(?:above|below)/i,
  /rate\s+@\s*[\d.]*\s*%\s*(?:above|below)/i,
];

// Phrases that appear in both raw text and AI-generated summaries
const PCT_MEDIUM: RegExp[] = [
  /percentage\s+rate/i,
  /\bsor\s+rate/i,
  /\bdsr\s+rate/i,
  /above\s*[/|]\s*below/i,
];

// Item-rate specific language — only flag when NO percentage-rate indicators found
const ITEM_RATE: RegExp[] = [
  /\bitem\s+rate\s+(?:tender|contract|bid)\b/i,
  /quote\s+(?:your\s+)?(?:unit\s+)?rates?\s+for\s+(?:each|the\s+following)/i,
  /(?:fill\s+in|enter|insert)\s+(?:your\s+)?(?:unit\s+)?rates?/i,
];

export function detectBoqTypeFromText(text: string): BoqTypeDetectionResult {
  if (!text || !text.trim()) return { type: 'unknown', confidence: 'low' };

  const highMatches = PCT_HIGH.filter(r => r.test(text));
  if (highMatches.length >= 2) return { type: 'percentage_rate', confidence: 'high' };
  if (highMatches.length === 1) return { type: 'percentage_rate', confidence: 'medium' };

  const medMatches = PCT_MEDIUM.filter(r => r.test(text));
  if (medMatches.length >= 2) return { type: 'percentage_rate', confidence: 'medium' };

  // Only classify as item_rate if ZERO percentage-rate signals
  if (medMatches.length === 0) {
    const itemMatches = ITEM_RATE.filter(r => r.test(text));
    if (itemMatches.length >= 1) return { type: 'item_rate', confidence: 'medium' };
  }

  return { type: 'unknown', confidence: 'low' };
}

// Scans the AI-generated analysis result text fields (works without raw PDF text)
export function detectBoqTypeFromAnalysis(analysisResult: unknown): BoqTypeDetectionResult {
  if (!analysisResult || typeof analysisResult !== 'object') {
    return { type: 'unknown', confidence: 'low' };
  }

  const r = analysisResult as Record<string, unknown>;

  const parts: string[] = [];

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const arr = (v: unknown): string => (Array.isArray(v) ? v.map(str).join(' ') : '');

  // Scope and rationale fields most likely to mention percentage/item rate
  const ts = r['tender_simplified'] as Record<string, unknown> | undefined;
  const br = r['bid_recommendation'] as Record<string, unknown> | undefined;
  const ar = r['application_roadmap'] as Record<string, unknown> | undefined;
  const compat = r['compatibility'] as Record<string, unknown> | undefined;

  parts.push(str(ts?.['scope_of_work']));
  parts.push(str(ts?.['authority_name']));
  parts.push(str(compat?.['rationale']));
  parts.push(str(br?.['rationale']));
  parts.push(str(br?.['estimated_value']));
  parts.push(arr(ts?.['pros']));
  parts.push(arr(ts?.['cons_and_risks']));
  parts.push(arr(ar?.['next_immediate_steps']));
  parts.push(arr(ar?.['winning_strategy_tips']));

  const combined = parts.filter(Boolean).join(' ');
  return detectBoqTypeFromText(combined);
}
