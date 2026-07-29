// Shared analysis prompt + schema — used by the Tier-1 synchronous path
// (/api/analyze-tender) and the Tier-2 async chunk-worker path
// (/api/process-analysis-job) in server.ts, AND by the deterministic merge
// module (src/lib/analysisChunkMerge.ts) for its schema-validation gate.
// Moved verbatim out of server.ts (byte-identical content) so it can be
// imported into pure unit tests without pulling in server.ts's own
// top-level side effects (Firebase Admin init, Razorpay, etc.), and so the
// merge validator always checks against the exact same schema both tiers
// already produce output against — this drift is the single highest-risk
// failure mode for this feature (downstream BOQ/Financial code depends on
// this exact shape).

export function buildAnalysisSystemInstruction(language?: string | null): string {
  return `IMPORTANT: Keep your analysis extremely concise (under 800 words total) to ensure fast processing times and prevent timeouts. Use short bullet points and skip unnecessary pleasantries. \n\nYou are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid. BE EXTREMELY IN-DEPTH AND DETAILED in your rationales, lists, and steps. Elaborate heavily.
${
  language && language !== "en"
    ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}. Do not use English unless it is for technical terms that have no direct translation.`
    : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in English. Do NOT output in Hindi, Gujarati, or any other regional language.`
}

You switch between three operational modes based on input.

---
MODE 1: CONTRACT PROFILE ANALYSIS & MATCHING
- Trigger: Input contains a Tender Document and a User Business Profile JSON.
- Task: Compare technical eligibility, turnover requirements, and location preferences. Calculate an objective compatibility score out of 100. Translate complex terms into professional plain English that a local businessman easily understands. Also extract EMD details into the emd_details field — the required deposit amount (use "Not specified" if the document does not state an EMD requirement), accepted payment modes, and whether MSME certificate holders are exempted.
- Required Output Format: Valid JSON matching this layout:
{
  "compatibility": {
    "score": 92,
    "rationale": "Why this matches or where the gap lies (e.g., User meets the 3-year turnover clause but lacks a local office in the bidding state)."
  },
  "tender_simplified": {
    "tender_name": "Official Title of the Tender",
    "tender_number": "NIT / Tender reference number exactly as printed (e.g. 'UGVCL/PROC/2024-25/001'). Use null if not present.",
    "authority_name": "Name of Govt body or private entity",
    "tender_value": "Estimated total value, e.g. ₹5.00 CR",
    "is_active": true,
    "scope_of_work": "Plain English summary of exactly what needs to be delivered/built.",
    "pros": ["Clear benefits, e.g., favorable payment terms, MSME exemptions available"],
    "cons_and_risks": ["Hidden liabilities, e.g., heavy delay penalties in clause 14, strict bid security requirements"]
  },
  "timeline_and_milestones": {
    "pre_bid_meeting": "YYYY-MM-DD or 'None scheduled'",
    "clarification_deadline": "YYYY-MM-DD",
    "submission_deadline": "YYYY-MM-DD",
    "execution_duration": "Estimated months/years to complete work"
  },
  "required_documents_checklist": [
    {
      "document_name": "e.g., Class 3 Digital Signature Certificate (DSC)",
      "status": "Mandatory",
      "context": "Required for online submission via nProcure/GeM."
    },
    {
      "document_name": "e.g., 3 Years Audited Balance Sheet by CA",
      "status": "Mandatory",
      "context": "To prove minimum average turnover requirement of ₹50 Lakhs."
    }
  ],
  "required_annexures": [
    {
      "annexure_name": "Annexure I - Technical Bid",
      "purpose": "To fill technical experience and company details",
      "filling_complexity": "High"
    }
  ],
  "application_roadmap": {
    "portal_source": "GeM / nProcure / CPPP / Private Portal",
    "next_immediate_steps": [
      "Step 1: Pay EMD amount or submit MSME registration certificate for waiver.",
      "Step 2: Upload technical bidding documents before the pre-bid queries close.",
      "Step 3: Prepare price bid strictly in the designated BOQ (Bill of Quantities) format."
    ],
    "winning_strategy_tips": [
      "Tactical procurement advice, e.g., highlight previous similar government works in your technical presentation to leverage past experience points."
    ]
  },
  "financial_estimate": {
    "material_costs": [{ "item": "Cement", "estimated_cost": "₹5,00,000", "rationale": "Based on BOQ quantity x standard rate" }],
    "labour_costs": [{ "role": "Site Engineer", "estimated_cost": "₹1,50,000", "rationale": "For 3 months duration" }],
    "total_estimated_cost": "₹6,50,000"
  },
  "bid_recommendation": {
    "conservative": "₹9,80,000",
    "recommended": "₹9,45,000",
    "aggressive": "₹9,10,000",
    "margin_range": "8% to 15%",
    "risk_level": "Medium",
    "rationale": "Based on historical bids and material cost inflation"
  },
  "emd_details": {
    "amount": "₹50,000 (use 'Not specified' if the document does not state an EMD requirement)",
    "mode": "DD / Bank Guarantee / Online / Exempted for MSME",
    "msme_exemption": false
  },
  "boq_details": {
    "boq_type": "percentage_rate | item_rate | lump_sum_epc | hybrid | unknown — extract from explicit tender clause (e.g. 'Bids shall be submitted as a percentage above/below the schedule of rates' → percentage_rate). Use 'unknown' if not stated.",
    "boq_type_confidence": "high (explicit clause) | medium (inferred from structure) | low (unclear)",
    "financial_values": [
      {
        "label": "[Schedule Total] Estimated Amount Put to Tender (Schedule-B)",
        "value_raw": "₹1,25,00,000",
        "value_number": 12500000,
        "page": 3,
        "clause": "Clause 3.1",
        "source_text": "The estimated amount put to tender against the Schedule-B / BOQ is ₹1,25,00,000"
      },
      {
        "label": "[Tender Notice Value] Approximate Overall Project Budget",
        "value_raw": "₹6,50,00,000",
        "value_number": 65000000,
        "page": 1,
        "clause": "NIT Preamble",
        "source_text": "The overall estimated project cost is ₹6,50,00,000"
      }
    ],
    "suggested_estimated_index": 0
  }
}

CRITICAL — financial_values / suggested_estimated_index rules:
A tender document commonly states TWO different kinds of monetary figures, and they must never be confused:
  (a) SCHEDULE-DERIVED figures — the sum of the priced Schedule/BOQ itself: "Estimated Amount Put to Tender" against the Schedule-B, a BOQ/price schedule grand total, a quantity × rate summary total. This is the figure a bidder's percentage/rate actually applies against.
  (b) TENDER-NOTICE figures — the overall contract/project value quoted in the NIT/tender notice or preamble: "estimated project cost", "approximate contract value", "overall budget", EMD-basis value. This is reference-only context — it is NOT the pricing basis, and for Annual Rate Contracts / rate-contract tenders it can be many times larger than the schedule total (a ~50x gap is normal, not an error).
EVERY entry in "financial_values" MUST start its "label" with an explicit tag identifying which kind it is — "[Schedule Total]" or "[Tender Notice Value]" — before the descriptive text, exactly as shown in the two example entries above, so the tag is machine-parseable.
"suggested_estimated_index" MUST point at a "[Schedule Total]"-tagged entry whenever at least one exists in the array, even if a "[Tender Notice Value]"-tagged entry is larger, more prominent, or appears earlier in the document. Only fall back to a "[Tender Notice Value]" entry (or omit financial_values / leave it empty) when the document genuinely contains no schedule-derived figure at all — never guess or default to the tender-notice figure just because it's the only one you found easily.`;
}

export const ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    compatibility: {
      type: "object",
      properties: { score: { type: "number" }, rationale: { type: "string" } },
      required: ["score", "rationale"],
    },
    tender_simplified: {
      type: "object",
      properties: {
        tender_name: { type: "string" },
        tender_number: { type: "string" },
        authority_name: { type: "string" },
        tender_value: { type: "string" },
        is_active: { type: "boolean" },
        scope_of_work: { type: "string" },
        pros: { type: "array", items: { type: "string" } },
        cons_and_risks: { type: "array", items: { type: "string" } },
      },
      required: ["scope_of_work", "pros", "cons_and_risks"],
    },
    timeline_and_milestones: {
      type: "object",
      properties: {
        pre_bid_meeting: { type: "string" },
        clarification_deadline: { type: "string" },
        submission_deadline: { type: "string" },
        execution_duration: { type: "string" },
      },
      required: [
        "pre_bid_meeting",
        "clarification_deadline",
        "submission_deadline",
        "execution_duration",
      ],
    },
    required_documents_checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          document_name: { type: "string" },
          status: { type: "string" },
          context: { type: "string" },
        },
        required: ["document_name", "status", "context"],
      },
    },
    required_annexures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          annexure_name: { type: "string" },
          purpose: { type: "string" },
          filling_complexity: { type: "string" },
        },
        required: ["annexure_name", "purpose", "filling_complexity"],
      },
    },
    application_roadmap: {
      type: "object",
      properties: {
        portal_source: { type: "string" },
        next_immediate_steps: { type: "array", items: { type: "string" } },
        detailed_procedure_steps: { type: "array", items: { type: "string" } },
        winning_strategy_tips: { type: "array", items: { type: "string" } },
      },
      required: [
        "portal_source",
        "next_immediate_steps",
        "detailed_procedure_steps",
        "winning_strategy_tips",
      ],
    },
    financial_estimate: {
      type: "object",
      properties: {
        material_costs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              estimated_cost: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["item", "estimated_cost", "rationale"],
          },
        },
        labour_costs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              estimated_cost: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["role", "estimated_cost", "rationale"],
          },
        },
        total_estimated_cost: { type: "string" },
      },
      required: ["material_costs", "labour_costs", "total_estimated_cost"],
    },
    bid_recommendation: {
      type: "object",
      properties: {
        estimated_value: { type: "string" },
        conservative: { type: "string" },
        safe_range: { type: "string" },
        recommended: { type: "string" },
        aggressive: { type: "string" },
        margin_range: { type: "string" },
        risk_level: { type: "string" },
        rationale: { type: "string" },
      },
      required: [
        "estimated_value",
        "conservative",
        "safe_range",
        "recommended",
        "aggressive",
        "margin_range",
        "risk_level",
        "rationale",
      ],
    },
    winning_probability: {
      type: "object",
      properties: {
        score: { type: "number" },
        recommended_action: { type: "string" },
      },
      required: ["score", "recommended_action"],
    },
    compliance_matrix: {
      type: "array",
      description: "List of key eligibility and technical requirements from the tender, each flagged as MET or NOT MET based on the bidder profile.",
      items: {
        type: "object",
        properties: {
          requirement: { type: "string" },
          status: { type: "string", enum: ["MET", "NOT MET"] },
          notes: { type: "string" },
        },
        required: ["requirement", "status", "notes"],
      },
    },
    emd_details: {
      type: "object",
      properties: {
        amount: { type: "string" },
        mode: { type: "string" },
        msme_exemption: { type: "boolean" },
      },
      required: ["amount", "mode", "msme_exemption"],
    },
    boq_details: {
      type: "object",
      properties: {
        boq_type: { type: "string" },
        boq_type_confidence: { type: "string" },
        financial_values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label:       { type: "string" },
              value_raw:   { type: "string" },
              value_number:{ type: "number" },
              page:        { type: "number" },
              clause:      { type: "string" },
              source_text: { type: "string" },
            },
            required: ["label", "value_raw", "value_number"],
          },
        },
        suggested_estimated_index: { type: "number" },
      },
      required: ["boq_type", "boq_type_confidence", "financial_values"],
    },
  },
  required: [
    "compatibility",
    "tender_simplified",
    "timeline_and_milestones",
    "required_documents_checklist",
    "required_annexures",
    "application_roadmap",
    "financial_estimate",
    "bid_recommendation",
    "winning_probability",
    "compliance_matrix",
    "emd_details",
    "boq_details",
  ],
};

// ---------------------------------------------------------------------------
// Chunk-call schema variant (Tier-2 only) — every node marked `nullable`.
//
// The chunk prompt (buildChunkDocContents, server.ts) explicitly instructs
// Gemini: "For ANY field you cannot determine from THIS EXCERPT ALONE,
// return null... a null here is correct and expected." But
// ANALYSIS_RESPONSE_SCHEMA marks nearly everything `required` and never
// declares `nullable`, so Gemini's structured output — which cannot violate
// its own schema — was never actually able to comply with that instruction.
// It had to invent a type-conforming placeholder instead (most likely `0`
// for a required number, `""` for a required string), which the merge
// cannot distinguish from a genuinely-computed value. For a MIN-of-scores
// field like compatibility.score, that meant an out-of-scope chunk's forced
// `0` placeholder would win the merge almost every time — corrupting the
// result even though every individual chunk call "succeeded".
//
// This variant is used ONLY for Tier-2 chunk calls (see
// /api/process-analysis-job in server.ts). Tier-1's single whole-document
// call keeps using ANALYSIS_RESPONSE_SCHEMA unchanged — it has no
// "out of scope" fields to begin with. validateAgainstAnalysisSchema also
// keeps validating against the strict ANALYSIS_RESPONSE_SCHEMA, since it
// checks the MERGED result, which mergeChunkResults always produces as a
// fully-shaped object regardless of how many source chunks were null.
function deepNullable(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const clone: any = { ...schema, nullable: true };
  if (clone.properties) {
    clone.properties = Object.fromEntries(
      Object.entries(clone.properties).map(([key, sub]) => [key, deepNullable(sub)]),
    );
  }
  if (clone.items) {
    clone.items = deepNullable(clone.items);
  }
  return clone;
}

export const ANALYSIS_RESPONSE_SCHEMA_CHUNK = deepNullable(ANALYSIS_RESPONSE_SCHEMA);
