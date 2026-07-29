import { describe, test, expect } from 'vitest';
import {
  extractProseFields,
  mergeTranslatedProse,
  validateTranslationPreservesStructure,
  type ProseTranslationPayload,
} from './analysisTranslation';

function sampleDetails() {
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
      cons_and_risks: ['Strict bid security requirement', 'Fixed-price contract'],
    },
    timeline_and_milestones: {
      pre_bid_meeting: '2026-07-09',
      clarification_deadline: '2026-07-15',
      submission_deadline: '2026-07-24',
      execution_duration: '6 months',
    },
    required_documents_checklist: [
      { document_name: 'DSC', status: 'Mandatory', context: 'For online submission' },
    ],
    required_annexures: [
      { annexure_name: 'Annexure I - Technical Bid', purpose: 'To fill technical experience', filling_complexity: 'High' },
    ],
    application_roadmap: {
      portal_source: 'GeM Portal',
      next_immediate_steps: ['Pay EMD', 'Upload technical bid'],
      detailed_procedure_steps: ['Prepare price bid in BOQ format'],
      winning_strategy_tips: ['Highlight prior MSEDCL rooftop project experience'],
    },
    financial_estimate: {
      material_costs: [{ item: 'Cement', estimated_cost: '₹5,00,000', rationale: 'Based on BOQ quantity x standard rate' }],
      labour_costs: [{ role: 'Site Engineer', estimated_cost: '₹1,50,000', rationale: 'For 3 months duration' }],
      total_estimated_cost: '₹6,50,000',
    },
    bid_recommendation: {
      estimated_value: '₹48,265.33', conservative: '₹49,700', safe_range: '₹49,000-₹50,500',
      recommended: '₹49,230.64', aggressive: '₹48,750', margin_range: '8% to 15%', risk_level: 'Medium',
      rationale: 'Based on schedule total and historical bids.',
    },
    winning_probability: { score: 70, recommended_action: 'Bid — strong eligibility fit.' },
    compliance_matrix: [
      { requirement: 'Turnover >= 3Cr', status: 'MET', notes: '3yr avg 6.8Cr' },
      { requirement: 'ISO Certification', status: 'NOT MET', notes: 'No certificate on file' },
    ],
    emd_details: { amount: '₹8,40,000', mode: 'Online', msme_exemption: false },
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

/** A "translated" payload built by literally prefixing every prose value
 *  with a language tag — makes it trivial to assert the RIGHT values moved
 *  and nothing else did. */
function translatedPayload(details: any): ProseTranslationPayload {
  const extracted = extractProseFields(details);
  const tag = (s: string) => `[GU] ${s}`;
  return {
    compatibility_rationale: tag(extracted.compatibility_rationale),
    scope_of_work: tag(extracted.scope_of_work),
    pros: extracted.pros.map(tag),
    cons_and_risks: extracted.cons_and_risks.map(tag),
    next_immediate_steps: extracted.next_immediate_steps.map(tag),
    detailed_procedure_steps: extracted.detailed_procedure_steps.map(tag),
    winning_strategy_tips: extracted.winning_strategy_tips.map(tag),
    bid_recommendation_rationale: tag(extracted.bid_recommendation_rationale),
    winning_probability_recommended_action: tag(extracted.winning_probability_recommended_action),
    required_documents_checklist_context: extracted.required_documents_checklist_context.map(tag),
    required_annexures_purpose: extracted.required_annexures_purpose.map(tag),
    material_costs_rationale: extracted.material_costs_rationale.map(tag),
    labour_costs_rationale: extracted.labour_costs_rationale.map(tag),
    compliance_matrix_notes: extracted.compliance_matrix_notes.map(tag),
  };
}

describe('extractProseFields', () => {
  test('pulls exactly the prose fields and nothing else', () => {
    const details = sampleDetails();
    const extracted = extractProseFields(details);
    expect(extracted.compatibility_rationale).toBe(details.compatibility.rationale);
    expect(extracted.scope_of_work).toBe(details.tender_simplified.scope_of_work);
    expect(extracted.pros).toEqual(details.tender_simplified.pros);
    expect(extracted.cons_and_risks).toEqual(details.tender_simplified.cons_and_risks);
    expect(extracted.required_documents_checklist_context).toEqual(['For online submission']);
    expect(extracted.required_annexures_purpose).toEqual(['To fill technical experience']);
    expect(extracted.material_costs_rationale).toEqual(['Based on BOQ quantity x standard rate']);
    expect(extracted.labour_costs_rationale).toEqual(['For 3 months duration']);
    expect(extracted.compliance_matrix_notes).toEqual(['3yr avg 6.8Cr', 'No certificate on file']);
  });

  test('missing/malformed source fields default to empty string/array, never throw', () => {
    expect(() => extractProseFields({})).not.toThrow();
    expect(() => extractProseFields(null)).not.toThrow();
    const extracted = extractProseFields({});
    expect(extracted.compatibility_rationale).toBe('');
    expect(extracted.pros).toEqual([]);
  });
});

describe('mergeTranslatedProse', () => {
  test('only prose fields change; every enum/tag/number/date/identifier is byte-identical', () => {
    const original = sampleDetails();
    const translated = translatedPayload(original);
    const { details: merged, errors } = mergeTranslatedProse(original, translated);

    expect(errors).toEqual([]);

    // Prose changed.
    expect(merged.compatibility.rationale).toBe('[GU] Meets turnover and licence requirements.');
    expect(merged.tender_simplified.scope_of_work).toBe('[GU] Design, supply and install rooftop solar.');
    expect(merged.tender_simplified.cons_and_risks).toEqual([
      '[GU] Strict bid security requirement', '[GU] Fixed-price contract',
    ]);
    expect(merged.bid_recommendation.rationale).toBe('[GU] Based on schedule total and historical bids.');
    expect(merged.compliance_matrix[0].notes).toBe('[GU] 3yr avg 6.8Cr');

    // Everything else byte-identical to the original.
    expect(merged.compatibility.score).toBe(original.compatibility.score);
    expect(merged.tender_simplified.tender_name).toBe(original.tender_simplified.tender_name);
    expect(merged.tender_simplified.tender_number).toBe(original.tender_simplified.tender_number);
    expect(merged.tender_simplified.is_active).toBe(original.tender_simplified.is_active);
    expect(merged.timeline_and_milestones).toEqual(original.timeline_and_milestones);
    expect(merged.compliance_matrix[0].status).toBe('MET');
    expect(merged.compliance_matrix[1].status).toBe('NOT MET');
    expect(merged.bid_recommendation.estimated_value).toBe(original.bid_recommendation.estimated_value);
    expect(merged.bid_recommendation.risk_level).toBe('Medium');
    expect(merged.emd_details).toEqual(original.emd_details);
  });

  test('[Schedule Total] tag and the whole boq_details subtree survive untouched', () => {
    const original = sampleDetails();
    const translated = translatedPayload(original);
    const { details: merged, errors } = mergeTranslatedProse(original, translated);

    expect(errors).toEqual([]);
    expect(merged.boq_details).toEqual(original.boq_details);
    expect(merged.boq_details.financial_values[0].label).toBe('[Schedule Total] Estimated Amount Put to Tender (Schedule-B)');
    expect(merged.boq_details.financial_values[0].value_number).toBe(48265.33);
    expect(merged.boq_details.suggested_estimated_index).toBe(0);
    expect(merged.boq_details.boq_type).toBe('percentage_rate');
    expect(merged.boq_details.boq_type_confidence).toBe('high');
  });

  test('original object is never mutated', () => {
    const original = sampleDetails();
    const originalSnapshot = JSON.parse(JSON.stringify(original));
    const translated = translatedPayload(original);
    mergeTranslatedProse(original, translated);
    expect(original).toEqual(originalSnapshot);
  });

  test('malformed model output — mismatched array length — is rejected, base details returned unchanged', () => {
    const original = sampleDetails();
    const translated = translatedPayload(original);
    const corrupted: ProseTranslationPayload = { ...translated, cons_and_risks: [translated.cons_and_risks[0]] }; // dropped one entry

    const { details, errors } = mergeTranslatedProse(original, corrupted);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('cons_and_risks'))).toBe(true);
    expect(details).toEqual(original); // fallback to base, not a partial merge
  });

  test('malformed model output — a non-array where an array is expected — is rejected', () => {
    const original = sampleDetails();
    const translated = translatedPayload(original);
    const corrupted = { ...translated, pros: 'not an array' } as unknown as ProseTranslationPayload;

    const { details, errors } = mergeTranslatedProse(original, corrupted);
    expect(errors.length).toBeGreaterThan(0);
    expect(details).toEqual(original);
  });

  test('empty prose arrays in the original are preserved as empty (not a length-mismatch failure)', () => {
    const original = sampleDetails();
    original.tender_simplified.pros = [];
    const translated = translatedPayload(original);
    const { details: merged, errors } = mergeTranslatedProse(original, translated);
    expect(errors).toEqual([]);
    expect(merged.tender_simplified.pros).toEqual([]);
  });
});

describe('validateTranslationPreservesStructure', () => {
  test('a correct merge passes with zero errors', () => {
    const original = sampleDetails();
    const translated = translatedPayload(original);
    const { details: merged } = mergeTranslatedProse(original, translated);
    expect(validateTranslationPreservesStructure(original, merged)).toEqual([]);
  });

  test('catches a non-prose value that was altered outside the sanctioned merge path', () => {
    const original = sampleDetails();
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.boq_details.financial_values[0].label = '[Tender Notice Value] someone corrupted the tag';
    const errors = validateTranslationPreservesStructure(original, tampered);
    expect(errors.some(e => e.includes('boq_details'))).toBe(true);
  });

  test('catches a compliance_matrix status flip', () => {
    const original = sampleDetails();
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.compliance_matrix[0].status = 'NOT MET';
    const errors = validateTranslationPreservesStructure(original, tampered);
    expect(errors.some(e => e.includes('compliance_matrix[0].status'))).toBe(true);
  });
});
