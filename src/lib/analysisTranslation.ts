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
// (every enum, every tag-prefixed label, every number, every date, every
// official name/identifier, the entire boq_details subtree) is copied
// through byte-identical by mergeTranslatedProse, never touched, and
// explicitly re-verified by validateTranslationPreservesStructure after
// every merge. This is the guarantee the Financial Engine's pricing-basis
// selection depends on (boq_details.financial_values[].label's
// [Schedule Total] tag) — see the Phase 1 classification this was
// designed against.
//
// TWO fields are "mixed" — a descriptive portion Gemini composed, plus an
// official/structural reference embedded in the same string:
//   - required_documents_checklist[].document_name, e.g.
//     "Class 3 Digital Signature Certificate (DSC)" — the parenthetical
//     official short-form must survive untranslated so a bidder can match
//     it against the government portal.
//   - required_annexures[].annexure_name, e.g. "Annexure I - Technical Bid"
//     — the leading "Annexure <ref>" structural label must survive.
// splitTrailingParenthetical / splitLeadingAnnexureRef isolate the
// TRANSLATABLE portion deterministically; the preserved portion is
// RE-DERIVED FROM THE ORIGINAL at merge time and never round-tripped
// through the model — same "the model only ever sees what it's allowed to
// change" discipline as every other field here.

// Bump whenever the prose-field set (extractProseFields/
// PROSE_TRANSLATION_SCHEMA/mergeTranslatedProse) changes shape. server.ts
// stamps every cached details_i18n/{lang} doc with this value and treats a
// missing/older stamp as a cache miss — so widening coverage (like this
// pass, which added document_name/annexure_name/status/item/role/
// requirement/emd_mode on top of the original narrower set) automatically
// invalidates every previously-cached translation the first time each
// project is viewed post-deploy, with no manual cache-clearing script and
// no risk of serving a stale, narrower translation next to a freshly
// translated one.
export const PROSE_SCHEMA_VERSION = 2;

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
  required_documents_checklist_status: string[];
  required_documents_checklist_document_name: string[];
  required_annexures_purpose: string[];
  required_annexures_annexure_name: string[];
  material_costs_rationale: string[];
  material_costs_item: string[];
  labour_costs_rationale: string[];
  labour_costs_role: string[];
  compliance_matrix_notes: string[];
  compliance_matrix_requirement: string[];
  emd_mode: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str) : [];
}

/** Detects a trailing parenthetical official short-form, e.g.
 *  "Class 3 Digital Signature Certificate (DSC)" → translatable
 *  "Class 3 Digital Signature Certificate", preserved " (DSC)" (kept
 *  verbatim, including its own leading space and parens, appended after
 *  translation). No match → the whole string is translatable, nothing
 *  preserved (safe default — nothing downstream pattern-matches this
 *  field, so over-translating a label that had no official suffix is
 *  harmless). */
function splitTrailingParenthetical(raw: unknown): { translatable: string; preserved: string } {
  const s = str(raw);
  if (!s) return { translatable: "", preserved: "" };
  const m = /^(.*?)(\s*\([^()]*\)\s*)$/.exec(s);
  if (m && m[1].trim().length > 0) {
    return { translatable: m[1].trim(), preserved: m[2] };
  }
  return { translatable: s, preserved: "" };
}

/** Detects a leading "Annexure <ref>" structural prefix, e.g.
 *  "Annexure I - Technical Bid" → preserved "Annexure I - ", translatable
 *  "Technical Bid". No match → whole string translatable, same safe
 *  default as above. */
function splitLeadingAnnexureRef(raw: unknown): { translatable: string; preserved: string } {
  const s = str(raw);
  if (!s) return { translatable: "", preserved: "" };
  const m = /^(\s*Annexure\s+[IVXLCDM0-9]+\s*[-–—:]?\s*)(.*)$/i.exec(s);
  if (m && m[2].trim().length > 0) {
    return { translatable: m[2].trim(), preserved: m[1] };
  }
  return { translatable: s, preserved: "" };
}

/** Pulls ONLY the prose-classified fields out of a stored `details` object
 *  — the exact and complete list from the Phase 1 trace. Nothing else in
 *  `details` is ever read by the translation call. For document_name /
 *  annexure_name, only the TRANSLATABLE portion (see split helpers above)
 *  is included — the preserved official portion never leaves this
 *  process. */
export function extractProseFields(details: any): ProseTranslationPayload {
  const docsChecklist: any[] = Array.isArray(details?.required_documents_checklist) ? details.required_documents_checklist : [];
  const annexures: any[] = Array.isArray(details?.required_annexures) ? details.required_annexures : [];
  const materialCosts: any[] = Array.isArray(details?.financial_estimate?.material_costs) ? details.financial_estimate.material_costs : [];
  const labourCosts: any[] = Array.isArray(details?.financial_estimate?.labour_costs) ? details.financial_estimate.labour_costs : [];
  const complianceMatrix: any[] = Array.isArray(details?.compliance_matrix) ? details.compliance_matrix : [];

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
    required_documents_checklist_context: docsChecklist.map(d => str(d?.context)),
    required_documents_checklist_status: docsChecklist.map(d => str(d?.status)),
    required_documents_checklist_document_name: docsChecklist.map(d => splitTrailingParenthetical(d?.document_name).translatable),
    required_annexures_purpose: annexures.map(d => str(d?.purpose)),
    required_annexures_annexure_name: annexures.map(d => splitLeadingAnnexureRef(d?.annexure_name).translatable),
    material_costs_rationale: materialCosts.map(d => str(d?.rationale)),
    material_costs_item: materialCosts.map(d => str(d?.item)),
    labour_costs_rationale: labourCosts.map(d => str(d?.rationale)),
    labour_costs_role: labourCosts.map(d => str(d?.role)),
    compliance_matrix_notes: complianceMatrix.map(d => str(d?.notes)),
    compliance_matrix_requirement: complianceMatrix.map(d => str(d?.requirement)),
    emd_mode: str(details?.emd_details?.mode),
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
    required_documents_checklist_status: { type: "array", items: { type: "string" } },
    required_documents_checklist_document_name: { type: "array", items: { type: "string" } },
    required_annexures_purpose: { type: "array", items: { type: "string" } },
    required_annexures_annexure_name: { type: "array", items: { type: "string" } },
    material_costs_rationale: { type: "array", items: { type: "string" } },
    material_costs_item: { type: "array", items: { type: "string" } },
    labour_costs_rationale: { type: "array", items: { type: "string" } },
    labour_costs_role: { type: "array", items: { type: "string" } },
    compliance_matrix_notes: { type: "array", items: { type: "string" } },
    compliance_matrix_requirement: { type: "array", items: { type: "string" } },
    emd_mode: { type: "string" },
  },
  required: [
    "compatibility_rationale", "scope_of_work", "pros", "cons_and_risks",
    "next_immediate_steps", "detailed_procedure_steps", "winning_strategy_tips",
    "bid_recommendation_rationale", "winning_probability_recommended_action",
    "required_documents_checklist_context", "required_documents_checklist_status", "required_documents_checklist_document_name",
    "required_annexures_purpose", "required_annexures_annexure_name",
    "material_costs_rationale", "material_costs_item", "labour_costs_rationale", "labour_costs_role",
    "compliance_matrix_notes", "compliance_matrix_requirement", "emd_mode",
  ],
};

const LANGUAGE_NAMES: Record<string, string> = { hi: "Hindi", gu: "Gujarati", en: "English" };

export function buildTranslationSystemInstruction(language: string): string {
  const languageName = LANGUAGE_NAMES[language] ?? language;
  return `You are a professional translator working on a tender-bidding analysis report. You will receive a JSON object whose values are ONLY narrative/descriptive text — rationales, summaries, recommended actions, risk notes, procedural steps, short labels — extracted from a larger report. Some string values are already fragments with any official reference codes/parenthetical short-forms stripped out; translate them as plain descriptive phrases. Translate every string (and every string inside every array) into ${languageName}, preserving the professional tone and exact meaning. Do not translate numbers, currency symbols, or technical codes/reference numbers that happen to appear inside a sentence — translate the surrounding language and leave those tokens as written. Return a JSON object with the EXACT SAME KEYS as the input, and for every array field, the EXACT SAME NUMBER OF ELEMENTS in the EXACT SAME ORDER — never add, remove, merge, split, or reorder entries, and never omit a key even if its value is an empty string or empty array in the input.`;
}

/** Verifies that `merged` differs from `original` in ONLY the prose fields
 *  extractProseFields ever pulls — every other value (scores, enums,
 *  dates, identifiers, official names, the entire boq_details subtree with
 *  its [Schedule Total]/[Tender Notice Value] tags) must be byte-identical.
 *  For the two "mixed" fields, the check is that the PRESERVED official
 *  portion survives intact within the merged value, not full-string
 *  equality (that field is EXPECTED to partially change). This is a
 *  direct, hand-written mirror of mergeTranslatedProse's own construction
 *  (clone + targeted overlay), run as an explicit defense-in-depth gate
 *  rather than just trusted implicitly — same fail-safe philosophy as the
 *  Tier-2 content-sanity gate: prove it, don't assume it. */
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
    const { preserved } = splitTrailingParenthetical(item?.document_name);
    const mergedName = str(merged?.required_documents_checklist?.[i]?.document_name);
    if (preserved && !mergedName.endsWith(preserved)) {
      errors.push(`required_documents_checklist[${i}].document_name: preserved official short-form was altered or dropped`);
    }
  });

  const origAnnex = Array.isArray(original?.required_annexures) ? original.required_annexures : [];
  eq(origAnnex.length, (merged?.required_annexures ?? []).length, "required_annexures.length");
  origAnnex.forEach((item: any, i: number) => {
    const { preserved } = splitLeadingAnnexureRef(item?.annexure_name);
    const mergedName = str(merged?.required_annexures?.[i]?.annexure_name);
    if (preserved && !mergedName.startsWith(preserved)) {
      errors.push(`required_annexures[${i}].annexure_name: preserved structural prefix was altered or dropped`);
    }
    eq(item?.filling_complexity, merged?.required_annexures?.[i]?.filling_complexity, `required_annexures[${i}].filling_complexity`);
  });

  eq(original?.application_roadmap?.portal_source, merged?.application_roadmap?.portal_source, "application_roadmap.portal_source");

  const origMaterial = Array.isArray(original?.financial_estimate?.material_costs) ? original.financial_estimate.material_costs : [];
  eq(origMaterial.length, (merged?.financial_estimate?.material_costs ?? []).length, "financial_estimate.material_costs.length");
  origMaterial.forEach((item: any, i: number) => {
    eq(item?.estimated_cost, merged?.financial_estimate?.material_costs?.[i]?.estimated_cost, `financial_estimate.material_costs[${i}].estimated_cost`);
  });

  const origLabour = Array.isArray(original?.financial_estimate?.labour_costs) ? original.financial_estimate.labour_costs : [];
  eq(origLabour.length, (merged?.financial_estimate?.labour_costs ?? []).length, "financial_estimate.labour_costs.length");
  origLabour.forEach((item: any, i: number) => {
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
    eq(item?.status, merged?.compliance_matrix?.[i]?.status, `compliance_matrix[${i}].status`);
  });

  eq(original?.emd_details?.amount, merged?.emd_details?.amount, "emd_details.amount");
  eq(original?.emd_details?.msme_exemption, merged?.emd_details?.msme_exemption, "emd_details.msme_exemption");

  // Whole-subtree deep-equality — the single highest-stakes check here:
  // this is where the [Schedule Total]/[Tender Notice Value] tags the
  // Financial Engine's pricing-basis selection depends on live.
  eq(original?.boq_details, merged?.boq_details, "boq_details");

  return errors;
}

/** Deep-clones `original`, overlays ONLY the translated prose fields onto
 *  the clone (reassembling the two "mixed" fields from the preserved
 *  official portion + the translated remainder), and validates the
 *  result. Rejects (returns `original` unchanged, with `errors`) if the
 *  model returned mismatched array lengths OR if the post-merge
 *  structural check finds anything outside the prose fields changed —
 *  same fail-safe philosophy as the Tier-2 content gate: never
 *  cache/serve a result that isn't provably safe. */
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
  checkLen("required_documents_checklist_status", origDocsChecklist.length, translated?.required_documents_checklist_status);
  checkLen("required_documents_checklist_document_name", origDocsChecklist.length, translated?.required_documents_checklist_document_name);
  checkLen("required_annexures_purpose", origAnnexures.length, translated?.required_annexures_purpose);
  checkLen("required_annexures_annexure_name", origAnnexures.length, translated?.required_annexures_annexure_name);
  checkLen("material_costs_rationale", origMaterialCosts.length, translated?.material_costs_rationale);
  checkLen("material_costs_item", origMaterialCosts.length, translated?.material_costs_item);
  checkLen("labour_costs_rationale", origLabourCosts.length, translated?.labour_costs_rationale);
  checkLen("labour_costs_role", origLabourCosts.length, translated?.labour_costs_role);
  checkLen("compliance_matrix_notes", origComplianceMatrix.length, translated?.compliance_matrix_notes);
  checkLen("compliance_matrix_requirement", origComplianceMatrix.length, translated?.compliance_matrix_requirement);

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

  (merged.required_documents_checklist ?? []).forEach((item: any, i: number) => {
    item.context = translated.required_documents_checklist_context[i];
    item.status = translated.required_documents_checklist_status[i];
    const { preserved } = splitTrailingParenthetical(origDocsChecklist[i]?.document_name);
    const translatedPortion = translated.required_documents_checklist_document_name[i];
    item.document_name = preserved ? `${translatedPortion}${preserved}` : translatedPortion;
  });

  (merged.required_annexures ?? []).forEach((item: any, i: number) => {
    item.purpose = translated.required_annexures_purpose[i];
    const { preserved } = splitLeadingAnnexureRef(origAnnexures[i]?.annexure_name);
    const translatedPortion = translated.required_annexures_annexure_name[i];
    item.annexure_name = preserved ? `${preserved}${translatedPortion}` : translatedPortion;
  });

  (merged.financial_estimate?.material_costs ?? []).forEach((item: any, i: number) => {
    item.rationale = translated.material_costs_rationale[i];
    item.item = translated.material_costs_item[i];
  });
  (merged.financial_estimate?.labour_costs ?? []).forEach((item: any, i: number) => {
    item.rationale = translated.labour_costs_rationale[i];
    item.role = translated.labour_costs_role[i];
  });
  (merged.compliance_matrix ?? []).forEach((item: any, i: number) => {
    item.notes = translated.compliance_matrix_notes[i];
    item.requirement = translated.compliance_matrix_requirement[i];
  });
  if (merged.emd_details) merged.emd_details.mode = translated.emd_mode;

  const structuralErrors = validateTranslationPreservesStructure(original, merged);
  if (structuralErrors.length > 0) {
    return { details: original, errors: structuralErrors };
  }

  return { details: merged, errors: [] };
}
