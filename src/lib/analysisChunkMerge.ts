// Deterministic merge of N per-chunk analysis results into ONE result with
// the exact same shape a single Tier-1 call produces. Pure functions, no
// Firestore/network access — every rule here is explicit and non-AI by
// design (see the Large Tender Engine Step C plan): an AI "reconciliation"
// call could hallucinate a scalar value present in no chunk, which is
// unacceptable for money-adjacent fields like tender_value/score that the
// Financial Engine reads downstream. Do not add an AI call here.

import { ANALYSIS_RESPONSE_SCHEMA } from "./analysisPrompt";

// ---------------------------------------------------------------------------
// Small helpers — each implements exactly one merge rule, reused across
// fields that share it.
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function firstNonNull<T>(values: (T | null | undefined)[]): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function firstNonEmptyString(values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (isNonEmptyString(v)) return v;
  }
  return null;
}

/** emd_details fields use "Not specified" as an explicit non-value sentinel
 *  — prefer a real value over it, but still surface "Not specified" (over
 *  nothing at all) if that's genuinely the best any chunk offered. */
function firstRealOrSentinel(values: (string | null | undefined)[], sentinel: string): string | null {
  for (const v of values) {
    if (isNonEmptyString(v) && v.trim().toLowerCase() !== sentinel.toLowerCase()) return v;
  }
  return firstNonEmptyString(values);
}

function longestString(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (isNonEmptyString(v) && (!best || v.length > best.length)) best = v;
  }
  return best;
}

function parseDateSafe(v: unknown): Date | null {
  if (!isNonEmptyString(v)) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Earliest parseable date among the values; if none parse as real dates
 *  (e.g. every chunk said "None scheduled"), falls back to the first
 *  non-empty string so the field is never just dropped. */
function earliestDateString(values: (string | null | undefined)[]): string | null {
  let bestStr: string | null = null;
  let bestDate: Date | null = null;
  for (const v of values) {
    const d = parseDateSafe(v);
    if (d && (!bestDate || d < bestDate)) {
      bestDate = d;
      bestStr = v as string;
    }
  }
  return bestStr ?? firstNonEmptyString(values);
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

function bestBoqTypeConfidence(entries: { type: string; confidence: string }[]): { type: string; confidence: string } {
  let best = { type: "unknown", confidence: "unknown" };
  let bestRank = -1;
  for (const e of entries) {
    const rank = CONFIDENCE_RANK[(e.confidence || "unknown").toLowerCase()] ?? 0;
    if (e.type && e.type !== "unknown" && rank > bestRank) {
      bestRank = rank;
      best = e;
    }
  }
  return best;
}

/** Exact/near-string dedupe (case/whitespace-insensitive) — no AI, no
 *  semantic similarity, deliberately simple and predictable. */
function dedupeStrings(items: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!isNonEmptyString(item)) continue;
    const key = item.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function dedupeObjectArray<T extends Record<string, any>>(items: T[], keyFields: string[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = keyFields.map(f => String(item[f] ?? "").trim().toLowerCase()).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** financial_values dedup: keyed on the full tagged label + value_number,
 *  so a "[Schedule Total] ..." entry and a "[Tender Notice Value] ..."
 *  entry for the SAME number are correctly kept as distinct (they mean
 *  different things), while a genuinely repeated entry (same tag, same
 *  figure, seen in two overlapping chunks) collapses to one. */
function dedupeFinancialValues(items: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = `${String(item.label ?? "").trim().toLowerCase()}|${item.value_number ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Recomputed against the MERGED array (never copied from any single
 *  chunk's own index, which would be meaningless post-merge) — same
 *  [Schedule Total]-tag preference already used by the prompt / BOQSection's
 *  own candidate-selection logic, not a new rule invented here. */
function pickScheduleIndex(financialValues: any[]): number {
  const idx = financialValues.findIndex(v => typeof v?.label === "string" && v.label.startsWith("[Schedule Total]"));
  return idx >= 0 ? idx : 0;
}

// ---------------------------------------------------------------------------
// Main merge function
// ---------------------------------------------------------------------------

/** Merges N per-chunk analysis results (each already conforming to
 *  ANALYSIS_RESPONSE_SCHEMA, with out-of-scope fields as null/empty per the
 *  chunk prompt's instructions) into ONE result with the identical shape.
 *  Every field rule is deterministic — see the Step C plan for the
 *  rationale on each. `chunkResults` should be in chunk-index order; ties
 *  in "first non-null"/"richest chunk" rules resolve by that order. */
export function mergeChunkResults(chunkResults: unknown[]): any {
  const results = chunkResults.filter((r): r is Record<string, any> => !!r && typeof r === "object");

  // compatibility.score — MIN of non-null scores (conservative: one chunk
  // surfacing a real problem should dominate, not get averaged away).
  // rationale comes from the SAME chunk as the min, keeping the pair
  // coherent rather than mixing an unrelated chunk's explanation in.
  const compatEntries = results
    .map(r => ({ score: r?.compatibility?.score, rationale: r?.compatibility?.rationale }))
    .filter((e): e is { score: number; rationale: any } => typeof e.score === "number");
  const compatibility = compatEntries.length > 0
    ? (() => {
        const min = compatEntries.reduce((a, b) => (b.score < a.score ? b : a));
        return { score: min.score, rationale: isNonEmptyString(min.rationale) ? min.rationale : "" };
      })()
    : { score: 0, rationale: "" };

  // winning_probability — identical MIN-pairing rule.
  const wpEntries = results
    .map(r => ({ score: r?.winning_probability?.score, recommended_action: r?.winning_probability?.recommended_action }))
    .filter((e): e is { score: number; recommended_action: any } => typeof e.score === "number");
  const winning_probability = wpEntries.length > 0
    ? (() => {
        const min = wpEntries.reduce((a, b) => (b.score < a.score ? b : a));
        return { score: min.score, recommended_action: isNonEmptyString(min.recommended_action) ? min.recommended_action : "" };
      })()
    : { score: 0, recommended_action: "" };

  // bid_recommendation — atomic whole object (never merged field-by-field,
  // which could produce a self-contradictory bundle e.g. aggressive <
  // conservative) — taken from whichever chunk has the most
  // boq_details.financial_values entries (richest schedule-derived
  // context), tie-broken by chunk order.
  let bestBidRecIdx = -1;
  let bestBidRecCount = -1;
  results.forEach((r, i) => {
    const count = Array.isArray(r?.boq_details?.financial_values) ? r.boq_details.financial_values.length : 0;
    if (r?.bid_recommendation && count > bestBidRecCount) {
      bestBidRecCount = count;
      bestBidRecIdx = i;
    }
  });
  const bid_recommendation = bestBidRecIdx >= 0
    ? results[bestBidRecIdx].bid_recommendation
    : (firstNonNull(results.map(r => r?.bid_recommendation)) ?? {
        estimated_value: "", conservative: "", safe_range: "", recommended: "",
        aggressive: "", margin_range: "", risk_level: "", rationale: "",
      });

  const tender_simplified = {
    tender_name: firstNonEmptyString(results.map(r => r?.tender_simplified?.tender_name)) ?? "",
    tender_number: firstNonEmptyString(results.map(r => r?.tender_simplified?.tender_number)) ?? "",
    authority_name: firstNonEmptyString(results.map(r => r?.tender_simplified?.authority_name)) ?? "",
    tender_value: firstNonEmptyString(results.map(r => r?.tender_simplified?.tender_value)) ?? "",
    is_active: firstNonNull(results.map(r => r?.tender_simplified?.is_active)) ?? true,
    scope_of_work: longestString(results.map(r => r?.tender_simplified?.scope_of_work)) ?? "",
    pros: dedupeStrings(results.flatMap(r => (Array.isArray(r?.tender_simplified?.pros) ? r.tender_simplified.pros : []))),
    cons_and_risks: dedupeStrings(results.flatMap(r => (Array.isArray(r?.tender_simplified?.cons_and_risks) ? r.tender_simplified.cons_and_risks : []))),
  };

  const timeline_and_milestones = {
    pre_bid_meeting: earliestDateString(results.map(r => r?.timeline_and_milestones?.pre_bid_meeting)) ?? "",
    clarification_deadline: earliestDateString(results.map(r => r?.timeline_and_milestones?.clarification_deadline)) ?? "",
    submission_deadline: earliestDateString(results.map(r => r?.timeline_and_milestones?.submission_deadline)) ?? "",
    execution_duration: firstNonEmptyString(results.map(r => r?.timeline_and_milestones?.execution_duration)) ?? "",
  };

  const required_documents_checklist = dedupeObjectArray(
    results.flatMap(r => (Array.isArray(r?.required_documents_checklist) ? r.required_documents_checklist : [])),
    ["document_name"],
  );
  const required_annexures = dedupeObjectArray(
    results.flatMap(r => (Array.isArray(r?.required_annexures) ? r.required_annexures : [])),
    ["annexure_name"],
  );
  const compliance_matrix = dedupeObjectArray(
    results.flatMap(r => (Array.isArray(r?.compliance_matrix) ? r.compliance_matrix : [])),
    ["requirement"],
  );

  const application_roadmap = {
    portal_source: firstNonEmptyString(results.map(r => r?.application_roadmap?.portal_source)) ?? "",
    next_immediate_steps: dedupeStrings(results.flatMap(r => (Array.isArray(r?.application_roadmap?.next_immediate_steps) ? r.application_roadmap.next_immediate_steps : []))),
    detailed_procedure_steps: dedupeStrings(results.flatMap(r => (Array.isArray(r?.application_roadmap?.detailed_procedure_steps) ? r.application_roadmap.detailed_procedure_steps : []))),
    winning_strategy_tips: dedupeStrings(results.flatMap(r => (Array.isArray(r?.application_roadmap?.winning_strategy_tips) ? r.application_roadmap.winning_strategy_tips : []))),
  };

  const financial_estimate = {
    material_costs: dedupeObjectArray(
      results.flatMap(r => (Array.isArray(r?.financial_estimate?.material_costs) ? r.financial_estimate.material_costs : [])),
      ["item"],
    ),
    labour_costs: dedupeObjectArray(
      results.flatMap(r => (Array.isArray(r?.financial_estimate?.labour_costs) ? r.financial_estimate.labour_costs : [])),
      ["role"],
    ),
    total_estimated_cost: firstNonEmptyString(results.map(r => r?.financial_estimate?.total_estimated_cost)) ?? "",
  };

  const emd_details = {
    amount: firstRealOrSentinel(results.map(r => r?.emd_details?.amount), "Not specified") ?? "Not specified",
    mode: firstNonEmptyString(results.map(r => r?.emd_details?.mode)) ?? "",
    msme_exemption: firstNonNull(results.map(r => r?.emd_details?.msme_exemption)) ?? false,
  };

  const boqEntries = results
    .map(r => ({ type: r?.boq_details?.boq_type, confidence: r?.boq_details?.boq_type_confidence }))
    .filter((e): e is { type: string; confidence: string } => isNonEmptyString(e.type));
  const bestBoq = bestBoqTypeConfidence(boqEntries);
  const mergedFinancialValues = dedupeFinancialValues(
    results.flatMap(r => (Array.isArray(r?.boq_details?.financial_values) ? r.boq_details.financial_values : [])),
  );
  const boq_details = {
    boq_type: bestBoq.type,
    boq_type_confidence: bestBoq.confidence,
    financial_values: mergedFinancialValues,
    suggested_estimated_index: pickScheduleIndex(mergedFinancialValues),
  };

  return {
    compatibility,
    tender_simplified,
    timeline_and_milestones,
    required_documents_checklist,
    required_annexures,
    application_roadmap,
    financial_estimate,
    bid_recommendation,
    winning_probability,
    compliance_matrix,
    emd_details,
    boq_details,
  };
}

// ---------------------------------------------------------------------------
// Content-sanity backstop — validateAgainstAnalysisSchema (below) checks
// SHAPE only: every field has a schema-correct type/default, which a
// completely empty merge (mergeChunkResults([]), or every chunk result
// being empty/placeholder-only) passes cleanly — it's a valid, useless
// object. This catches specifically that case, so it can be rejected
// (status:'failed', no save, no credit) instead of silently succeeding as
// an empty "done" result.
//
// Requires FIVE independent signals to ALL be simultaneously empty/zero
// before flagging — never a single field alone — so a legitimately sparse
// real tender (e.g. missing annexures, or no BOQ line items extracted)
// is never a false positive: a real tender document virtually always has
// at least a tender name or scope-of-work string, so needing every one of
// these five to be empty at once is a strong "there is nothing here"
// signal, not a "this tender happens to be short" one.
// ---------------------------------------------------------------------------

export function hasNoMeaningfulContent(details: any): boolean {
  const noTenderName = !isNonEmptyString(details?.tender_simplified?.tender_name);
  const noScope = !isNonEmptyString(details?.tender_simplified?.scope_of_work);
  const zeroScore = typeof details?.compatibility?.score !== "number" || details.compatibility.score === 0;
  const noDocsChecklist = !Array.isArray(details?.required_documents_checklist) || details.required_documents_checklist.length === 0;
  const noFinancialValues = !Array.isArray(details?.boq_details?.financial_values) || details.boq_details.financial_values.length === 0;
  return noTenderName && noScope && zeroScore && noDocsChecklist && noFinancialValues;
}

// ---------------------------------------------------------------------------
// Schema-validation gate — walks ANALYSIS_RESPONSE_SCHEMA's own
// type/properties/required/items structure (the SAME schema object Gemini
// is contractually required to satisfy for both tiers) and checks the
// merged object conforms. Deliberately a small purpose-built walker, not a
// new JSON-Schema-spec dependency — this schema only ever uses
// type/properties/required/items/enum, so a full validator library would
// be more machinery than the actual need.
// ---------------------------------------------------------------------------

export function validateAgainstAnalysisSchema(value: unknown, schema: any = ANALYSIS_RESPONSE_SCHEMA, path = "details"): string[] {
  const errors: string[] = [];

  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path}: expected object, got ${Array.isArray(value) ? "array" : typeof value}`);
      return errors;
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) {
        errors.push(`${path}.${key}: missing required field`);
      }
    }
    for (const [key, subSchema] of Object.entries<any>(schema.properties ?? {})) {
      if (obj[key] !== undefined && obj[key] !== null) {
        errors.push(...validateAgainstAnalysisSchema(obj[key], subSchema, `${path}.${key}`));
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${typeof value}`);
      return errors;
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validateAgainstAnalysisSchema(item, schema.items, `${path}[${i}]`));
      });
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path}: expected string, got ${typeof value}`);
    else if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push(`${path}: "${value}" is not one of ${JSON.stringify(schema.enum)}`);
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || isNaN(value)) errors.push(`${path}: expected number, got ${typeof value}`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") errors.push(`${path}: expected boolean, got ${typeof value}`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Chunk criticality classification — decides the partial-failure policy for
// a chunk that ends up failing after its retry ceiling: financial_critical
// chunks can NEVER be skipped (the only escape hatch is abandoning the
// whole job — this is what protects the Financial Engine's pricing basis);
// eligibility_critical chunks block auto-proceed but CAN be explicitly
// skipped by an informed user decision; non_critical chunks can already be
// skipped automatically (approved base policy). A pure, deterministic
// keyword classifier — no AI — run once per chunk at planning time and
// stored on the chunk doc, never re-derived after a chunk has already
// failed (there would be no result left to inspect by then).
// ---------------------------------------------------------------------------

export type ChunkCriticality = "financial_critical" | "eligibility_critical" | "non_critical";

const FINANCIAL_CRITICAL_PATTERN = /\b(BOQ|BILL OF QUANTITIES|SCHEDULE[\s-]?B|SCHEDULE OF (QUANTITIES|RATES)|ESTIMATED (AMOUNT|COST)|TENDER VALUE|PRICE BID|FINANCIAL BID)\b/i;
const ELIGIBILITY_CRITICAL_PATTERN = /\b(ELIGIBILITY|EMD|EARNEST MONEY|SCOPE OF WORK|COMPLIANCE)\b/i;
const NON_CRITICAL_PATTERN = /\b(ANNEXURE|GENERAL CONDITIONS?(\s+OF\s+CONTRACT)?|DRAWINGS?|FORM[\s-]?[A-Z0-9]|DECLARATION|UNDERTAKING|CHECKLIST|INSTRUCTIONS?\s+TO\s+BIDDERS?|LETTER OF (TRANSMITTAL|AUTHORIZATION))\b/i;

/** Classifies one chunk's criticality from its (label + own text — a
 *  Level-2 text slice's own content already includes its section heading
 *  as its first line, so no separate heading-capture is needed). */
export function classifyChunkCriticality(input: {
  isImagePath: boolean;
  sourceLabel?: string | null;
  text?: string | null;
}): ChunkCriticality {
  // Rule (explicit, unconditional, not just an emergent consequence of the
  // ambiguous-default below): an image-path (scanned) chunk has NO
  // extracted text to scan — it could be the entire BOQ/price bid with no
  // text signal at all. It is NEVER classifiable as non-critical, and is
  // always financial_critical — the strictest tier, no "proceed without"
  // override possible — regardless of filename.
  if (input.isImagePath) return "financial_critical";

  const haystack = [input.sourceLabel, input.text].filter(Boolean).join(" \n ");
  if (FINANCIAL_CRITICAL_PATTERN.test(haystack)) return "financial_critical";
  if (NON_CRITICAL_PATTERN.test(haystack) && !ELIGIBILITY_CRITICAL_PATTERN.test(haystack)) return "non_critical";
  // Fail-safe default: anything ambiguous (including a genuine eligibility
  // keyword match) is critical-but-overridable, never silently
  // non-critical — the cost of wrongly defaulting to "safe to skip" is a
  // misleading result; the cost of wrongly defaulting to "needs review" is
  // an extra confirmation click.
  return "eligibility_critical";
}
