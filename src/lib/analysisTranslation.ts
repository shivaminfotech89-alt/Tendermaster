// Fix 1 (Language Rendering) — deterministic prose-only translation of a
// stored analysis, for DISPLAY purposes only. Every function here is pure
// (no Firestore/network access — server.ts owns the actual Gemini call and
// caching), mirroring the same "extract → AI call on a narrow slice →
// deterministic merge-back → validate" philosophy analysisChunkMerge.ts
// already established for Tier-2: never trust a model's output to
// determine anything beyond the exact narrow slice it was given.
//
// SCOPE — view-only. The fields below are the COMPLETE set ever sent to
// the translation model. Everything else in a stored `details` object
// (every enum, every tag-prefixed label, every number, every date, the
// entire boq_details subtree) is copied through byte-identical by
// mergeTranslatedProse, never touched, and explicitly re-verified by
// validateTranslationPreservesStructure after every merge. This is the
// guarantee the Financial Engine's pricing-basis selection depends on
// (boq_details.financial_values[].label's [Schedule Total] tag) — see the
// Phase 1 classification this was designed against.

export interface ProseTranslationPayload {
  compatibility_rationale: string;
  scope_of_work: string;
  pros: string[];
  cons_and_risks: string[];
  next_immediate_steps: string[];
  detailed_procedure_steps: string[];
  winning_strategy_tips: string[];
  bid_recommendation_rationale: string;
  winning_probability_recommended_action: string;
  required_documents_checklist_context: string[];
  required_annexures_purpose: string[];
  material_costs_rationale: string[];
  labour_costs_rationale: string[];
  compliance_matrix_notes: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str) : [];
}

/** Pulls ONLY the prose-classified fields out of a stored `details` object
 *  — the exact and complete list from the Phase 1 trace. Nothing else in
 *  `details` is ever read by the translation call. */
export function extractProseFields(details: any): ProseTranslationPayload {
  return {
    compatibility_rationale: str(details?.compatibility?.rationale),
    scope_of_work: str(details?.tender_simplified?.scope_of_work),
    pros: strArr(details?.tender_simplified?.pros),
    cons_and_risks: strArr(details?.tender_simplified?.cons_and_risks),
    next_immediate_steps: strArr(details?.application_roadmap?.next_immediate_steps),
    detailed_procedure_steps: strArr(details?.application_roadmap?.detailed_procedure_steps),
    winning_strategy_tips: strArr(details?.application_roadmap?.winning_strategy_tips),
    bid_recommendation_rationale: str(details?.bid_recommendation?.rationale),
    winning_probability_recommended_action: str(details?.winning_probability?.recommended_action),
    required_documents_checklist_context: (Array.isArray(details?.required_documents_checklist) ? details.required_documents_checklist : []).map((d: any) => str(d?.context)),
    required_annexures_purpose: (Array.isArray(details?.required_annexures) ? details.required_annexures : []).map((d: any) => str(d?.purpose)),
    material_costs_rationale: (Array.isArray(details?.financial_estimate?.material_costs) ? details.financial_estimate.material_costs : []).map((d: any) => str(d?.rationale)),
    labour_costs_rationale: (Array.isArray(details?.financial_estimate?.labour_costs) ? details.financial_estimate.labour_costs : []).map((d: any) => str(d?.rationale)),
    compliance_matrix_notes: (Array.isArray(details?.compliance_matrix) ? details.compliance_matrix : []).map((d: any) => str(d?.notes)),
  };
}

export const PROSE_TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    compatibility_rationale: { type: "string" },
    scope_of_work: { type: "string" },
    pros: { type: "array", items: { type: "string" } },
    cons_and_risks: { type: "array", items: { type: "string" } },
    next_immediate_steps: { type: "array", items: { type: "string" } },
    detailed_procedure_steps: { type: "array", items: { type: "string" } },
    winning_strategy_tips: { type: "array", items: { type: "string" } },
    bid_recommendation_rationale: { type: "string" },
    winning_probability_recommended_action: { type: "string" },
    required_documents_checklist_context: { type: "array", items: { type: "string" } },
    required_annexures_purpose: { type: "array", items: { type: "string" } },
    material_costs_rationale: { type: "array", items: { type: "string" } },
    labour_costs_rationale: { type: "array", items: { type: "string" } },
    compliance_matrix_notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "compatibility_rationale", "scope_of_work", "pros", "cons_and_risks",
    "next_immediate_steps", "detailed_procedure_steps", "winning_strategy_tips",
    "bid_recommendation_rationale", "winning_probability_recommended_action",
    "required_documents_checklist_context", "required_annexures_purpose",
    "material_costs_rationale", "labour_costs_rationale", "compliance_matrix_notes",
  ],
};

const LANGUAGE_NAMES: Record<string, string> = { hi: "Hindi", gu: "Gujarati", en: "English" };

export function buildTranslationSystemInstruction(language: string): string {
  const languageName = LANGUAGE_NAMES[language] ?? language;
  return `You are a professional translator working on a tender-bidding analysis report. You will receive a JSON object whose values are ONLY narrative/descriptive text — rationales, summaries, recommended actions, risk notes, procedural steps — extracted from a larger report. Translate every string (and every string inside every array) into ${languageName}, preserving the professional tone and exact meaning. Do not translate numbers, currency symbols, or technical codes/reference numbers that happen to appear inside a sentence — translate the surrounding language and leave those tokens as written. Return a JSON object with the EXACT SAME KEYS as the input, and for every array field, the EXACT SAME NUMBER OF ELEMENTS in the EXACT SAME ORDER — never add, remove, merge, split, or reorder entries, and never omit a key even if its value is an empty string or empty array in the input.`;
}

/** Verifies that `merged` differs from `original` in ONLY the prose fields
 *  extractProseFields ever pulls — every other value (scores, enums, dates,
 *  identifiers, the entire boq_details subtree with its [Schedule Total]/
 *  [Tender Notice Value] tags) must be byte-identical. This is a direct,
 *  hand-written mirror of mergeTranslatedProse's own construction (clone +
 *  targeted overlay), run as an explicit defense-in-depth gate rather than
 *  just trusted implicitly — same fail-safe philosophy as the Tier-2
 *  content-sanity gate: prove it, don't assume it. */
export function validateTranslationPreservesStructure(original: any, merged: any): string[] {
  const errors: string[] = [];
  const eq = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${path}: non-prose value changed`);
  };

  eq(original?.compatibility?.score, merged?.compatibility?.score, "compatibility.score");
  eq(original?.tender_simplified?.tender_name, merged?.tender_simplified?.tender_name, "tender_simplified.tender_name");
  eq(original?.tender_simplified?.tender_number, merged?.tender_simplified?.tender_number, "tender_simplified.tender_number");
  eq(original?.tender_simplified?.authority_name, merged?.tender_simplified?.authority_name, "tender_simplified.authority_name");
  eq(original?.tender_simplified?.tender_value, merged?.tender_simplified?.tender_value, "tender_simplified.tender_value");
  eq(original?.tender_simplified?.is_active, merged?.tender_simplified?.is_active, "tender_simplified.is_active");
  eq(original?.timeline_and_milestones, merged?.timeline_and_milestones, "timeline_and_milestones");

  const origDocs = Array.isArray(original?.required_documents_checklist) ? original.required_documents_checklist : [];
  eq(origDocs.length, (merged?.required_documents_checklist ?? []).length, "required_documents_checklist.length");
  origDocs.forEach((item: any, i: number) => {
    eq(item?.document_name, merged?.required_documents_checklist?.[i]?.document_name, `required_documents_checklist[${i}].document_name`);
    eq(item?.status, merged?.required_documents_checklist?.[i]?.status, `required_documents_checklist[${i}].status`);
  });

  const origAnnex = Array.isArray(original?.required_annexures) ? original.required_annexures : [];
  eq(origAnnex.length, (merged?.required_annexures ?? []).length, "required_annexures.length");
  origAnnex.forEach((item: any, i: number) => {
    eq(item?.annexure_name, merged?.required_annexures?.[i]?.annexure_name, `required_annexures[${i}].annexure_name`);
    eq(item?.filling_complexity, merged?.required_annexures?.[i]?.filling_complexity, `required_annexures[${i}].filling_complexity`);
  });

  eq(original?.application_roadmap?.portal_source, merged?.application_roadmap?.portal_source, "application_roadmap.portal_source");

  const origMaterial = Array.isArray(original?.financial_estimate?.material_costs) ? original.financial_estimate.material_costs : [];
  eq(origMaterial.length, (merged?.financial_estimate?.material_costs ?? []).length, "financial_estimate.material_costs.length");
  origMaterial.forEach((item: any, i: number) => {
    eq(item?.item, merged?.financial_estimate?.material_costs?.[i]?.item, `financial_estimate.material_costs[${i}].item`);
    eq(item?.estimated_cost, merged?.financial_estimate?.material_costs?.[i]?.estimated_cost, `financial_estimate.material_costs[${i}].estimated_cost`);
  });

  const origLabour = Array.isArray(original?.financial_estimate?.labour_costs) ? original.financial_estimate.labour_costs : [];
  eq(origLabour.length, (merged?.financial_estimate?.labour_costs ?? []).length, "financial_estimate.labour_costs.length");
  origLabour.forEach((item: any, i: number) => {
    eq(item?.role, merged?.financial_estimate?.labour_costs?.[i]?.role, `financial_estimate.labour_costs[${i}].role`);
    eq(item?.estimated_cost, merged?.financial_estimate?.labour_costs?.[i]?.estimated_cost, `financial_estimate.labour_costs[${i}].estimated_cost`);
  });
  eq(original?.financial_estimate?.total_estimated_cost, merged?.financial_estimate?.total_estimated_cost, "financial_estimate.total_estimated_cost");

  eq(original?.bid_recommendation?.estimated_value, merged?.bid_recommendation?.estimated_value, "bid_recommendation.estimated_value");
  eq(original?.bid_recommendation?.conservative, merged?.bid_recommendation?.conservative, "bid_recommendation.conservative");
  eq(original?.bid_recommendation?.safe_range, merged?.bid_recommendation?.safe_range, "bid_recommendation.safe_range");
  eq(original?.bid_recommendation?.recommended, merged?.bid_recommendation?.recommended, "bid_recommendation.recommended");
  eq(original?.bid_recommendation?.aggressive, merged?.bid_recommendation?.aggressive, "bid_recommendation.aggressive");
  eq(original?.bid_recommendation?.margin_range, merged?.bid_recommendation?.margin_range, "bid_recommendation.margin_range");
  eq(original?.bid_recommendation?.risk_level, merged?.bid_recommendation?.risk_level, "bid_recommendation.risk_level");

  eq(original?.winning_probability?.score, merged?.winning_probability?.score, "winning_probability.score");

  const origMatrix = Array.isArray(original?.compliance_matrix) ? original.compliance_matrix : [];
  eq(origMatrix.length, (merged?.compliance_matrix ?? []).length, "compliance_matrix.length");
  origMatrix.forEach((item: any, i: number) => {
    eq(item?.requirement, merged?.compliance_matrix?.[i]?.requirement, `compliance_matrix[${i}].requirement`);
    eq(item?.status, merged?.compliance_matrix?.[i]?.status, `compliance_matrix[${i}].status`);
  });

  eq(original?.emd_details, merged?.emd_details, "emd_details");
  // Whole-subtree deep-equality — the single highest-stakes check here:
  // this is where the [Schedule Total]/[Tender Notice Value] tags the
  // Financial Engine's pricing-basis selection depends on live.
  eq(original?.boq_details, merged?.boq_details, "boq_details");

  return errors;
}

/** Deep-clones `original`, overlays ONLY the translated prose fields onto
 *  the clone, and validates the result. Rejects (returns `original`
 *  unchanged, with `errors`) if the model returned mismatched array
 *  lengths OR if the post-merge structural check finds anything outside
 *  the prose fields changed — same fail-safe philosophy as the Tier-2
 *  content gate: never cache/serve a result that isn't provably safe. */
export function mergeTranslatedProse(
  original: any,
  translated: ProseTranslationPayload,
): { details: any; errors: string[] } {
  const errors: string[] = [];

  const origPros = original?.tender_simplified?.pros ?? [];
  const origCons = original?.tender_simplified?.cons_and_risks ?? [];
  const origNextSteps = original?.application_roadmap?.next_immediate_steps ?? [];
  const origProcSteps = original?.application_roadmap?.detailed_procedure_steps ?? [];
  const origTips = original?.application_roadmap?.winning_strategy_tips ?? [];
  const origDocsChecklist = original?.required_documents_checklist ?? [];
  const origAnnexures = original?.required_annexures ?? [];
  const origMaterialCosts = original?.financial_estimate?.material_costs ?? [];
  const origLabourCosts = original?.financial_estimate?.labour_costs ?? [];
  const origComplianceMatrix = original?.compliance_matrix ?? [];

  const checkLen = (name: string, origLen: number, t: unknown) => {
    if (!Array.isArray(t) || t.length !== origLen) {
      errors.push(`${name}: translated array length (${Array.isArray(t) ? t.length : "not an array"}) does not match original (${origLen})`);
    }
  };
  checkLen("pros", origPros.length, translated?.pros);
  checkLen("cons_and_risks", origCons.length, translated?.cons_and_risks);
  checkLen("next_immediate_steps", origNextSteps.length, translated?.next_immediate_steps);
  checkLen("detailed_procedure_steps", origProcSteps.length, translated?.detailed_procedure_steps);
  checkLen("winning_strategy_tips", origTips.length, translated?.winning_strategy_tips);
  checkLen("required_documents_checklist_context", origDocsChecklist.length, translated?.required_documents_checklist_context);
  checkLen("required_annexures_purpose", origAnnexures.length, translated?.required_annexures_purpose);
  checkLen("material_costs_rationale", origMaterialCosts.length, translated?.material_costs_rationale);
  checkLen("labour_costs_rationale", origLabourCosts.length, translated?.labour_costs_rationale);
  checkLen("compliance_matrix_notes", origComplianceMatrix.length, translated?.compliance_matrix_notes);

  if (errors.length > 0) {
    return { details: original, errors };
  }

  const merged = JSON.parse(JSON.stringify(original ?? {}));

  if (merged.compatibility) merged.compatibility.rationale = translated.compatibility_rationale;
  if (merged.tender_simplified) {
    merged.tender_simplified.scope_of_work = translated.scope_of_work;
    merged.tender_simplified.pros = translated.pros;
    merged.tender_simplified.cons_and_risks = translated.cons_and_risks;
  }
  if (merged.application_roadmap) {
    merged.application_roadmap.next_immediate_steps = translated.next_immediate_steps;
    merged.application_roadmap.detailed_procedure_steps = translated.detailed_procedure_steps;
    merged.application_roadmap.winning_strategy_tips = translated.winning_strategy_tips;
  }
  if (merged.bid_recommendation) merged.bid_recommendation.rationale = translated.bid_recommendation_rationale;
  if (merged.winning_probability) merged.winning_probability.recommended_action = translated.winning_probability_recommended_action;
  (merged.required_documents_checklist ?? []).forEach((item: any, i: number) => { item.context = translated.required_documents_checklist_context[i]; });
  (merged.required_annexures ?? []).forEach((item: any, i: number) => { item.purpose = translated.required_annexures_purpose[i]; });
  (merged.financial_estimate?.material_costs ?? []).forEach((item: any, i: number) => { item.rationale = translated.material_costs_rationale[i]; });
  (merged.financial_estimate?.labour_costs ?? []).forEach((item: any, i: number) => { item.rationale = translated.labour_costs_rationale[i]; });
  (merged.compliance_matrix ?? []).forEach((item: any, i: number) => { item.notes = translated.compliance_matrix_notes[i]; });

  const structuralErrors = validateTranslationPreservesStructure(original, merged);
  if (structuralErrors.length > 0) {
    return { details: original, errors: structuralErrors };
  }

  return { details: merged, errors: [] };
}
