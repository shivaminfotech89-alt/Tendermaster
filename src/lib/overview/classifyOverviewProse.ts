// Expanded Tender Overview — best-effort classification of already-extracted
// prose (cons_and_risks / pros / compliance_matrix) into the new detail
// sections (Penalty/LD, Price Variation, Payment Terms, Blacklisting,
// Warranty, Evaluation, Subcontracting) and highlight buckets
// (Financial/Technical/Qualification). Nothing here calls the AI or reads
// Firestore — pure, deterministic keyword matching only.
//
// IMPORTANT: callers must run this against the BASE (untranslated)
// `project.details`, never against `displayDetails` — matching must be
// language-independent of the UI's current i18n.language. The returned
// indices are then used to look up the (possibly translated) text in
// `displayDetails` at render time, which is safe because the translator
// (analysisTranslation.ts) guarantees identical array length/order for
// cons_and_risks/pros/compliance_matrix.

export type ProseField = "cons_and_risks" | "pros";

export interface ProseMatch {
  field: ProseField;
  index: number;
}

function norm(s: unknown): string {
  return typeof s === "string" ? ` ${s.toLowerCase()} ` : "";
}

function textMatches(text: string, keywords: string[]): boolean {
  const t = norm(text);
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

/** Scans cons_and_risks + pros (in that order) for any keyword match,
 *  returning field+index refs so callers can resolve display text against
 *  either the base or translated details object at the same position. */
export function findProseMatches(
  details: any,
  keywords: string[],
): ProseMatch[] {
  const cons: string[] = Array.isArray(details?.tender_simplified?.cons_and_risks)
    ? details.tender_simplified.cons_and_risks
    : [];
  const pros: string[] = Array.isArray(details?.tender_simplified?.pros)
    ? details.tender_simplified.pros
    : [];

  const matches: ProseMatch[] = [];
  cons.forEach((text, index) => {
    if (textMatches(text, keywords)) matches.push({ field: "cons_and_risks", index });
  });
  pros.forEach((text, index) => {
    if (textMatches(text, keywords)) matches.push({ field: "pros", index });
  });
  return matches;
}

/** Resolves a ProseMatch against a (possibly translated) details object. */
export function resolveProseMatch(match: ProseMatch, details: any): string {
  const arr = match.field === "cons_and_risks"
    ? details?.tender_simplified?.cons_and_risks
    : details?.tender_simplified?.pros;
  return typeof arr?.[match.index] === "string" ? arr[match.index] : "";
}

export const PENALTY_LD_KEYWORDS = [
  "penalty", "penalties", "liquidated damages", " ld clause", " ld @", " ld of",
  "delay damages", "compensation for delay", "deduction for delay",
];

export const PRICE_VARIATION_KEYWORDS = [
  "price variation", "price escalation", "escalation clause", "pvc",
  "rate variation", "cost escalation", "index-linked", "index linked",
  "variation in price", "wpi", "price adjustment",
];

export const PAYMENT_TERMS_KEYWORDS = [
  "payment terms", "payment schedule", "running account", "ra bill",
  "milestone payment", "advance payment", "mobilization advance",
  "mobilisation advance", "payment within", "payment shall be made",
];

export const BLACKLISTING_KEYWORDS = [
  "blacklist", "debar", "disqualif", "banned", "suspension of contractor",
  "termination of contract",
];

export const WARRANTY_KEYWORDS = [
  "warranty", "defect liability", " dlp ", "maintenance period",
  "guarantee period", "defects liability",
];

export const EVALUATION_KEYWORDS = [
  "evaluation criteria", "bid scoring", "technical scoring",
  "marking scheme", "qcbs", " l1 ", "lowest bidder", "point system",
  "weightage", "scoring methodology",
];

export const SUBCONTRACTING_KEYWORDS = [
  "subcontract", "sub-contract", "sub contract", "consortium",
  "joint venture", " jv ",
];

export type HighlightBucket = "financial" | "technical" | "qualification";

const FINANCIAL_BUCKET_KEYWORDS = [
  "turnover", "net worth", "financial capacity", "solvency",
  "working capital", "balance sheet", "annual turnover",
  "financial standing", "average annual",
];

const TECHNICAL_BUCKET_KEYWORDS = [
  "similar work", "technical capacity", "equipment", "manpower",
  "experience of", "completion certificate", "technical qualification",
  "plant and machinery", "key personnel", "similar nature",
];

/** Compliance-matrix requirements aren't tagged by category today, so this
 *  buckets by keyword; anything unmatched defaults to "qualification" since
 *  the field's own purpose ("Key eligibility ... requirements") skews that
 *  way — see compliance_matrix_subtitle in i18n.ts. */
export function bucketComplianceRequirement(requirement: string): HighlightBucket {
  const r = (requirement || "").toLowerCase();
  if (FINANCIAL_BUCKET_KEYWORDS.some((k) => r.includes(k))) return "financial";
  if (TECHNICAL_BUCKET_KEYWORDS.some((k) => r.includes(k))) return "technical";
  return "qualification";
}
