export interface ValidityDetectionResult {
  days: number | undefined;
  /** Exactly as written/detected, e.g. "12 Months", "2 Years" — what the UI
   *  should display. Built from the same number+unit match that produces
   *  `days`, never reverse-derived from `days` afterward (lossy/ambiguous:
   *  360 days could mean 12 months or 360 days). Undefined whenever `days`
   *  is undefined. */
  label: string | undefined;
  /** 0-100. Never a guess — undefined days with low confidence is the
   *  explicit default when no signal is found. */
  confidence: number;
  reason: string;
}

/**
 * Shared formatter — the one place a period gets turned into display text.
 * Used by both detectors below (at the point their own regex match still has
 * the original number+unit, before it's discarded) and by BOQSection.tsx's
 * manual Months/Years entry, so all three producers of a period label agree
 * on pluralization/casing.
 */
export function formatPeriodLabel(n: number, unit: 'days' | 'months' | 'years'): string {
  const singular = n === 1;
  if (unit === 'months') return `${n} ${singular ? 'Month' : 'Months'}`;
  if (unit === 'years') return `${n} ${singular ? 'Year' : 'Years'}`;
  return `${n} ${singular ? 'Day' : 'Days'}`;
}

function normalizeUnit(raw: string): 'days' | 'months' | 'years' {
  const u = raw.toLowerCase();
  if (u.startsWith('month')) return 'months';
  if (u.startsWith('year')) return 'years';
  return 'days';
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
      const unit = normalizeUnit(m[2]);
      const days = toDays(n, m[2]);
      return {
        days,
        label: formatPeriodLabel(n, unit),
        confidence: 90,
        reason: `Tender text: "${m[0].trim()}" — ${n} ${m[2]} (~${days} days)`,
      };
    }
  }
  return { days: undefined, label: undefined, confidence: 30, reason: 'No Bid Validity / Tender Validity signal found' };
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
      const unit = normalizeUnit(m[2]);
      const days = toDays(n, m[2]);
      return {
        days,
        label: formatPeriodLabel(n, unit),
        confidence: 90,
        reason: `Tender text: "${m[0].trim()}" — ${n} ${m[2]} (~${days} days)`,
      };
    }
  }

  if (executionDurationText && executionDurationText.trim()) {
    const m = NUMBER_UNIT_RE.exec(executionDurationText);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = normalizeUnit(m[2]);
      const days = toDays(n, m[2]);
      return {
        days,
        label: formatPeriodLabel(n, unit),
        confidence: 55,
        reason: `AI-summarized execution duration (capped lower — not a primary signal): "${executionDurationText.trim()}" — ${n} ${m[2]} (~${days} days)`,
      };
    }
  }

  return { days: undefined, label: undefined, confidence: 30, reason: 'No Completion Period / execution duration signal found' };
}
