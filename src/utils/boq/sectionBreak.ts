/** Configurable section-break patterns — no document-specific keywords. */

export interface SectionBreakPattern {
  re: RegExp;
  label: string;
  type: 'rate_analysis' | 'end_of_boq' | 'summary';
  /**
   * Optional word-count ceiling.  If the row text has MORE words than this
   * limit, the pattern is skipped even if it matches.
   *
   * Use this for patterns whose keywords legitimately appear inside long BOQ
   * item descriptions (e.g. "S.D.B.C.", "material cost") but only act as
   * section-break signals when they appear in a short standalone heading.
   */
  maxWords?: number;
}

export const DEFAULT_SECTION_BREAK_PATTERNS: SectionBreakPattern[] = [
  // Rate analysis tables — broad patterns, safe in any context
  { re: /\bra[-\s]?\d+\b/i,                      label: 'Rate Analysis',          type: 'rate_analysis' },
  { re: /\brate\s+analy/i,                        label: 'Rate Analysis text',     type: 'rate_analysis' },
  { re: /\bcost\s+aggregate\b/i,                  label: 'Cost Aggregate',         type: 'rate_analysis' },
  { re: /\banalysis\s+of\s+rates?\b/i,            label: 'Analysis of Rate',       type: 'rate_analysis' },
  // Narrowed patterns — only fire on short header rows (≤ 6 words) because
  // these keywords also appear inside legitimate BOQ item descriptions.
  { re: /\bs\.?d\.?b\.?c\b/i,                    label: 'SDBC',                   type: 'rate_analysis', maxWords: 6 },
  { re: /\bmaterial\s+cost\b/i,                   label: 'Material Cost table',    type: 'rate_analysis', maxWords: 6 },
  { re: /\blabou?r\s+cost\b/i,                    label: 'Labour Cost table',      type: 'rate_analysis', maxWords: 6 },
  { re: /\bmachinery\s+charge/i,                  label: 'Machinery Charges',      type: 'rate_analysis', maxWords: 6 },
  // End-of-BOQ sections
  { re: /\bterms\s+(?:and|&)\s+conditions\b/i,   label: 'Terms & Conditions',     type: 'end_of_boq' },
  { re: /\bgeneral\s+conditions\b/i,              label: 'General Conditions',     type: 'end_of_boq' },
  { re: /\bspecial\s+conditions\b/i,              label: 'Special Conditions',     type: 'end_of_boq' },
  { re: /\bscope\s+of\s+work\b/i,                label: 'Scope of Work',          type: 'end_of_boq' },
];

export interface SectionBreakMatch {
  label: string;
  type: string;
}

/**
 * Returns a match if `text` triggers a section-break, otherwise null.
 * Caller is responsible for only passing row-level text (not individual cell text).
 */
export function checkSectionBreak(
  text: string,
  patterns: SectionBreakPattern[] = DEFAULT_SECTION_BREAK_PATTERNS,
): SectionBreakMatch | null {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  for (const p of patterns) {
    if (p.maxWords !== undefined && wordCount > p.maxWords) continue;
    if (p.re.test(text)) return { label: p.label, type: p.type };
  }
  return null;
}
