export type GstIncluded = 'yes' | 'no' | 'separate' | 'unknown';

export interface GstCessDetectionResult {
  gstIncluded: GstIncluded;
  cessRate?: number;
  gstRate?: number;
  /** 0-100. Never a guess — 'unknown' with low confidence is the explicit
   *  default when signal is absent or conflicting. */
  confidence: number;
  reason: string;
}

// ── Tier 1: structured labeled summary rows (Schedule-B style) ─────────────
// Verified against the real Schedule-B fixture's row-ordered extracted text:
//   "Total End cost without GST and cess in Rs. ... 58,42,000.00"
//   "Applicable Welfare Cess on total end cost in % ... 1%"
//   "Applicable Welfare Cess on total end cost in Rs. ... 58,420.00"
//   "Applicable GST and Cess on total end cost in % ... 18%"
//   "Applicable GST and Cess on total end cost in Rs. ... 10,62,075.60"
// The GST row's own label says "GST and Cess" (a quirk of the source form's
// wording) even though cess is already handled by the separate Welfare Cess
// rows — confirmed not double-counted: 59,00,420 × 18% = 10,62,075.60 exactly.
const STRUCTURED_SUBTOTAL_RE = /total\s+end\s+cost\s+without\s+gst[^\n]*?₹?\s*([\d,]+\.?\d*)/i;
const STRUCTURED_CESS_RATE_RE = /applicable\s+welfare\s+cess[^%\n]*?in\s*%[^\n]*?([\d.]+)\s*%/i;
const STRUCTURED_GST_RATE_RE = /applicable\s+gst[^%\n]*?in\s*%[^\n]*?([\d.]+)\s*%/i;

// ── Tier 2: prose-only mentions (Bareja style) ──────────────────────────────
// Verified against the real Bareja fixture's extracted text:
//   "Bidder has to quote rates without GST, GST will be applicable extra on
//    tender rate."
//   "The labour cess will be deducted as per prevailing rules i.e. 1% of the
//    work done."
const PROSE_GST_SEPARATE_RE = /quote\s+rates?\s+without\s+gst|gst\s+(?:will\s+be\s+)?(?:applicable|payable)\s+extra|exclusive\s+of\s+gst|gst\s+extra/i;
const PROSE_GST_INCLUDED_RE = /inclusive\s+of\s+gst|gst\s+included|rates?\s+(?:are|shall\s+be)\s+inclusive/i;
// Gap between "cess" and its rate spans filler phrases like "as per
// prevailing rules i.e." (~46 chars in the real Bareja text) — generous cap.
const PROSE_CESS_RATE_RE = /(?:labour|welfare)\s+cess[^%\n]{0,80}?([\d.]+)\s*%/i;

function parseNum(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/**
 * Pure, text in → result out. Never guesses: absent or conflicting signal
 * always resolves to gstIncluded: 'unknown' with low confidence, rather
 * than defaulting to any particular inclusion behavior.
 */
export function detectGstCess(rawText: string): GstCessDetectionResult {
  if (!rawText || !rawText.trim()) {
    return { gstIncluded: 'unknown', confidence: 30, reason: 'No text available to scan' };
  }

  // Tier 1 — structured labeled rows
  const subtotalMatch = STRUCTURED_SUBTOTAL_RE.exec(rawText);
  const structuredGstRateMatch = STRUCTURED_GST_RATE_RE.exec(rawText);
  const structuredCessRateMatch = STRUCTURED_CESS_RATE_RE.exec(rawText);

  if (subtotalMatch && structuredGstRateMatch) {
    const gstRate = parseNum(structuredGstRateMatch[1]);
    const cessRate = structuredCessRateMatch ? parseNum(structuredCessRateMatch[1]) : undefined;
    return {
      gstIncluded: 'separate',
      gstRate,
      cessRate,
      confidence: 95,
      reason: `Structured summary table: "Total End cost without GST"${cessRate !== undefined ? ` + Welfare Cess ${cessRate}%` : ''} + GST ${gstRate}% — all explicitly labeled`,
    };
  }

  // Tier 2 — prose only
  const proseSeparate = PROSE_GST_SEPARATE_RE.test(rawText);
  const proseIncluded = PROSE_GST_INCLUDED_RE.test(rawText);
  const proseCessMatch = PROSE_CESS_RATE_RE.exec(rawText);
  const cessRate = proseCessMatch ? parseNum(proseCessMatch[1]) : undefined;

  if (proseSeparate && proseIncluded) {
    // Conflicting signals — never guess which one wins.
    return {
      gstIncluded: 'unknown',
      cessRate,
      confidence: 35,
      reason: 'Conflicting GST inclusion statements found in tender text',
    };
  }

  if (proseSeparate) {
    return {
      gstIncluded: 'separate',
      cessRate,
      confidence: cessRate !== undefined ? 75 : 65,
      reason: `Tender text states GST is charged separately/extra${cessRate !== undefined ? `; cess rate ${cessRate}% found` : '; no explicit GST rate stated'}`,
    };
  }

  if (proseIncluded) {
    return {
      gstIncluded: 'yes',
      cessRate,
      confidence: 70,
      reason: 'Tender text states rates are inclusive of GST',
    };
  }

  if (cessRate !== undefined) {
    return {
      gstIncluded: 'unknown',
      cessRate,
      confidence: 40,
      reason: `Cess rate ${cessRate}% found, but no GST inclusion statement`,
    };
  }

  return { gstIncluded: 'unknown', confidence: 30, reason: 'No GST/cess signal found in tender text' };
}
