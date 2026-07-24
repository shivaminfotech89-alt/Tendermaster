export interface TenderValidityDetectionResult {
  days: number | undefined;
  /** 0-100. Never a guess — undefined days with low confidence is the
   *  explicit default when no signal is found. */
  confidence: number;
  reason: string;
}

// Primary signal: the raw tender text itself. Matches a validity/period
// label followed (within a short gap tolerating filler words like "shall
// be" or "of") by a number + unit, e.g. "Bid Validity: 180 Days",
// "Contract Period of 6 (six) months", "Time for Completion — 1 Year".
const STRUCTURED_VALIDITY_RE =
  /(?:bid\s+validity|tender\s+validity|contract\s+period|completion\s+period|time\s+for\s+completion|work\s+completion\s+(?:time|period))[^\d\n]{0,40}?(\d+)\s*(days?|months?|years?)/i;

// Secondary/weaker signal: a bare number + unit, used only against the AI's
// own execution_duration summary (already scoped to that one concept), never
// against the full raw text — too weak a pattern to trust broadly there.
const NUMBER_UNIT_RE = /(\d+)\s*(days?|months?|years?)/i;

function toDays(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('month')) return n * 30;
  if (u.startsWith('year')) return n * 365;
  return n;
}

/**
 * Pure, text in → result out. Never guesses: absent signal always resolves
 * to days: undefined with low confidence, never a default duration.
 */
export function detectTenderValidity(
  rawText: string,
  executionDurationText?: string,
): TenderValidityDetectionResult {
  if (rawText && rawText.trim()) {
    const m = STRUCTURED_VALIDITY_RE.exec(rawText);
    if (m) {
      const n = parseInt(m[1], 10);
      const days = toDays(n, m[2]);
      return {
        days,
        confidence: 90,
        reason: `Tender text: "${m[0].trim()}" — ${n} ${m[2]} (~${days} days)`,
      };
    }
  }

  if (executionDurationText && executionDurationText.trim()) {
    const m = NUMBER_UNIT_RE.exec(executionDurationText);
    if (m) {
      const n = parseInt(m[1], 10);
      const days = toDays(n, m[2]);
      return {
        days,
        confidence: 55,
        reason: `AI-summarized execution duration (capped lower — not a primary signal): "${executionDurationText.trim()}" — ${n} ${m[2]} (~${days} days)`,
      };
    }
  }

  return { days: undefined, confidence: 30, reason: 'No tender validity / completion period signal found' };
}
