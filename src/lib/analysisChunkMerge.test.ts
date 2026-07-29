import { describe, test, expect } from 'vitest';
import { mergeChunkResults, validateAgainstAnalysisSchema, classifyChunkCriticality, hasNoMeaningfulContent } from './analysisChunkMerge';

// Three mock chunk results loosely modelled on a real multi-chunk tender:
// chunk 0 = NIT/eligibility section, chunk 1 = BOQ/schedule section,
// chunk 2 = general conditions/annexures section (mostly nulls — it has no
// eligibility/financial content, per the "return null when out of scope"
// chunk-prompt instruction).
function chunkA() {
  return {
    compatibility: { score: 84, rationale: 'Meets turnover and licence requirements.' },
    tender_simplified: {
      tender_name: 'Supply, Installation & Commissioning of 500 kWp Rooftop Solar PV System',
      tender_number: 'MSEDCL/EE/SOLAR/2026-27/1142',
      authority_name: 'MSEDCL',
      tender_value: '₹4.20 Cr',
      is_active: true,
      scope_of_work: 'Design, supply and install rooftop solar.',
      pros: ['MSME exemption available'],
      cons_and_risks: ['Strict bid security requirement'],
    },
    timeline_and_milestones: {
      pre_bid_meeting: '2026-07-09',
      clarification_deadline: '2026-07-15',
      submission_deadline: '2026-07-24',
      execution_duration: '6 months',
    },
    required_documents_checklist: [{ document_name: 'DSC', status: 'Mandatory', context: 'For online submission' }],
    required_annexures: [],
    application_roadmap: {
      portal_source: 'GeM Portal',
      next_immediate_steps: ['Pay EMD'],
      detailed_procedure_steps: [],
      winning_strategy_tips: [],
    },
    // total_estimated_cost is out of scope for this eligibility-focused chunk —
    // written as a real `null` (not ''), reflecting what the nullable chunk
    // schema (ANALYSIS_RESPONSE_SCHEMA_CHUNK) actually allows Gemini to return
    // now that it isn't forced to invent a type-conforming placeholder.
    financial_estimate: { material_costs: [], labour_costs: [], total_estimated_cost: null },
    bid_recommendation: null,
    winning_probability: { score: 70, recommended_action: 'Bid — strong eligibility fit.' },
    compliance_matrix: [{ requirement: 'Turnover >= 3Cr', status: 'MET', notes: '3yr avg 6.8Cr' }],
    emd_details: { amount: '₹8,40,000', mode: 'Online', msme_exemption: false },
    boq_details: { boq_type: 'unknown', boq_type_confidence: 'unknown', financial_values: [], suggested_estimated_index: 0 },
  };
}

function chunkB() {
  return {
    compatibility: { score: 61, rationale: 'Fixed-price clause and stale solvency certificate need review.' },
    tender_simplified: {
      tender_name: null, tender_number: null, authority_name: null, tender_value: null, is_active: null,
      scope_of_work: 'Design, supply and install rooftop solar across 6 divisional buildings, including 5-year O&M.',
      pros: [], cons_and_risks: ['Fixed-price contract, no escalation clause'],
    },
    timeline_and_milestones: { pre_bid_meeting: null, clarification_deadline: null, submission_deadline: '2026-07-24', execution_duration: null },
    required_documents_checklist: [],
    required_annexures: [{ annexure_name: 'Annexure I - Technical Bid', purpose: 'Technical experience', filling_complexity: 'High' }],
    application_roadmap: { portal_source: null, next_immediate_steps: [], detailed_procedure_steps: ['Prepare price bid in BOQ format'], winning_strategy_tips: [] },
    financial_estimate: { material_costs: [], labour_costs: [], total_estimated_cost: '₹6,50,000' },
    bid_recommendation: {
      estimated_value: '₹48,265.33', conservative: '₹49,700', safe_range: '₹49,000-₹50,500',
      recommended: '₹49,230.64', aggressive: '₹48,750', margin_range: '8% to 15%', risk_level: 'Medium',
      rationale: 'Based on schedule total and historical bids.',
    },
    winning_probability: { score: 55, recommended_action: 'Proceed with caution — review pricing risk first.' },
    compliance_matrix: [],
    emd_details: { amount: 'Not specified', mode: null, msme_exemption: null },
    boq_details: {
      boq_type: 'percentage_rate', boq_type_confidence: 'high',
      financial_values: [
        { label: '[Schedule Total] Estimated Amount Put to Tender (Schedule-B)', value_raw: '₹48,265.33', value_number: 48265.33, page: 3, clause: 'Clause 3.1', source_text: 'The estimated amount put to tender is ₹48,265.33' },
        { label: '[Tender Notice Value] Approximate Overall Project Budget', value_raw: '₹25,00,000', value_number: 2500000, page: 1, clause: 'NIT Preamble', source_text: 'The overall estimated project cost is ₹25,00,000' },
      ],
      suggested_estimated_index: 0,
    },
  };
}

function chunkC() {
  // General-conditions/annexures section — no eligibility or financial
  // content, so it correctly returns null/empty for everything the other
  // two chunks already cover (the chunk-prompt's "don't guess" rule).
  return {
    compatibility: { score: null, rationale: null },
    tender_simplified: { tender_name: null, tender_number: null, authority_name: null, tender_value: null, is_active: null, scope_of_work: null, pros: [], cons_and_risks: ['10% performance guarantee locked for 5-yr O&M period'] },
    timeline_and_milestones: { pre_bid_meeting: null, clarification_deadline: null, submission_deadline: null, execution_duration: null },
    required_documents_checklist: [],
    required_annexures: [{ annexure_name: 'Annexure I - Technical Bid', purpose: 'Technical experience', filling_complexity: 'High' }], // duplicate of chunk B's — should dedupe
    application_roadmap: { portal_source: null, next_immediate_steps: [], detailed_procedure_steps: [], winning_strategy_tips: ['Highlight prior MSEDCL rooftop project experience'] },
    financial_estimate: { material_costs: [], labour_costs: [], total_estimated_cost: null },
    bid_recommendation: null,
    winning_probability: { score: null, recommended_action: null },
    compliance_matrix: [],
    emd_details: { amount: null, mode: null, msme_exemption: null },
    boq_details: { boq_type: 'unknown', boq_type_confidence: 'unknown', financial_values: [], suggested_estimated_index: 0 },
  };
}

describe('mergeChunkResults', () => {
  test('compatibility.score: MIN of non-null scores, rationale from the same chunk as the min', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.compatibility.score).toBe(61); // chunk B's score, the minimum of {84, 61}
    expect(merged.compatibility.rationale).toBe(chunkB().compatibility.rationale);
  });

  test('winning_probability: same MIN-pairing rule', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.winning_probability.score).toBe(55);
    expect(merged.winning_probability.recommended_action).toBe(chunkB().winning_probability.recommended_action);
  });

  test('bid_recommendation: atomic whole object from the chunk with the richest financial_values', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    // Only chunk B has a non-null bid_recommendation AND financial_values —
    // its whole object must come through unmixed with chunk A/C's (null) data.
    expect(merged.bid_recommendation).toEqual(chunkB().bid_recommendation);
  });

  test('bid_recommendation: a partially-null picked object (real qualitative fields, null dollar figures) is backfilled to "" — never dropped, never fabricated', () => {
    // Under the nullable chunk schema, the richest chunk can honestly say
    // "I don't know the exact figures from this excerpt" (null) while still
    // being confident about qualitative risk assessment — this is the
    // scenario that broke the strict schema gate before this fix.
    const partial = {
      ...chunkB(),
      bid_recommendation: {
        estimated_value: null, conservative: null, safe_range: null, recommended: null,
        aggressive: null, margin_range: '8% to 15%', risk_level: 'Medium',
        rationale: 'Fixed-price clause raises risk; price conservatively.',
      },
    };
    const merged = mergeChunkResults([chunkA(), partial, chunkC()]);
    // Dollar figures backfilled to the same "" sentinel every other string
    // field uses — never a fabricated number, never left as null/undefined
    // (which would fail the strict schema's `required` check).
    expect(merged.bid_recommendation.estimated_value).toBe('');
    expect(merged.bid_recommendation.conservative).toBe('');
    expect(merged.bid_recommendation.safe_range).toBe('');
    expect(merged.bid_recommendation.recommended).toBe('');
    expect(merged.bid_recommendation.aggressive).toBe('');
    // Qualitative fields the chunk WAS confident about survive untouched.
    expect(merged.bid_recommendation.margin_range).toBe('8% to 15%');
    expect(merged.bid_recommendation.risk_level).toBe('Medium');
    expect(merged.bid_recommendation.rationale).toBe('Fixed-price clause raises risk; price conservatively.');
    // Must pass the strict schema gate — every required sub-field present.
    expect(validateAgainstAnalysisSchema(merged)).toEqual([]);
  });

  test('tender_simplified scalar fields: first non-null/non-empty, chunk order', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.tender_simplified.tender_name).toBe(chunkA().tender_simplified.tender_name);
    expect(merged.tender_simplified.tender_number).toBe(chunkA().tender_simplified.tender_number);
    expect(merged.tender_simplified.tender_value).toBe('₹4.20 Cr');
    expect(merged.tender_simplified.is_active).toBe(true);
  });

  test('scope_of_work: longest non-empty string wins, not necessarily the first chunk', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    // Chunk B's scope description is longer/more complete than chunk A's.
    expect(merged.tender_simplified.scope_of_work).toBe(chunkB().tender_simplified.scope_of_work);
  });

  test('timeline dates: earliest non-null per milestone', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.timeline_and_milestones.pre_bid_meeting).toBe('2026-07-09'); // only chunk A has one
    expect(merged.timeline_and_milestones.submission_deadline).toBe('2026-07-24'); // A and B agree
    expect(merged.timeline_and_milestones.execution_duration).toBe('6 months'); // first non-null (A)
  });

  test('emd_details: first real (non-"Not specified") value wins over a sentinel', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    // Chunk A has a real EMD amount; chunk B explicitly says "Not specified" —
    // the real value must win even though B appears after A in a case where
    // order alone would matter, and even though C has none at all.
    expect(merged.emd_details.amount).toBe('₹8,40,000');
    expect(merged.emd_details.mode).toBe('Online');
  });

  test('emd_details falls back to the sentinel only when no chunk has a real value', () => {
    const merged = mergeChunkResults([chunkB(), chunkC()]); // no chunk A this time
    expect(merged.emd_details.amount).toBe('Not specified');
  });

  test('boq_details type/confidence: highest-confidence non-"unknown" wins', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    // A and C both say 'unknown'; only B says 'percentage_rate' at 'high' confidence.
    expect(merged.boq_details.boq_type).toBe('percentage_rate');
    expect(merged.boq_details.boq_type_confidence).toBe('high');
  });

  test('boq_details.suggested_estimated_index is RECOMPUTED against the merged array, preferring [Schedule Total]', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.boq_details.financial_values).toHaveLength(2);
    const picked = merged.boq_details.financial_values[merged.boq_details.suggested_estimated_index];
    expect(picked.label).toContain('[Schedule Total]');
    expect(picked.value_number).toBe(48265.33);
  });

  test('array fields concatenate and dedupe exact duplicates across chunks', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    // chunk B and chunk C both list the SAME annexure — must collapse to one.
    expect(merged.required_annexures).toHaveLength(1);
    expect(merged.required_annexures[0].annexure_name).toBe('Annexure I - Technical Bid');
    // cons_and_risks concatenates distinct entries from all three chunks.
    expect(merged.tender_simplified.cons_and_risks).toEqual(
      expect.arrayContaining([
        'Strict bid security requirement',
        'Fixed-price contract, no escalation clause',
        '10% performance guarantee locked for 5-yr O&M period',
      ]),
    );
    expect(merged.tender_simplified.cons_and_risks).toHaveLength(3);
  });

  test('a chunk that is entirely null/empty (out of scope) never overrides real data from other chunks', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(merged.tender_simplified.tender_name).not.toBeNull();
    expect(merged.compatibility.score).not.toBeNull();
  });

  test('empty input produces a schema-shaped-but-empty result, never throws', () => {
    const merged = mergeChunkResults([]);
    expect(merged.compatibility.score).toBe(0);
    expect(merged.tender_simplified.pros).toEqual([]);
    expect(merged.boq_details.financial_values).toEqual([]);
  });
});

describe('validateAgainstAnalysisSchema', () => {
  test('a real merged result validates cleanly', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(validateAgainstAnalysisSchema(merged)).toEqual([]);
  });

  test('an empty-input merge STILL validates (every field has a schema-correct default, never undefined)', () => {
    const merged = mergeChunkResults([]);
    expect(validateAgainstAnalysisSchema(merged)).toEqual([]);
  });

  test('flags a missing required top-level field', () => {
    const merged = mergeChunkResults([chunkA(), chunkB()]);
    delete (merged as any).boq_details;
    const errors = validateAgainstAnalysisSchema(merged);
    expect(errors).toContain('details.boq_details: missing required field');
  });

  test('flags a wrong type on a nested field', () => {
    const merged = mergeChunkResults([chunkA(), chunkB()]);
    (merged as any).compatibility.score = 'not a number';
    const errors = validateAgainstAnalysisSchema(merged);
    expect(errors.some(e => e.includes('compatibility.score'))).toBe(true);
  });

  test('flags an array field that is not actually an array', () => {
    const merged = mergeChunkResults([chunkA(), chunkB()]);
    (merged as any).tender_simplified.pros = 'not an array';
    const errors = validateAgainstAnalysisSchema(merged);
    expect(errors.some(e => e.includes('tender_simplified.pros'))).toBe(true);
  });
});

describe('classifyChunkCriticality', () => {
  test('image-path chunk is ALWAYS financial_critical, regardless of filename', () => {
    expect(classifyChunkCriticality({ isImagePath: true, sourceLabel: 'scan_04.pdf' })).toBe('financial_critical');
    expect(classifyChunkCriticality({ isImagePath: true, sourceLabel: 'Eligibility_Certificate.pdf' })).toBe('financial_critical');
    expect(classifyChunkCriticality({ isImagePath: true, sourceLabel: 'BOQ.pdf', text: 'ignored anyway' })).toBe('financial_critical');
  });

  test('text chunk with BOQ/schedule keywords is financial_critical', () => {
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'BOQ.pdf', text: 'Bill of Quantities schedule' })).toBe('financial_critical');
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'file 2', text: 'SCHEDULE-B: Estimated Amount Put to Tender' })).toBe('financial_critical');
  });

  test('text chunk with eligibility keywords (no financial keywords) is eligibility_critical', () => {
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'Eligibility.pdf', text: 'ELIGIBILITY CRITERIA for bidders' })).toBe('eligibility_critical');
  });

  test('text chunk with only non-critical keywords is non_critical', () => {
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'Annexure_I.pdf', text: 'ANNEXURE I - Technical Bid declaration form' })).toBe('non_critical');
  });

  test('genuinely ambiguous text (no keyword signal at all) fails safe to eligibility_critical, never non_critical', () => {
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'Document1.pdf', text: 'Lorem ipsum dolor sit amet.' })).toBe('eligibility_critical');
  });

  test('a chunk mentioning BOTH an annexure keyword and an eligibility keyword is NOT downgraded to non_critical', () => {
    // Non-critical classification requires the non-critical pattern to
    // match with NO eligibility keyword also present — this guards against
    // a section that happens to reference "Annexure" while still carrying
    // real eligibility content.
    expect(classifyChunkCriticality({ isImagePath: false, sourceLabel: 'file 3', text: 'See Annexure II for ELIGIBILITY documentation.' })).toBe('eligibility_critical');
  });
});

describe('hasNoMeaningfulContent', () => {
  test('an empty merge (mergeChunkResults([]), or every chunk empty/placeholder-only) is flagged', () => {
    const merged = mergeChunkResults([]);
    expect(hasNoMeaningfulContent(merged)).toBe(true);
  });

  test('a real merged result (real name, scope, score, docs, financial_values) is NOT flagged', () => {
    const merged = mergeChunkResults([chunkA(), chunkB(), chunkC()]);
    expect(hasNoMeaningfulContent(merged)).toBe(false);
  });

  test('a legitimately sparse tender (only a real name + scope, everything else empty) is NOT falsely flagged', () => {
    const base = mergeChunkResults([]);
    const sparse = {
      ...base,
      tender_simplified: { ...base.tender_simplified, tender_name: 'Minimal Tender', scope_of_work: 'Supply of stationery items' },
    };
    expect(hasNoMeaningfulContent(sparse)).toBe(false);
  });

  test('a single real signal (e.g. a non-zero score alone) is enough to avoid the false-positive flag', () => {
    const base = mergeChunkResults([]);
    const sparse = { ...base, compatibility: { score: 40, rationale: 'Partial match' } };
    expect(hasNoMeaningfulContent(sparse)).toBe(false);
  });
});
