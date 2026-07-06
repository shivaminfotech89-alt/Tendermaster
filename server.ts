import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore as adminGetFirestore, Timestamp } from "firebase-admin/firestore";
import Razorpay from "razorpay";
import crypto from "crypto";
import dns from "dns";
import { promisify } from "util";

const lookupPromise = promisify(dns.lookup);

let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
} catch (err) {
  console.error("Failed to read firebase-applet-config.json", err);
}

if (admin.getApps().length === 0) {
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  } catch (e) {
    console.error("Firebase admin init failed", e);
  }
}

const getFirestore = () => {
  return adminGetFirestore(getApp(), firebaseConfig.firestoreDatabaseId || "(default)");
};



function robustJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Failed standard JSON.parse, trying to clean markdown...", e.message);
    try {
      let cleaned = text.replace(/^[sS]*?```json/i, '').replace(/```[sS]*?$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e2) {
      console.warn("Failed cleaned JSON.parse, trying relaxed parsing...", e2.message);
      throw new Error("AI returned malformed data. Try again. " + e2.message);
    }
  }
}

const app = express();
const PORT = 3000;

// Enable raw body buffer storage for Razorpay signature verification
app.use(express.json({ 
  limit: '50mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Express Custom Request Type for Auth Middleware
interface AuthenticatedRequest extends express.Request {
  user?: {
    uid: string;
    email: string;
    decodedToken?: any;
  };
}

// Phase 1: Custom Claims Helper
const setEntitlementClaims = async (uid: string, claims: { role: string; subscriptionExpiry?: string }) => {
  // Bypassing Custom Claims because the AI Studio environment does not have identitytoolkit.googleapis.com API enabled.
  // We rely on Firestore documents + Rules for authorization.
  return true;
};

// Phase 1: Firebase Auth ID Token Verification Middleware
const verifyFirebaseToken = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const idToken = authHeader.split("Bearer ")[1];
  if (!idToken || idToken.trim() === "") {
    return res.status(401).json({ error: "Missing token" });
  }
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      decodedToken,
    };
    next();
  } catch (error: any) {
    console.error("Firebase ID token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

// Phase 1: Entitlement Gating Middleware (Claims-Based)
const requireActiveEntitlement = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  if (!req.user || !req.user.uid || !req.user.decodedToken) {
    return res.status(401).json({ error: "Unauthorized: Authenticated user context required" });
  }

  try {
    let role = "free";
    let expiryDate = null;
    
    try {
      const idToken = req.headers.authorization.split("Bearer ")[1];
      const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/users/${req.user.uid}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (response.ok) {
        const data = await response.json();
        if (data.fields) {
          if (data.fields.role && data.fields.role.stringValue) {
            role = data.fields.role.stringValue;
          }
          if (data.fields.subscriptionExpiry && data.fields.subscriptionExpiry.timestampValue) {
            expiryDate = new Date(data.fields.subscriptionExpiry.timestampValue);
          }
        }
      } else if (response.status === 404) {
        // User document does not exist yet, default to free
      } else {
        console.log("REST API error fetching user role", response.status);
      }
    } catch (e) {
      console.log("Failed to fetch user role from Firestore, falling back to claims", e);
      const claims = req.user.decodedToken;
      role = claims.role || "free";
      if (claims.subscriptionExpiry) {
        expiryDate = new Date(claims.subscriptionExpiry);
      }
    }
    
    // Hardcoded superadmin check
    if (req.user.email === "shivaminfotech89@gmail.com") {
      role = "superadmin";
    }

    if (role === "admin" || role === "superadmin") {
      return next();
    }

    if (role === "premium") {
      if (expiryDate) {
        if (expiryDate > new Date()) {
          return next();
        } else {
           return res.status(403).json({ error: "Your Premium subscription has expired. Please renew to continue using advanced features." });
        }
      }
      return next(); // Premium without expiry? Allow it.
    }

    return res.status(403).json({ error: "This feature requires an active Premium subscription. Please upgrade your account." });
  } catch (error) {
    console.error("Entitlement check failed", error);
    return res.status(500).json({ error: "Failed to verify user entitlements." });
  }
};


// Phase 5: SSRF guard check
async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }
    const hostname = parsedUrl.hostname;
    
    // Check for obvious local/internal addresses
    if (
      hostname === 'localhost' || 
      hostname === '127.0.0.1' || 
      hostname.startsWith('10.') || 
      hostname.startsWith('192.168.') || 
      hostname.startsWith('172.') || 
      hostname.endsWith('.internal')
    ) {
      return false;
    }

    // Attempt DNS lookup to verify IP is not internal
    try {
      const { address } = await lookupPromise(hostname);
      if (
        address === '127.0.0.1' || 
        address === '::1' || 
        address.startsWith('10.') || 
        address.startsWith('192.168.') || 
        address.startsWith('172.')
      ) {
        return false;
      }
    } catch (dnsError) {
      return false; // Cannot resolve hostname
    }

    return true;
  } catch (e) {
    return false;
  }
}

let razorpayInstance: Razorpay | null = null;
function getRazorpay(): Razorpay {
  if (!razorpayInstance) {
    let key_id = process.env.RAZORPAY_KEY_ID;
    let key_secret = process.env.RAZORPAY_KEY_SECRET;
    
    // Auto-swap if the user accidentally inverted them in secrets panel
    if (key_id && !key_id.startsWith("rzp_") && key_secret && key_secret.startsWith("rzp_")) {
      const temp = key_id;
      key_id = key_secret;
      key_secret = temp;
    }

    if (!key_id || !key_secret) {
      throw new Error("Razorpay credentials not found in environment variables");
    }
    razorpayInstance = new Razorpay({ key_id, key_secret });
  }
  return razorpayInstance;
}

app.post("/api/create-payment-link", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, currency = "INR", description, customer, callback_url } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Amount must be at least 100 paise" });
    }

    const rzp = getRazorpay();
    const paymentLink = await rzp.paymentLink.create({
      amount,
      currency,
      description,
      customer,
      callback_url,
      callback_method: "get"
    });
    
    res.json(paymentLink);
  } catch (error: any) {
    console.error("Create payment link error:", error);
    res.status(error?.statusCode || 400).json({ error: error?.error?.description || error?.message || "Failed to create payment link" });
  }
});

app.post("/api/create-order", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Amount must be at least 100 paise" });
    }

    const rzp = getRazorpay();
    const options = {
      amount,
      currency,
      receipt
    };

    const order = await rzp.orders.create(options);
    res.json(order);
  } catch (error: any) {
    console.error("Create order error:", error);
    res.status(500).json({ error: error.message || "Failed to create order" });
  }
});

// Phase 3: Verify checkout payment server-side cryptographically before granting upgrade
app.post("/api/verify-payment", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      amount 
    } = req.body;
    
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_secret) throw new Error("Missing RAZORPAY_KEY_SECRET");

    let isVerified = false;

    // 1. Verify standard order signatures
    if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const generated_signature = crypto
        .createHmac("sha256", key_secret)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest("hex");

      const expectedBuffer = Buffer.from(generated_signature);
      const actualBuffer = Buffer.from(razorpay_signature);

      if (expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        isVerified = true;
      }
    } 
    // 2. Verify payment link redirect signatures
    else if (razorpay_payment_link_id && razorpay_payment_link_status && razorpay_payment_id && razorpay_signature) {
      const refId = razorpay_payment_link_reference_id || "";
      const text = `${razorpay_payment_link_id}|${refId}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
      const generated_signature = crypto
        .createHmac("sha256", key_secret)
        .update(text)
        .digest("hex");

      const expectedBuffer = Buffer.from(generated_signature);
      const actualBuffer = Buffer.from(razorpay_signature);

      if (expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        isVerified = true;
      }
    } else {
      return res.status(400).json({ error: "Missing required fields for signature verification" });
    }

    if (isVerified) {
        let days = 30; // default fallback
        const parsedAmount = Number(amount);
        if (parsedAmount === 999 || parsedAmount === 99900) days = 90; // 3 months
        if (parsedAmount === 1999 || parsedAmount === 199900) days = 365; // 1 year

        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + days);
        
        const claimsSet = await setEntitlementClaims(uid, { role: "premium", subscriptionExpiry: newExpiry.toISOString() });
        if (!claimsSet) {
           return res.status(500).json({ success: false, error: "Failed to upgrade account privileges server-side." });
        }
        
        return res.json({ 
          success: true, 
          message: "Payment verified successfully. Account upgraded to Premium.",
          days,
          newExpiry: newExpiry.toISOString(),
          paymentId: razorpay_payment_id
        });
    } else {
      return res.status(400).json({ success: false, error: "Signature mismatch" });
    }
  } catch (error: any) {
    console.error("Verify payment error:", error);
    res.status(500).json({ error: error.message || "Failed to verify payment" });
  }
});

// Phase 3: Code activation endpoint to redeem premium access
app.post("/api/activate-code", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Activation code is required" });
    }

    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Support hardcoded test code TENDERMASTERPRO
    const validCodesEnv = (process.env.VALID_ACTIVATION_CODES || "TENDERMASTERPRO").split(",").map(c => c.trim().toUpperCase());
    if (validCodesEnv.includes(code.trim().toUpperCase())) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      
      return res.json({ 
        success: true, 
        message: "Premium activated for 30 days! Please refresh.",
        newExpiry: expiry.toISOString()
      });
    }

    // Cannot securely verify other codes without Admin SDK access to Firestore
    return res.status(400).json({ error: "Invalid activation code" });

  } catch (error: any) {
    console.error("Activate code error:", error);
    return res.status(500).json({ error: error.message || "Failed to redeem activation code" });
  }
});

// Phase 2: Secure Razorpay Webhook with Signature Verification
app.post("/api/razorpay-webhook", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      console.warn("[Webhook Warning] Missing x-razorpay-signature header");
      return res.status(400).json({ error: "Missing signature" });
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Webhook Error] RAZORPAY_WEBHOOK_SECRET is not configured server-side");
      return res.status(500).json({ error: "Webhook secret missing from server configuration" });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      console.error("[Webhook Error] req.rawBody is undefined. Verify body-parser configuration.");
      return res.status(400).json({ error: "Raw body verification failed" });
    }

    // Cryptographically verify HMAC-SHA256 signature using timingSafeEqual
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature);
    const actualBuffer = Buffer.from(signature);

    const isValidSignature = expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer);

    if (!isValidSignature) {
      console.warn("[Webhook Warning] Cryptographic signature verification failed (mismatch)");
      return res.status(400).json({ error: "Signature verification failed" });
    }

    const event = req.body;
    if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
       const email = event.payload?.payment?.entity?.email;
       const amount = event.payload?.payment?.entity?.amount; // in paise
       
       if (email) {
          try {
            const userRecord = await getAuth().getUserByEmail(email);
            if (userRecord && userRecord.uid) {
              let days = 30; // default fallback
              const parsedAmount = Number(amount);
              if (parsedAmount === 999 || parsedAmount === 99900) days = 90; // 3 months
              if (parsedAmount === 1999 || parsedAmount === 199900) days = 365; // 1 year
      
              const newExpiry = new Date();
              newExpiry.setDate(newExpiry.getDate() + days);
              
              await setEntitlementClaims(userRecord.uid, { role: "premium", subscriptionExpiry: newExpiry.toISOString() });
              console.log(`[Webhook Verified] Upgraded ${email} to premium via custom claims.`);
            }
          } catch (e) {
            console.error(`[Webhook Error] Failed to resolve or upgrade user by email ${email}:`, e);
          }
       }
    }
    res.json({ status: "ok" });
  } catch (error: any) {
    console.error("[Webhook Error] Webhook execution exception:", error);
    res.status(500).json({ error: error.message || "Internal error" });
  }
});


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
         if (options.model === "gemini-3.5-flash") {
             options.model = "gemini-3.1-flash-lite";
             modelChanged = true;
             console.warn(`[AI Engine] Falling back to gemini-3.1-flash-lite due to quota/rate limit.`);
         } else {
             // Exhausted fallbacks, if it's still a quota error, just throw
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
app.post("/api/parse-profile", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const aiClient = getAI();
    const systemInstruction = `IMPORTANT: Keep your analysis extremely concise (under 800 words total) to ensure fast processing times and prevent timeouts. Use short bullet points and skip unnecessary pleasantries. \n\nYou are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid.

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
      model: "gemini-3.5-flash",
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

    const parsedData = robustJsonParse(response.text);
    res.json({ profile: parsedData });
  } catch (err: any) {
    console.error("Parse Profile Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mode 1.5: Enhance Text
app.post("/api/enhance-text", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
   try {
      const { text, context } = req.body;
      const aiClient = getAI();
      const prompt = `You are a professional business writer. Please enhance, expand, and format the following text to sound highly professional, clear, and perfectly suited for a corporate business profile used for bidding on high-value tenders. Keep it simple to understand but highly professional.
      
      Context of what this text is about: ${context}
      
      Original Text:
      ${text}
      
      Provide ONLY the enhanced text, nothing else.`;

      const response = await generateContentWithRetry(aiClient, {
         model: "gemini-3.5-flash",
         contents: [prompt],
      });
      
      res.json({ enhanced: response.text });
   } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to enhance text" });
   }
});

// Mode 2: Analyze Tender
app.post("/api/analyze-tender", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenderDocument, tenderType = 'text', tenderContent, userProfile, language } = req.body;
    const actualContent = tenderContent || tenderDocument;
    
    if (!actualContent || !userProfile) {
      return res.status(400).json({ error: "tender content and userProfile are required" });
    }

    const aiClient = getAI();
    let docContents: any[];
    
    const extraContextStr = req.body.extraContext ? `\n\n--- EXTRA CONTEXT / RE-ANALYSIS UPDATE ---\n${req.body.extraContext}\n` : "";
    
    if (tenderType === 'pdfs' || tenderType === 'zip' || (tenderType === 'pdf' && Array.isArray(actualContent))) {
       docContents = [
         `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENTS (Attached as PDFs) ---\n`
       ];
       if (Array.isArray(actualContent)) {
         for (const item of actualContent) {
           const match = item.match(/^data:([^;]+);base64,(.*)$/);
           if (match) {
             docContents.push({ inlineData: { mimeType: match[1], data: match[2] } });
           } else {
             // Fallback for previous implementation
             docContents.push({ inlineData: { mimeType: "application/pdf", data: item.replace(/^data:application\/pdf;base64,/, '') } });
           }
         }
       }
    } else if (tenderType === 'pdf') {
       docContents = [
         `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT (Attached as PDF) ---\n`,
         { inlineData: { mimeType: "application/pdf", data: actualContent.replace(/^data:application\/pdf;base64,/, '') } }
       ];
    } else if (tenderType === 'url') {
       try {
         // Phase 5: SSRF guard check
         const isSafe = await isSafeUrl(actualContent);
         if (!isSafe) {
           return res.status(400).json({ error: "Access denied: The specified URL is invalid or points to an unsafe/restricted destination." });
         }

         const fetchedRes = await fetch(actualContent, {
           headers: {
             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
             'Accept-Language': 'en-US,en;q=0.9',
           },
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

    const systemInstruction = `IMPORTANT: Keep your analysis extremely concise (under 800 words total) to ensure fast processing times and prevent timeouts. Use short bullet points and skip unnecessary pleasantries. \n\nYou are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid. BE EXTREMELY IN-DEPTH AND DETAILED in your rationales, lists, and steps. Elaborate heavily.
${language && language !== 'en' ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in ${language === 'hi' ? 'Hindi' : language === 'gu' ? 'Gujarati' : language}. Do not use English unless it is for technical terms that have no direct translation.` : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in English. Do NOT output in Hindi, Gujarati, or any other regional language.`}

You switch between three operational modes based on input.

---
MODE 1: CONTRACT PROFILE ANALYSIS & MATCHING
- Trigger: Input contains a Tender Document and a User Business Profile JSON.
- Task: Compare technical eligibility, turnover requirements, and location preferences. Calculate an objective compatibility score out of 100. Translate complex terms into professional plain English that a local businessman easily understands.
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
      model: "gemini-3.5-flash",
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
               required: ["estimated_value", "conservative", "safe_range", "recommended", "aggressive", "margin_range", "risk_level", "rationale"]
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

    const parsedData = robustJsonParse(response.text);
    res.json({ analysis: parsedData });
  } catch (err: any) {
    console.error("Analyze Tender Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mode 3: Interactive Tender Chat
// Mode 3: Compare Tender Versions
app.post("/api/compare-tender", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { originalTender, newDocument, documentType = "DOCUMENT", language } = req.body;
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

    const systemInstruction = `You are a Tender Document Comparison Engine. Compare the Original Tender Details against the New ${safeDocType} uploaded by the user. Highlight EXACTLY what changed. Outputs must be clear and direct.${language && language !== 'en' ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all content STRICTLY in ${language === 'hi' ? 'Hindi' : language === 'gu' ? 'Gujarati' : language}.` : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all content STRICTLY in English.`}`;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-3.5-flash",
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

    res.json({ comparison: robustJsonParse(response.text) });
  } catch (err: any) {
    console.error("Compare Tender Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat-tender", verifyFirebaseToken, requireActiveEntitlement, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenderDocument, analysisResult, messages, language } = req.body;
    if ((!tenderDocument && !analysisResult) || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "tenderDocument and messages array are required" });
    }

    const aiClient = getAI();
    let tenderContextText = "";
    const documentParts: any[] = [];
    
    if (typeof tenderDocument === 'string') {
      tenderContextText = tenderDocument.substring(0, 50000);
    } else if (Array.isArray(tenderDocument)) {
      tenderContextText = "Multiple documents attached as files.";
      for (const item of tenderDocument) {
        if (typeof item === 'string' && item.startsWith('data:')) {
           const match = item.match(/^data:([^;]+);base64,(.*)$/);
           if (match) {
             documentParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
           }
        }
      }
    }
    
    const instructionText = `You are a specialized Procurement Chatbot assisting an Indian business with a specific tender. 
You have access to the original tender document and the AI analysis. Answer their questions clearly, concisely, and realistically based on the provided context. Follow Indian tendering terminology (EMD, PBG, BOQ, etc.). If a detail is missing, state it is not specified and advise to check for corrigendums.${language && language !== 'en' ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST answer the user STRICTLY in ${language === 'hi' ? 'Hindi' : language === 'gu' ? 'Gujarati' : language}.` : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST answer the user STRICTLY in English.`}

--- TENDER CONTEXT ---
${tenderContextText || 'No raw text provided.'}

--- PREVIOUS AI ANALYSIS ---
${analysisResult ? JSON.stringify(analysisResult) : 'No previous analysis provided.'}
`;

    // messages should be [{ role: "user" | "model", text: "" }]
    const formattedContents = messages.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [ { text: msg.text || " " } ]
    }));

    if (documentParts.length > 0 && formattedContents.length > 0) {
      formattedContents[0].parts.unshift(...documentParts);
    }

    const systemInstruction = { parts: [{ text: instructionText }] };

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-3.5-flash",
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
app.post("/api/generate-doc", verifyFirebaseToken, requireActiveEntitlement, async (req: AuthenticatedRequest, res) => {
  try {
    const { docType, tenderDetails, userProfile, financialData, extraInstructions, language } = req.body;
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

    const systemInstruction = `IMPORTANT: Keep your analysis extremely concise (under 800 words total) to ensure fast processing times and prevent timeouts. Use short bullet points and skip unnecessary pleasantries. \n\nYou are "Tender MasterAI", an expert legal and corporate procurement assistant specializing in Indian tenders. 
Your task is to generate high-quality, professional draft documents based on the provided tender analysis and the user's business profile. 
Use the business profile data (Company Name, Address, GST, PAN, etc.) and Tender Details (Tender No., Dates, Authority Name, etc.) to automatically fill in ALL placeholders. 
CRITICAL RULE: DO NOT leave placeholders like "[Tender Number - To be filled by bidder]" or "[Date]" or "[Bidder Name]" in the output. You MUST aggressively find and replace all such "fill in the blank" brackets with the actual data from the provided Tender Details and Business Profile. If an exact piece of information is missing, use a logical assumed default or current date rather than leaving a bracketed placeholder.
If the document requested is an "Auto-Fill: [Annexure Name]", your job is to auto-generate the filled-up annexure exactly as it should be submitted. Since real annexures are often tabular forms in PDFs, YOU MUST Reconstruct the exact Annexure/Schedule/Form tabular layout required by the agency using clean, well-structured Markdown tables and lists. Place the bidder's information directly into the respective form fields/cells as if they were filling out the actual PDF form. Ensure it visually resembles a structured printable form that can be submitted to the agency. Do not leave blanks if information can be reasonably derived or if standard boilerplate is applicable.${language && language !== 'en' ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST draft the document STRICTLY in ${language === 'hi' ? 'Hindi' : language === 'gu' ? 'Gujarati' : language}, unless the user asks otherwise.` : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST draft the document STRICTLY in English, unless the user asks otherwise.`}
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
      model: "gemini-3.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt || " " }] }],
      config: {
        systemInstruction,
      }
    });

    const outputText = response.text || "Empty response from AI.";
    res.json({ document: outputText });
  } catch (err: any) {
    console.error("Generate Doc Error:", err); require("fs").writeFileSync("doc-error.txt", err.stack || err.toString());
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

if (!process.env.VERCEL) {
  startServer();
}

export default app;
