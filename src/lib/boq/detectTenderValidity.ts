export interface ValidityDetectionResult {
  days: number | undefined;
  /** 0-100. Never a guess — undefined days with low confidence is the
   *  explicit default when no signal is found. */
  confidence: number;
  reason: string;
}

// Two genuinely different tender concepts, kept as separate detectors/fields
// rather than one combined "validity" — conflating them was itself a defect:
//   Bid Validity      — how long the SUBMITTED BID OFFER stays open before
//                        the tender can be awarded ("Bid Validity",
//                        "Tender Validity").
//   Completion Period — how long EXECUTING THE WORK takes once awarded
//                        ("Period of Completion", "Completion Period",
//                        "Contract Period", "Time for Completion", "Work
//                        Completion Time"). Both word orders are real —
//                        tender documents are inconsistent about this.
const BID_VALIDITY_RE =
  /(?:bid\s+validity|tender\s+validity)[^\d\n]{0,40}?(\d+)\s*(days?|months?|years?)/i;

const COMPLETION_PERIOD_RE =
  /(?:period\s+of\s+completion|completion\s+period|contract\s+period|time\s+for\s+completion|work\s+completion\s+(?:time|period))[^\d\n]{0,40}?(\d+)\s*(days?|months?|years?)/i;

// Secondary/weaker signal, Completion Period only: a bare number + unit
// against the AI's own execution_duration summary (already scoped to that
// one concept — too weak a pattern to trust against the full raw text).
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
export function detectBidValidity(rawText: string): ValidityDetectionResult {
  if (rawText && rawText.trim()) {
    const m = BID_VALIDITY_RE.exec(rawText);
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
  return { days: undefined, confidence: 30, reason: 'No Bid Validity / Tender Validity signal found' };
}

/**
 * Pure, text in → result out. Falls back to the AI's execution_duration
 * summary (weaker, capped lower) only when the raw tender text itself has
 * no explicit Completion Period signal.
 */
export function detectCompletionPeriod(
  rawText: string,
  executionDurationText?: string,
): ValidityDetectionResult {
  if (rawText && rawText.trim()) {
    const m = COMPLETION_PERIOD_RE.exec(rawText);
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

  return { days: undefined, confidence: 30, reason: 'No Completion Period / execution duration signal found' };
}
