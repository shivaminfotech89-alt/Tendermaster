import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Gemini SDK
// Fails fast if GEMINI_API_KEY is not set
let ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    ai = new GoogleGenAI({ apiKey: key });
  }
  return ai;
}

// Helper to retry Gemini requests since demand can occasionally cause 503s
async function generateContentWithRetry(client: GoogleGenAI, options: any, retries: number = 8) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await client.models.generateContent(options);
    } catch (err: any) {
      const errString = err?.message || err?.toString() || JSON.stringify(err) || "";
      const isQuotaError = errString.toLowerCase().includes('quota') || errString.includes('429');
      let isRetryable = err?.status === 503 || errString.includes('503') || errString.includes('UNAVAILABLE') || errString.includes('high demand') || errString.includes('busy');
      let delay = 4000 * Math.pow(1.5, i);
      let modelChanged = false;

      if (isQuotaError || (isRetryable && i > 1)) {
         isRetryable = true;
         
         // Fallback to older model if quota is hit to avoid completely blocking the user
         if (options.model === "gemini-2.5-flash") {
             options.model = "gemini-1.5-flash";
             modelChanged = true;
             console.warn(`[AI Engine] Falling back to gemini-1.5-flash due to quota/rate limit.`);
         } else if (options.model === "gemini-1.5-flash") {
             options.model = "gemini-1.5-flash-8b";
             modelChanged = true;
             console.warn(`[AI Engine] Falling back to gemini-1.5-flash-8b due to quota/rate limit.`);
         } else if (options.model === "gemini-1.5-flash-8b") {
             options.model = "gemini-1.0-pro";
             modelChanged = true;
             console.warn(`[AI Engine] Falling back to gemini-1.0-pro due to quota/rate limit.`);
         } else {
             // Exhausted fallbacks, if it's still a quota error, just throw to avoid looping 8 times
             if (isQuotaError) throw err;
         }

         const match = errString.match(/retry in ([\d\.]+)s/i);
         if (modelChanged) {
             delay = 1000;
         } else if (match && match[1]) {
             delay = (parseFloat(match[1]) * 1000) + 1000;
         } else if (isQuotaError) {
             delay = 1000;
         } else {
             delay = 10000 * Math.pow(1.5, i);
         }
      }
      
      if (isRetryable) {
        console.warn(`[AI Engine] Model busy (503) or rate limited (429). Retrying in ${delay.toFixed(0)}ms (attempt ${i + 1}/${retries + 1})...`);
        if (i < retries) {
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

// Mode 1: Parse Profile
app.post("/api/parse-profile", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const aiClient = getAI();
    const systemInstruction = `You are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid.

You switch between three operational modes based on input.

---
MODE 3: RAW CAPABILITY PARSING
- Trigger: User inputs a text description of their business during onboarding.
- Task: Convert text into structured profile filters.
- Required Output Format: Valid JSON matching:
{
  "keywords": ["string"],
  "states": ["string"],
  "min_capacity_inr": number
}`;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-2.5-flash",
      contents: [text],
      config: {
         systemInstruction,
         responseMimeType: "application/json",
         // We define the schema to enforce the format
         responseSchema: {
           type: "object",
           properties: {
             keywords: {
               type: "array",
               items: { type: "string" }
             },
             states: {
               type: "array",
               items: { type: "string" }
             },
             min_capacity_inr: {
               type: "number",
               nullable: true
             }
           },
           required: ["keywords", "states", "min_capacity_inr"]
         }
      }
    });

    const parsedData = response.text ? JSON.parse(response.text) : {};
    res.json({ profile: parsedData });
  } catch (err: any) {
    console.error("Parse Profile Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mode 1.5: Enhance Text
app.post("/api/enhance-text", async (req, res) => {
   try {
      const { text, context } = req.body;
      const aiClient = getAI();
      const prompt = `You are a professional business writer. Please enhance, expand, and format the following text to sound highly professional, clear, and perfectly suited for a corporate business profile used for bidding on high-value tenders. Keep it simple to understand but highly professional.
      
      Context of what this text is about: ${context}
      
      Original Text:
      ${text}
      
      Provide ONLY the enhanced text, nothing else.`;

      const response = await generateContentWithRetry(aiClient, {
         model: "gemini-2.5-flash",
         contents: [prompt],
      });
      
      res.json({ enhanced: response.text });
   } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to enhance text" });
   }
});

// Mode 2: Analyze Tender
app.post("/api/analyze-tender", async (req, res) => {
  try {
    const { tenderDocument, tenderType = 'text', tenderContent, userProfile } = req.body;
    const actualContent = tenderContent || tenderDocument;
    
    if (!actualContent || !userProfile) {
      return res.status(400).json({ error: "tender content and userProfile are required" });
    }

    const aiClient = getAI();
    let docContents: any[];
    
    const extraContextStr = req.body.extraContext ? `\n\n--- EXTRA CONTEXT / RE-ANALYSIS UPDATE ---\n${req.body.extraContext}\n` : "";
    
    if (tenderType === 'pdfs' || tenderType === 'zip') {
       docContents = [
         `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENTS (Attached as PDFs) ---\n`
       ];
       if (Array.isArray(actualContent)) {
         for (const pdfItem of actualContent) {
           docContents.push({ inlineData: { mimeType: "application/pdf", data: pdfItem.replace(/^data:application\/pdf;base64,/, '') } });
         }
       }
    } else if (tenderType === 'pdf') {
       docContents = [
         `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT (Attached as PDF) ---\n`,
         { inlineData: { mimeType: "application/pdf", data: actualContent.replace(/^data:application\/pdf;base64,/, '') } }
       ];
    } else if (tenderType === 'url') {
       try {
         const fetchedRes = await fetch(actualContent, {
           headers: {
             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
             'Accept-Language': 'en-US,en;q=0.9',
           },
           // Optional timeout logic could be added here, but keep simple
         });
         if (!fetchedRes.ok) throw new Error(`Failed to fetch URL: ${fetchedRes.statusText}`);
         const htmlContent = await fetchedRes.text();
         const cleanText = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>?/gm, ' ');
         docContents = [
           `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT (Fetched from URL: ${actualContent}) ---\n${cleanText}`
         ];
       } catch (fetchErr: any) {
         return res.status(400).json({ error: "Failed to directly fetch tender URL. Government portals (like eProcure/GeM) often block automated access. Please download the PDF and upload it instead." });
       }
    } else {
       docContents = [
         `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT ---\n${actualContent}`
       ];
    }

    const systemInstruction = `You are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid. BE EXTREMELY IN-DEPTH AND DETAILED in your rationales, lists, and steps. Elaborate heavily.

You switch between three operational modes based on input.

---
MODE 1: CONTRACT PROFILE ANALYSIS & MATCHING
- Trigger: Input contains a Tender Document and a User Business Profile JSON.
- Task: Compare technical eligibility, turnover requirements, and location preferences. Calculate an objective compatibility score out of 100. Translate complex terms into Gujarati/Hindi-influenced professional plain English that a local businessman easily understands.
- Required Output Format: Valid JSON matching this layout:
{
  "compatibility": {
    "score": 92,
    "rationale": "Why this matches or where the gap lies (e.g., User meets the 3-year turnover clause but lacks a local office in the bidding state)."
  },
  "tender_simplified": {
    "tender_name": "Official Title of the Tender",
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
  }
}`;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-2.5-flash",
      contents: docContents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
             compatibility: {
               type: "object",
               properties: {
                 score: { type: "number" },
                 rationale: { type: "string" }
               },
               required: ["score", "rationale"]
             },
             tender_simplified: {
               type: "object",
               properties: {
                 tender_name: { type: "string", description: "The official name or title of the tender" },
                 authority_name: { type: "string", description: "The organization or government department issuing the tender" },
                 tender_value: { type: "string", description: "Estimated project cost or value of the tender" },
                 is_active: { type: "boolean", description: "Whether the tender submission window is currently active" },
                 scope_of_work: { type: "string" },
                 pros: { type: "array", items: { type: "string" } },
                 cons_and_risks: { type: "array", items: { type: "string" } }
               },
               required: ["scope_of_work", "pros", "cons_and_risks"]
             },
             timeline_and_milestones: {
               type: "object",
               properties: {
                 pre_bid_meeting: { type: "string" },
                 clarification_deadline: { type: "string" },
                 submission_deadline: { type: "string" },
                 execution_duration: { type: "string" }
               },
               required: ["pre_bid_meeting", "clarification_deadline", "submission_deadline", "execution_duration"]
             },
             required_documents_checklist: {
               type: "array",
               items: {
                 type: "object",
                 properties: {
                   document_name: { type: "string" },
                   status: { type: "string" },
                   context: { type: "string" }
                 },
                 required: ["document_name", "status", "context"]
               }
             },
             required_annexures: {
               type: "array",
               items: {
                 type: "object",
                 properties: {
                   annexure_name: { type: "string" },
                   purpose: { type: "string" },
                   filling_complexity: { type: "string" }
                 },
                 required: ["annexure_name", "purpose", "filling_complexity"]
               }
             },
             application_roadmap: {
               type: "object",
               properties: {
                 portal_source: { type: "string" },
                 next_immediate_steps: { type: "array", items: { type: "string" } },
                 detailed_procedure_steps: { type: "array", items: { type: "string" }, description: "In-depth, step-by-step Standard Operating Procedures to apply for this exact tender, ensuring no silly mistakes." },
                 winning_strategy_tips: { type: "array", items: { type: "string" } }
               },
               required: ["portal_source", "next_immediate_steps", "detailed_procedure_steps", "winning_strategy_tips"]
             },
             financial_estimate: {
               type: "object",
               properties: {
                 material_costs: {
                   type: "array",
                   items: {
                     type: "object",
                     properties: { item: { type: "string" }, estimated_cost: { type: "string" }, rationale: { type: "string" } },
                     required: ["item", "estimated_cost", "rationale"]
                   }
                 },
                 labour_costs: {
                   type: "array",
                   items: {
                     type: "object",
                     properties: { role: { type: "string" }, estimated_cost: { type: "string" }, rationale: { type: "string" } },
                     required: ["role", "estimated_cost", "rationale"]
                   }
                 },
                 total_estimated_cost: { type: "string" }
               },
               required: ["material_costs", "labour_costs", "total_estimated_cost"]
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
                 rationale: { type: "string" }
               },
               required: ["conservative", "recommended", "aggressive", "margin_range", "risk_level", "rationale"]
             },
             winning_probability: {
               type: "object",
               properties: {
                 score: { type: "number" },
                 recommended_action: { type: "string" }
               },
               required: ["score", "recommended_action"]
             }
           },
           required: ["compatibility", "tender_simplified", "timeline_and_milestones", "required_documents_checklist", "required_annexures", "application_roadmap", "financial_estimate", "bid_recommendation", "winning_probability"]
         }
      }
    });

    const parsedData = response.text ? JSON.parse(response.text) : {};
    res.json({ analysis: parsedData });
  } catch (err: any) {
    console.error("Analyze Tender Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mode 3: Interactive Tender Chat
// Mode 3: Compare Tender Versions
app.post("/api/compare-tender", async (req, res) => {
  try {
    const { originalTender, newDocument, documentType = "DOCUMENT" } = req.body;
    if (!originalTender || !newDocument) {
      return res.status(400).json({ error: "originalTender and newDocument are required" });
    }

    const aiClient = getAI();
    let docContents: any[];
    const safeDocType = (documentType || "DOCUMENT").toUpperCase();
    docContents = [
      `--- ORIGINAL TENDER DETAILS ---\n${JSON.stringify(originalTender)}\n\n--- NEW ${safeDocType} DOCUMENT ---\n${newDocument}`
    ];
    
    // We expect the newDocument to be base64 PDF if it's a file, or text if it's raw text.
    // For simplicity, let's assume UI sends text/base64 according to type. If we want base64:
    if (newDocument.startsWith("data:application/pdf;base64,")) {
        docContents = [
           `--- ORIGINAL TENDER DETAILS ---\n${JSON.stringify(originalTender)}\n\n--- NEW ${safeDocType} DOCUMENT (Attached as PDF) ---\n`,
           { inlineData: { mimeType: "application/pdf", data: newDocument.replace(/^data:application\/pdf;base64,/, '') } }
        ];
    } else {
        docContents = [
           `--- ORIGINAL TENDER DETAILS ---\n${JSON.stringify(originalTender)}\n\n--- NEW ${safeDocType} DOCUMENT ---\n${newDocument}`
        ];
    }

    const systemInstruction = `You are a Tender Document Comparison Engine. Compare the Original Tender Details against the New ${safeDocType} uploaded by the user. Highlight EXACTLY what changed. Outputs must be clear and direct.`;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: docContents.map(d => typeof d === 'string' ? {text: d || " "} : d) }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
             added_clauses: { type: "array", items: { type: "string" } },
             removed_clauses: { type: "array", items: { type: "string" } },
             changed_dates: { type: "array", items: { type: "string" } },
             changed_eligibility: { type: "array", items: { type: "string" } },
             changed_emd: { type: "string" },
             critical_changes_summary: { type: "string" },
             new_recommendations: { type: "string" }
          },
          required: ["added_clauses", "removed_clauses", "changed_dates", "changed_eligibility", "changed_emd", "critical_changes_summary", "new_recommendations"]
        }
      }
    });

    res.json({ comparison: JSON.parse(response.text) });
  } catch (err: any) {
    console.error("Compare Tender Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat-tender", async (req, res) => {
  try {
    const { tenderDocument, analysisResult, messages } = req.body;
    if ((!tenderDocument && !analysisResult) || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "tenderDocument and messages array are required" });
    }

    const aiClient = getAI();
    const systemInstruction = `You are a specialized Procurement Chatbot assisting an Indian business with a specific tender. 
You have access to the original tender document and the AI analysis. Answer their questions clearly, concisely, and realistically based on the provided context. Follow Indian tendering terminology (EMD, PBG, BOQ, etc.). If a detail is missing, state it is not specified and advise to check for corrigendums.

--- TENDER CONTEXT ---
${tenderDocument ? tenderDocument.substring(0, 50000) : 'No raw text provided.'}

--- PREVIOUS AI ANALYSIS ---
${analysisResult ? JSON.stringify(analysisResult) : 'No previous analysis provided.'}
`;

    // messages should be [{ role: "user" | "model", text: "" }]
    const formattedContents = messages.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [ { text: msg.text || " " } ]
    }));

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-2.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction,
      }
    });

    res.json({ answer: response.text });
  } catch (err: any) {
    console.error("Chat Tender Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Generate Tender Documents
app.post("/api/generate-doc", async (req, res) => {
  try {
    const { docType, tenderDetails, userProfile, financialData, extraInstructions } = req.body;
    if (!docType || !tenderDetails) {
      return res.status(400).json({ error: "docType and tenderDetails are required" });
    }

    const aiClient = getAI();
    let financialContext = '';
    if (financialData && financialData.revenue) {
       financialContext = `\n--- PREPARED BID FINANCIALS ---\nTotal Bid Amount: ₹${financialData.revenue}\nMaterial Costs: ${JSON.stringify(financialData.materials)}\nLabour Costs: ${JSON.stringify(financialData.labour)}\nEnsure that if the document is a commercial / financial bid proposal or cost breakdown, you strictly use these final user-approved numbers.`;
    }

    let extraContext = '';
    if (extraInstructions) {
       extraContext = `\n--- USER SPECIFIC INSTRUCTIONS FOR THIS DOCUMENT ---\n${extraInstructions}\nPlease strictly incorporate the user's instructions above when filling out this document.`;
    }

    const systemInstruction = `You are "Tender MasterAI", an expert legal and corporate procurement assistant specializing in Indian tenders. 
Your task is to generate high-quality, professional draft documents based on the provided tender analysis and the user's business profile. 
Use the business profile data (Company Name, Address, GST, PAN, etc.) and Tender Details (Tender No., Dates, Authority Name, etc.) to automatically fill in ALL placeholders. 
CRITICAL RULE: DO NOT leave placeholders like "[Tender Number - To be filled by bidder]" or "[Date]" or "[Bidder Name]" in the output. You MUST aggressively find and replace all such "fill in the blank" brackets with the actual data from the provided Tender Details and Business Profile. If an exact piece of information is missing, use a logical assumed default or current date rather than leaving a bracketed placeholder.
If the document requested is an "Auto-Fill: [Annexure Name]", your job is to auto-generate the filled-up annexure exactly as it should be submitted. Since real annexures are often tabular forms in PDFs, YOU MUST Reconstruct the exact Annexure/Schedule/Form tabular layout required by the agency using clean, well-structured Markdown tables and lists. Place the bidder's information directly into the respective form fields/cells as if they were filling out the actual PDF form. Ensure it visually resembles a structured printable form that can be submitted to the agency. Do not leave blanks if information can be reasonably derived or if standard boilerplate is applicable.
${financialContext}${extraContext}

--- BUSINESS PROFILE ---
${userProfile ? JSON.stringify(userProfile) : 'Not provided.'}

--- TENDER DETAILS ---
${JSON.stringify(tenderDetails)}
`;

    const isAutoFill = docType.includes("Auto-Fill") || docType.includes("Annexure") || docType.includes("Schedule") || docType.includes("Form");
    const docPromptInstructions = isAutoFill 
        ? `Please auto-fill the requested form/annexure/schedule: "${docType}". Re-create the form's exact structural layout (using Markdown tables heavily where appropriate, to emulate PDF form columns and rows) and insert our data directly into it. Return ONLY the document text output in Markdown format.`
        : `Please draft a highly professional, ready-to-use "${docType}" based on the Tender Details and Business Profile provided. Keep constraints and specifics of Indian tendering format in mind. Return ONLY the document text output in Markdown format, with proper headings.`;

    const prompt = docPromptInstructions;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt || " " }] }],
      config: {
        systemInstruction,
      }
    });

    const outputText = response.text || "Empty response from AI.";
    res.json({ document: outputText });
  } catch (err: any) {
    console.error("Generate Doc Error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
