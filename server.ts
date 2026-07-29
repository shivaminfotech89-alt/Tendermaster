import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore as adminGetFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import Razorpay from "razorpay";
import crypto from "crypto";
import dns from "dns";
import { promisify } from "util";
// Bundled by esbuild (--bundle inlines local files; --packages=external only skips npm deps).
import { PLANS, TRIAL_CREDITS, TRIAL_DOC_LIMIT, CREDIT_VALIDITY_MONTHS } from './src/lib/plans';
import { probeAllPagesFromBuffer, isRetryable as isProbeRetryable } from './src/lib/modeb/probe-helpers';
import { buildAnalysisSystemInstruction, ANALYSIS_RESPONSE_SCHEMA, ANALYSIS_RESPONSE_SCHEMA_CHUNK } from './src/lib/analysisPrompt';
import { mergeChunkResults, validateAgainstAnalysisSchema, hasNoMeaningfulContent, classifyChunkCriticality, type ChunkCriticality } from './src/lib/analysisChunkMerge';
import { fmtINR } from './src/lib/boq/calculator';

const lookupPromise = promisify(dns.lookup);

// Derived from shared PLANS constant (bundled by esbuild --bundle; local files are inlined).
const PLAN_CREDITS_MAP: Record<number, { credits: number; adminOnly: boolean; id: string }> = Object.fromEntries(
  PLANS.map(p => [p.amountPaise, { credits: p.credits, adminOnly: p.adminOnly, id: p.id }])
) as Record<number, { credits: number; adminOnly: boolean; id: string }>;
const VALID_PAISE = new Set<number>(PLANS.map(p => p.amountPaise));

// ---------------------------------------------------------------------------
// Admin identity — single source of truth
// ---------------------------------------------------------------------------
const SUPERADMIN_EMAILS: string[] = (process.env.SUPERADMIN_EMAILS ?? "shivaminfotech89@gmail.com")
  .split(",")
  .map(e => e.trim())
  .filter(Boolean);

/** True when the user holds an admin/superadmin role OR matches the email fallback list. */
const isAdminRole = (role: string, email?: string): boolean =>
  role === "admin" || role === "superadmin" || SUPERADMIN_EMAILS.includes(email ?? "");

let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
} catch (err) {
  console.error("Failed to read firebase-applet-config.json", err);
}

if (admin.apps.length === 0) {
  try {
    const initOpts: admin.AppOptions = { projectId: firebaseConfig.projectId };

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // (1) Vercel / any host: service account JSON stored as an env var.
      // Vercel serialises multiline values with literal \n instead of real newlines,
      // so we restore them in private_key before passing to cert().
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      initOpts.credential = admin.credential.cert(parsed);
      console.log("[Firebase Admin] Initialised with FIREBASE_SERVICE_ACCOUNT env var");
    } else {
      const svcKeyPath = path.join(process.cwd(), "serviceAccountKey.json");
      if (fs.existsSync(svcKeyPath)) {
        // (2) Local dev: key file on disk.
        initOpts.credential = admin.credential.cert(
          JSON.parse(fs.readFileSync(svcKeyPath, "utf-8"))
        );
        console.log("[Firebase Admin] Initialised with serviceAccountKey.json");
      } else {
        // (3) GCP-hosted (Cloud Run, App Engine, Firebase Functions):
        //     ADC resolves via the metadata server automatically.
        //     Also covers GOOGLE_APPLICATION_CREDENTIALS if set.
        console.log("[Firebase Admin] Initialised with ADC");
      }
    }

    admin.initializeApp(initOpts);
  } catch (e) {
    console.error("Firebase admin init failed", e);
  }
}

const getFirestore = () =>
adminGetFirestore(getApp(), process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)");

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------
function robustJsonParse(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Failed standard JSON.parse, trying to clean markdown...");
    try {
      let cleaned = text.replace(/^[sS]*?```json/i, "").replace(/```[sS]*?$/, "").trim();
      return JSON.parse(cleaned);
    } catch (e2) {
      throw new Error("AI returned malformed data. Try again. " + (e2 as any).message);
    }
  }
}

const app = express();
const PORT = 3000;

app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));

interface AuthenticatedRequest extends express.Request {
  user?: { uid: string; email: string; decodedToken?: any };
}

// ---------------------------------------------------------------------------
// Phase 1: setEntitlementClaims — writes role + expiry to Firestore via Admin SDK.
// Falls back to Firestore REST PATCH (google-auth-library ADC) if Admin SDK throws.
// Never returns true when nothing was written.
// ---------------------------------------------------------------------------
const setEntitlementClaims = async (
  uid: string,
  claims: { role: string; subscriptionExpiry?: string }
): Promise<boolean> => {
  const payload: Record<string, any> = { role: claims.role };
  if (claims.subscriptionExpiry) {
    payload.subscriptionExpiry = Timestamp.fromDate(new Date(claims.subscriptionExpiry));
  }

  // Path A: Admin SDK (bypasses security rules, works in GCP with ADC / service account).
  try {
    const db = getFirestore();
    await db.collection("users").doc(uid).set(payload, { merge: true });
    console.log(`[Entitlement] Admin SDK write OK — uid=${uid} role=${claims.role}`);
    return true;
  } catch (adminErr: any) {
    console.error(`[Entitlement] Admin SDK write failed for uid=${uid}:`, adminErr.message);
  }

  // Path B: Firestore REST PATCH — uses serviceAccountKey.json when present,
  // falls back to ADC (GOOGLE_APPLICATION_CREDENTIALS / GCP metadata server).
  // Mirrors the same credential source as the Admin SDK (Path A).
  try {
    const svcKeyPath = path.join(process.cwd(), "serviceAccountKey.json");
    const authOpts: any = { scopes: ["https://www.googleapis.com/auth/datastore"] };
    if (fs.existsSync(svcKeyPath)) authOpts.keyFile = svcKeyPath;
    const gAuth = new GoogleAuth(authOpts);
    const client = await gAuth.getClient();
    const tokenRes = await client.getAccessToken();
    const token = tokenRes.token;
    if (!token) throw new Error("google-auth-library returned empty token");

 const dbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || "(default)";
    const docPath = `projects/${firebaseConfig.projectId}/databases/${dbId}/documents/users/${uid}`;

    const fields: Record<string, any> = { role: { stringValue: claims.role } };
    if (claims.subscriptionExpiry) {
      fields.subscriptionExpiry = {
        timestampValue: new Date(claims.subscriptionExpiry).toISOString(),
      };
    }
    const maskParams = Object.keys(fields)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join("&");
    const url = `https://firestore.googleapis.com/v1/${docPath}?${maskParams}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST PATCH ${res.status}: ${errText}`);
    }
    console.log(`[Entitlement] REST PATCH fallback OK — uid=${uid} role=${claims.role}`);
    return true;
  } catch (restErr: any) {
    console.error(`[Entitlement] REST PATCH fallback failed for uid=${uid}:`, restErr.message);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
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
    req.user = { uid: decodedToken.uid, email: decodedToken.email || "", decodedToken };
    next();
  } catch (error: any) {
    console.error("Firebase ID token verification failed:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

// ---------------------------------------------------------------------------
// requireCredits — credit-based gate (replaces requireActiveEntitlement).
// Admins/superadmins bypass. Lazy-migrates legacy premium users to 10 credits.
// ---------------------------------------------------------------------------
const requireCredits = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized: Authenticated user context required" });
  }

  try {
    const db = getFirestore();
    const snap = await db.collection("users").doc(uid).get();

    let role = "free";
    let creditsTotal = 0;
    let creditsUsed = 0;
    let creditsExpiry: Date | null = null;

    if (snap.exists) {
      const data = snap.data()!;
      role = data.role || "free";
      if (isAdminRole(role, req.user!.email)) return next();

      if (data.creditsTotal !== undefined) {
        creditsTotal = data.creditsTotal ?? 0;
        creditsUsed = data.creditsUsed ?? 0;
        creditsExpiry = data.creditsExpiry ? data.creditsExpiry.toDate() : null;
      } else if (data.subscriptionExpiry && data.subscriptionExpiry.toDate() > new Date()) {
        // Legacy migration: active premium user has no credit fields yet — grant 10 credits.
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + CREDIT_VALIDITY_MONTHS);
        await db.collection("users").doc(uid).update({
          creditsTotal: 10,
          creditsUsed: 0,
          creditsExpiry: Timestamp.fromDate(expiry),
        });
        console.log(`[Migration] Granted 10 legacy credits to uid=${uid}`);
        creditsTotal = 10;
        creditsUsed = 0;
        creditsExpiry = expiry;
      }
    } else {
      if (isAdminRole("", req.user!.email)) return next();
    }

    const now = new Date();
    if (creditsUsed < creditsTotal && creditsExpiry && creditsExpiry > now) {
      return next();
    }

    return res.status(403).json({
      error: "You've used all your analyses. Add more to continue — your existing projects and documents remain fully accessible.",
    });
  } catch (err) {
    console.error("[Credits] requireCredits failed:", err);
    return res.status(500).json({ error: "Failed to verify user credits." });
  }
};

// ---------------------------------------------------------------------------
// Trial-aware access middleware
// Three variants (type: 'doc' | 'export' | 'chat') via a factory so trial
// allowances stay separate from the analysis credit pool.
// ---------------------------------------------------------------------------
function incrementTrialDocUsed(uid: string) {
  getFirestore()
    .collection("users")
    .doc(uid)
    .update({ trialDocsUsed: FieldValue.increment(1) })
    .catch(e => console.error("[Trial] incrementTrialDocUsed failed:", e));
}

const requireTrialAwareAccess = (type: "doc" | "export" | "chat") =>
  async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized: Authenticated user context required" });
    try {
      const db = getFirestore();
      const snap = await db.collection("users").doc(uid).get();
      const data = snap.exists ? snap.data()! : {};
      const role: string = data.role || "free";
      if (isAdminRole(role, req.user!.email)) return next();

      const creditsTotal: number = data.creditsTotal ?? 0;
      const creditsUsed: number = data.creditsUsed ?? 0;
      const creditsExpiry: Date | null = data.creditsExpiry ? data.creditsExpiry.toDate() : null;
      const now = new Date();

      if (type === "doc") {
        // Trial users: ALWAYS route through trial doc allowance, regardless of unused analysis credit.
        // This prevents a document request from silently consuming the analysis credit.
        if (data.trialClaimed === true) {
          if ((data.trialDocsUsed ?? 0) < TRIAL_DOC_LIMIT) {
            (req as any).isTrialDocRequest = true;
            return next();
          }
          // Trial doc exhausted — fall through to normal credits (for users who also bought a plan)
        }
      } else if (type === "export") {
        // PDF/DOCX export is rendering-only (no AI call). Trial users always pass — the AI gate
        // was already enforced at generate-doc time.
        if (data.trialClaimed === true) return next();
      } else if (type === "chat") {
        // Chat is scoped to trial usage: passes only after the user has spent their analysis credit
        // (creditsUsed > 0), meaning they have an analyzed project to chat about.
        if (data.trialClaimed === true && creditsUsed > 0) return next();
      }

      // Normal credit check (paid users, or trial users who have exhausted their trial allowance)
      if (creditsUsed < creditsTotal && creditsExpiry && creditsExpiry > now) return next();

      return res.status(403).json({
        error: "You've used all your analyses. Add more to continue — your existing projects and documents remain fully accessible.",
      });
    } catch (err) {
      console.error("[Credits] requireTrialAwareAccess failed:", err);
      return res.status(500).json({ error: "Failed to verify user access." });
    }
  };

// ---------------------------------------------------------------------------
// Phase 3: SSRF guard
// ---------------------------------------------------------------------------
function isPrivateIp(addr: string): boolean {
  if (!addr) return true;
  // IPv4 loopback
  if (addr === "127.0.0.1" || addr.startsWith("127.")) return true;
  // IPv6 loopback
  if (addr === "::1") return true;
  // RFC-1918 class A
  if (addr.startsWith("10.")) return true;
  // Link-local (169.254.x.x) — covers AWS/GCP/Azure metadata endpoints
  if (addr.startsWith("169.254.")) return true;
  // RFC-1918 class C
  if (addr.startsWith("192.168.")) return true;
  // RFC-1918 class B: 172.16.0.0/12 = 172.16.x.x – 172.31.x.x
  const m172 = addr.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  // IPv6 ULA (fc00::/7 covers fc** and fd**)
  const lower = addr.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // IPv6 link-local
  if (lower.startsWith("fe80")) return true;
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(urlString);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return false;

    const hostname = parsedUrl.hostname;

    // Block IPv6 literals (e.g. http://[::1]/)
    if (hostname.startsWith("[")) return false;

    // Block known-bad hostnames before DNS
    if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return false;

    // Block raw private IPs in the hostname (no DNS needed)
    if (isPrivateIp(hostname)) return false;

    // DNS resolution — fails closed if unresolvable
    try {
      const { address } = await lookupPromise(hostname);
      if (isPrivateIp(address)) return false;
    } catch {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Wrapper that checks isSafeUrl before fetching.
// DNS is resolved once inside isSafeUrl; fetch uses the original URL immediately
// after (sub-millisecond gap on a single JS thread minimises TOCTOU risk).
async function safeFetch(urlString: string, options: RequestInit = {}): Promise<Response> {
  const safe = await isSafeUrl(urlString);
  if (!safe) {
    throw new Error(`SSRF guard: blocked unsafe URL — ${urlString}`);
  }
  return fetch(urlString, options);
}

// ---------------------------------------------------------------------------
// HTML document shell builder (Mode A PDF output)
// ---------------------------------------------------------------------------
function buildDocHtml(fragment: string, docType: string): string {
  const safeTitle = docType.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  @page { size: A4 portrait; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #111827;
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  .letterhead-guide {
    height: 44mm;
    border: 2px dashed #9ca3af;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    font-size: 9pt;
    font-family: Arial, sans-serif;
    margin-bottom: 14pt;
    letter-spacing: 0.03em;
    background: #f9fafb;
  }
  @media print { .letterhead-guide { display: none; } }
  .case-note {
    font-family: Arial, sans-serif;
    font-size: 9pt;
    color: #6b7280;
    font-style: italic;
    border-left: 3px solid #d1d5db;
    padding: 3pt 8pt;
    margin: 0 0 14pt;
    background: #f9fafb;
  }
  h1 { font-size: 15pt; font-weight: bold; text-align: center; margin: 0 0 10pt; }
  h2 { font-size: 12pt; font-weight: bold; margin: 14pt 0 5pt; }
  h3 { font-size: 11pt; font-weight: bold; margin: 10pt 0 4pt; text-decoration: underline; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
  li { margin-bottom: 2pt; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0 14pt; page-break-inside: auto; font-size: 10pt; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #374151; padding: 5pt 8pt; text-align: left; vertical-align: top; word-break: break-word; }
  th { background-color: #f3f4f6; font-weight: bold; }
  strong { font-weight: bold; }
  em { font-style: italic; }
</style>
</head>
<body>
  <div class="letterhead-guide">&#x2190; Letterhead reserved — 40 mm (Stage 2) &#x2192;</div>
  <div class="doc-body">${fragment}</div>
</body>
</html>`;
}

function buildFormDocHtml(fragment: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Form</title>
<style>
  @page { size: A4 portrait; margin: 12mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #111827; margin: 0; padding: 0; background: #ffffff; }
  /* page-layout: outer table whose thead/tfoot repeat on every printed page */
  table.page-layout { width: 100%; border-collapse: collapse; border: none; table-layout: fixed; }
  table.page-layout > thead { display: table-header-group; }
  table.page-layout > tfoot { display: table-footer-group; }
  table.page-layout > thead > tr > td,
  table.page-layout > tfoot > tr > td,
  table.page-layout > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
  #letterhead-header td { padding-bottom: 6pt; border-bottom: 1px solid #374151; }
  #letterhead-footer td { padding-top: 6pt; border-top: 1px solid #374151; }
  /* "print without letterhead": hide the header and footer rows */
  body.no-letterhead #letterhead-header,
  body.no-letterhead #letterhead-footer { display: none; }
  /* inner form tables */
  table:not(.page-layout) { width: 100%; border-collapse: collapse; margin: 8pt 0 14pt; page-break-inside: auto; font-size: 10pt; }
  table:not(.page-layout) tr { page-break-inside: avoid; }
  table:not(.page-layout) th,
  table:not(.page-layout) td { border: 1px solid #374151; padding: 5pt 8pt; text-align: left; vertical-align: top; word-break: break-word; }
  table:not(.page-layout) th { background-color: #f3f4f6; font-weight: bold; }
  h1 { font-size: 15pt; font-weight: bold; text-align: center; margin: 0 0 10pt; }
  h2 { font-size: 12pt; font-weight: bold; margin: 14pt 0 5pt; }
  h3 { font-size: 11pt; font-weight: bold; margin: 10pt 0 4pt; text-decoration: underline; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
  li { margin-bottom: 2pt; }
  strong { font-weight: bold; }
  em { font-style: italic; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>${fragment}</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Razorpay helpers
// ---------------------------------------------------------------------------
let razorpayInstance: Razorpay | null = null;
function getRazorpay(): Razorpay {
  if (!razorpayInstance) {
    let key_id = process.env.RAZORPAY_KEY_ID;
    let key_secret = process.env.RAZORPAY_KEY_SECRET;
    // Auto-swap if keys were accidentally inverted in the secrets panel
    if (key_id && !key_id.startsWith("rzp_") && key_secret && key_secret.startsWith("rzp_")) {
      [key_id, key_secret] = [key_secret, key_id];
    }
    if (!key_id || !key_secret) {
      throw new Error("Razorpay credentials not found in environment variables");
    }
    razorpayInstance = new Razorpay({ key_id, key_secret });
  }
  return razorpayInstance;
}

// ---------------------------------------------------------------------------
// Payment endpoints
// ---------------------------------------------------------------------------
app.post("/api/create-payment-link", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, currency = "INR", description, customer, callback_url } = req.body;
    if (!amount || !VALID_PAISE.has(Number(amount))) {
      return res.status(400).json({ error: "Invalid plan amount" });
    }
    const planMeta = PLAN_CREDITS_MAP[Number(amount)];
    if (planMeta?.adminOnly) {
      const db = getFirestore();
      const snap = await db.collection("users").doc(req.user!.uid).get();
      const userRole = snap.data()?.role || "free";
      if (!isAdminRole(userRole, req.user!.email)) {
        return res.status(403).json({ error: "This plan is not available" });
      }
    }
    const rzp = getRazorpay();
    const paymentLink = await rzp.paymentLink.create({
      amount,
      currency,
      description,
      customer,
      callback_url,
      callback_method: "get",
    });
    res.json(paymentLink);
  } catch (error: any) {
    console.error("Create payment link error:", error);
    const status = Number(error?.statusCode) || 400;
    res
      .status(status >= 100 && status < 600 ? status : 400)
      .json({ error: error?.error?.description || error?.message || "Failed to create payment link" });
  }
});

app.post("/api/create-order", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body;
    if (!amount || !VALID_PAISE.has(Number(amount))) {
      return res.status(400).json({ error: "Invalid plan amount" });
    }
    const planMetaOrder = PLAN_CREDITS_MAP[Number(amount)];
    if (planMetaOrder?.adminOnly) {
      const db = getFirestore();
      const snap = await db.collection("users").doc(req.user!.uid).get();
      const userRole = snap.data()?.role || "free";
      if (!isAdminRole(userRole, req.user!.email)) {
        return res.status(403).json({ error: "This plan is not available" });
      }
    }
    const rzp = getRazorpay();
    const order = await rzp.orders.create({ amount, currency, receipt });
    res.json(order);
  } catch (error: any) {
    console.error("Create order error:", error);
    res.status(400).json({ error: error.message || "Failed to create order" });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Verify payment — derive tier from Razorpay's authoritative amount,
// never from client-supplied body.
// ---------------------------------------------------------------------------
app.post("/api/verify-payment", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
    } = req.body;

    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    if (!razorpay_payment_id) {
      return res.status(400).json({ error: "Missing razorpay_payment_id" });
    }

    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_secret) throw new Error("Missing RAZORPAY_KEY_SECRET");

    let isVerified = false;

    if (razorpay_order_id && razorpay_signature) {
      // Standard order-based checkout
      const generated = crypto
        .createHmac("sha256", key_secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
      const expBuf = Buffer.from(generated);
      const actBuf = Buffer.from(razorpay_signature);
      if (expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf)) {
        isVerified = true;
      }
    } else if (razorpay_payment_link_id && razorpay_payment_link_status && razorpay_signature) {
      // Payment-link redirect signature
      const refId = razorpay_payment_link_reference_id || "";
      const text = `${razorpay_payment_link_id}|${refId}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
      const generated = crypto.createHmac("sha256", key_secret).update(text).digest("hex");
      const expBuf = Buffer.from(generated);
      const actBuf = Buffer.from(razorpay_signature);
      if (expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf)) {
        isVerified = true;
      }
    } else {
      return res.status(400).json({ error: "Missing required fields for signature verification" });
    }

    if (!isVerified) {
      return res.status(400).json({ success: false, error: "Signature mismatch" });
    }

    // Phase 2: fetch the authoritative payment record from Razorpay.
    // The client-supplied `amount` is deliberately ignored.
    const rzp = getRazorpay();
    const payment = await (rzp.payments as any).fetch(razorpay_payment_id);

    if (payment.status !== "captured") {
      return res.status(400).json({
        success: false,
        error: `Payment not captured (status: ${payment.status}). Please complete the payment.`,
      });
    }

    // Map authoritative amount (paise) → credits
    const authorizedAmountPaise = Number(payment.amount);
    const planMeta = PLAN_CREDITS_MAP[authorizedAmountPaise];
    if (!planMeta) {
      console.error(`[verify-payment] Unrecognised amount ${authorizedAmountPaise} paise for uid=${uid} — granting nothing`);
      logUsageEvent({ uid, type: 'payment_error', success: false, failureReason: `Unrecognised amount: ${authorizedAmountPaise} paise (verify-payment)`, amountPaise: authorizedAmountPaise });
      return res.status(400).json({ success: false, error: "Unrecognised payment amount. Please contact support." });
    }

    // Admin-only plan: verify the paying user is admin/superadmin
    if (planMeta.adminOnly) {
      const db = getFirestore();
      const userSnap = await db.collection("users").doc(uid).get();
      const userRole = userSnap.data()?.role || "free";
      if (!isAdminRole(userRole, req.user!.email)) {
        console.error(`[verify-payment] Non-admin uid=${uid} attempted admin_test plan — granting nothing`);
        return res.status(403).json({ success: false, error: "This plan is not available." });
      }
    }

    const granted = await grantCredits(uid, planMeta.credits, razorpay_payment_id);
    if (!granted) {
      return res.status(500).json({ success: false, error: "Failed to grant credits. Please contact support." });
    }

    return res.json({
      success: true,
      message: `Payment verified. ${planMeta.credits} ${planMeta.credits !== 1 ? "analyses" : "analysis"} added to your account.`,
      credits: planMeta.credits,
      paymentId: razorpay_payment_id,
    });
  } catch (error: any) {
    console.error("Verify payment error:", error);
    res.status(400).json({ error: error.message || "Failed to verify payment" });
  }
});

// ---------------------------------------------------------------------------
// Phase 4: Activation codes — reads from Firestore, marks used atomically.
// No hardcoded fallback code.
// ---------------------------------------------------------------------------
app.post("/api/activate-code", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Activation code is required" });

    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const normalized = code.trim().toUpperCase();

    // Check env-var codes (no hardcoded fallback — require explicit env var)
    const envCodes = (process.env.VALID_ACTIVATION_CODES || "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    if (envCodes.includes(normalized)) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      const granted = await setEntitlementClaims(uid, {
        role: "premium",
        subscriptionExpiry: expiry.toISOString(),
      });
      if (!granted) {
        return res.status(500).json({ error: "Failed to activate premium account." });
      }
      return res.json({
        success: true,
        message: "Premium activated for 30 days! Your account will update shortly.",
        newExpiry: expiry.toISOString(),
      });
    }

    // Check Firestore activation_codes collection and mark used atomically
    const db = getFirestore();
    const codeRef = db.collection("activation_codes").doc(normalized);
    const codeSnap = await codeRef.get();

    if (!codeSnap.exists) {
      return res.status(400).json({ error: "Invalid activation code" });
    }

    const codeData = codeSnap.data() || {};

    if (codeData.used === true) {
      return res.status(400).json({ error: "This activation code has already been used" });
    }
    if (codeData.status !== "active") {
      return res.status(400).json({ error: "This activation code is no longer active" });
    }

    const days: number = codeData.durationDays || 30;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);

    // Mark used before writing entitlement to prevent race-condition double-use
    await codeRef.update({ used: true, usedBy: uid, usedAt: Timestamp.now() });

    const granted = await setEntitlementClaims(uid, {
      role: "premium",
      subscriptionExpiry: expiry.toISOString(),
    });

    if (!granted) {
      // Roll back used flag so the user can retry
      await codeRef.update({ used: false, usedBy: null, usedAt: null });
      return res.status(500).json({ error: "Failed to activate premium account." });
    }

    return res.json({
      success: true,
      message: `Premium activated for ${days} days! Your account will update shortly.`,
      newExpiry: expiry.toISOString(),
    });
  } catch (error: any) {
    console.error("Activate code error:", error);
    return res.status(500).json({ error: error.message || "Failed to redeem activation code" });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: Razorpay webhook — signature already verified before processing.
// Amount comes from the verified Razorpay payload, not from the client.
// ---------------------------------------------------------------------------
app.post("/api/razorpay-webhook", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      console.warn("[Webhook] Missing x-razorpay-signature header");
      return res.status(400).json({ error: "Missing signature" });
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Webhook] RAZORPAY_WEBHOOK_SECRET not configured");
      return res.status(400).json({ error: "Webhook secret missing from server configuration" });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      console.error("[Webhook] req.rawBody undefined — check body-parser configuration");
      return res.status(400).json({ error: "Raw body verification failed" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const expBuf = Buffer.from(expectedSignature);
    const actBuf = Buffer.from(signature);
    const isValidSignature =
      expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf);

    if (!isValidSignature) {
      console.warn("[Webhook] Signature verification failed");
      return res.status(400).json({ error: "Signature verification failed" });
    }

    const event = req.body;
    if (event.event === "payment.captured" || event.event === "payment.authorized") {
      const entity = event.payload?.payment?.entity;
      const email = entity?.email;
      // Amount comes from the verified webhook payload — trusted source
      const amountPaise = Number(entity?.amount || 0);

      const paymentId: string = entity?.id || "";
      if (email && paymentId) {
        try {
          const planMeta = PLAN_CREDITS_MAP[amountPaise];
          if (!planMeta) {
            console.error(`[Webhook] Unrecognised amount ${amountPaise} paise for ${email} — granting nothing`);
            logUsageEvent({ uid: '', type: 'payment_error', success: false, failureReason: `Unrecognised amount: ${amountPaise} paise (webhook)`, amountPaise, email });
          } else {
            const userRecord = await getAuth().getUserByEmail(email);
            if (userRecord?.uid) {
              if (planMeta.adminOnly) {
                const db = getFirestore();
                const snap = await db.collection("users").doc(userRecord.uid).get();
                const userRole = snap.data()?.role || "free";
                if (!isAdminRole(userRole, userRecord.email)) {
                  console.error(`[Webhook] Non-admin ${email} attempted admin_test plan — granting nothing`);
                } else {
                  await grantCredits(userRecord.uid, planMeta.credits, paymentId);
                  console.log(`[Webhook] Granted ${planMeta.credits} credits to ${email} (admin_test)`);
                }
              } else {
                await grantCredits(userRecord.uid, planMeta.credits, paymentId);
                console.log(`[Webhook] Granted ${planMeta.credits} credits to ${email}`);
              }
            }
          }
        } catch (e) {
          console.error(`[Webhook] Failed to grant credits for ${email}:`, e);
        }
      }
    }
    res.json({ status: "ok" });
  } catch (error: any) {
    console.error("[Webhook] Exception:", error);
    res.status(400).json({ error: error.message || "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// Gemini AI helpers
// ---------------------------------------------------------------------------
let ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY environment variable is required");
    ai = new GoogleGenAI({ apiKey: key });
  }
  return ai;
}

async function generateContentWithRetry(client: GoogleGenAI, options: any, retries = 8) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await client.models.generateContent(options);
    } catch (err: any) {
      const errString = err?.message || err?.toString() || JSON.stringify(err) || "";
      const isQuotaError =
        errString.toLowerCase().includes("quota") || errString.includes("429");
      let isRetryable =
        err?.status === 503 ||
        errString.includes("503") ||
        errString.includes("UNAVAILABLE") ||
        errString.includes("high demand") ||
        errString.includes("busy");
      let delay = 4000 * Math.pow(1.5, i);
      let modelChanged = false;

      if (isQuotaError || (isRetryable && i > 1)) {
        isRetryable = true;
        if (options.model === "gemini-3.5-flash") {
          options.model = "gemini-3.1-flash-lite";
          modelChanged = true;
          console.warn("[AI Engine] Falling back to gemini-3.1-flash-lite");
        } else {
          if (isQuotaError) throw err;
        }
        const match = errString.match(/retry in ([\d\.]+)s/i);
        if (modelChanged) delay = 1000;
        else if (match?.[1]) delay = parseFloat(match[1]) * 1000 + 1000;
        else if (isQuotaError) delay = 1000;
        else delay = 10000 * Math.pow(1.5, i);
      }

      if (isRetryable) {
        console.warn(
          `[AI Engine] Retrying in ${delay.toFixed(0)}ms (${i + 1}/${retries + 1})…`
        );
        if (i < retries) {
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// Analysis safety helpers
// ---------------------------------------------------------------------------

async function checkRateLimit(uid: string): Promise<{ blocked: boolean; minutesUntilReset: number }> {
  try {
    const snap = await getFirestore().collection("analysis_rate_limits").doc(uid).get();
    if (!snap.exists) return { blocked: false, minutesUntilReset: 0 };
    const data = snap.data()!;
    const windowStart: number = data.windowStart?.toMillis?.() ?? 0;
    const count: number = data.count ?? 0;
    const elapsed = Date.now() - windowStart;
    if (elapsed >= 3_600_000) return { blocked: false, minutesUntilReset: 0 };
    if (count >= 5) {
      const minutesUntilReset = Math.ceil((3_600_000 - elapsed) / 60_000);
      return { blocked: true, minutesUntilReset };
    }
    return { blocked: false, minutesUntilReset: 0 };
  } catch (err) {
    console.error("[RateLimit] checkRateLimit error:", err);
    return { blocked: false, minutesUntilReset: 0 }; // fail open — don't block on read error
  }
}

async function recordFailedAttempt(uid: string): Promise<void> {
  try {
    const ref = getFirestore().collection("analysis_rate_limits").doc(uid);
    const snap = await ref.get();
    const now = new Date();
    if (!snap.exists) {
      await ref.set({ count: 1, windowStart: Timestamp.fromDate(now) });
      return;
    }
    const windowStart: number = snap.data()!.windowStart?.toMillis?.() ?? 0;
    if (Date.now() - windowStart >= 3_600_000) {
      await ref.set({ count: 1, windowStart: Timestamp.fromDate(now) });
    } else {
      await ref.update({ count: FieldValue.increment(1) });
    }
    console.log(`[RateLimit] Recorded failed attempt for ${uid}`);
  } catch (err) {
    console.error("[RateLimit] recordFailedAttempt error:", err);
  }
}

interface LowConfidenceResult { isLow: boolean; missing: string[] }

function detectLowConfidence(parsed: any): LowConfidenceResult {
  const missing: string[] = [];
  const deadline = parsed?.timeline_and_milestones?.submission_deadline;
  if (!deadline || !String(deadline).trim()) missing.push("submission deadline");
  const emd = parsed?.emd_details?.amount;
  if (!emd || !String(emd).trim() || emd === "Not specified") missing.push("EMD amount");
  const matrix = parsed?.compliance_matrix;
  if (!Array.isArray(matrix) || matrix.length === 0) missing.push("compliance matrix");
  return { isLow: missing.length > 0, missing };
}

/** Resolves the real uploaded filename for a positional index, given the
 *  request's parallel-indexed `fileNames` array (present for storage_urls
 *  uploads — multi-PDF and ZIP alike, ZIP entries use their in-zip
 *  basename; absent for the text/url-paste paths, which have no file
 *  identity to begin with). Falls back to a positional label ONLY when a
 *  real name is genuinely missing for that index — never silently renders
 *  a wrong name. Shared by both the Tier-1 storage_urls skip/notes
 *  messages and Tier-2's chunk-planning sourceLabels so the two tiers
 *  never disagree on what a file is called. */
function resolveFileLabel(fileNames: unknown, index: number): string {
  const rawName = Array.isArray(fileNames) ? fileNames[index] : null;
  return typeof rawName === "string" && rawName.trim().length > 0 ? rawName : `File ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Shared analysis prompt + schema — used by BOTH the Tier-1 synchronous path
// (/api/analyze-tender) and the Tier-2 async job path (/api/process-analysis-job).
// Extracted verbatim (byte-identical content) from the original inline
// Tier-1 call so the two tiers can never drift into producing different
// output shapes — that drift is the single highest-risk failure mode for
// this feature (downstream BOQ/Financial code depends on this exact shape).
// ---------------------------------------------------------------------------

// Above this estimated-token count, /api/analyze-tender routes new analyses
// (storage_urls/url/text paths only, see the route for the full scope note)
// to the async Tier-2 job path instead of running the Gemini call inline.
const TIER2_TOKEN_THRESHOLD = 900_000;

// Above this many files in one storage_urls submission, route to Tier-2
// chunking instead of Tier-1's single call — a ROUTING trigger, not a skip
// trigger (no file is ever dropped for count reasons; see the file-count
// gate in /api/analyze-tender). This is the same number the old, removed
// MAX_FILES skip used, kept only because there's no evidence it was ever
// wrong for Tier-1 — not because it maps to any real Gemini per-request
// file ceiling (none was found; the real constraints are the token
// threshold above and the PDF-byte cap below, both already count-agnostic).
const TIER1_SAFE_FILE_COUNT = 10;

// Defense-in-depth backstop for Tier-2 job creation: one job doc + one doc
// per chunk are written in a single db.batch(), and Firestore caps a batch
// at 500 writes. Kept comfortably below that (not AT 500) so the job doc
// itself never pushes an already-borderline plan over the edge. In
// practice this is effectively unreachable — at ~150k tokens/chunk
// (CHUNK_TOKEN_TARGET), 490 chunks is ~73.5M tokens, far beyond anything
// the 100MB Tier-1 PDF-byte cap or realistic tender sizes would ever
// produce; the more realistic (if still rare) way to approach it is many
// small files whose criticality tiers keep alternating, which forces
// smaller per-chunk grouping than the token budget alone would.
const TIER2_MAX_CHUNKS = 490;

// Moved to src/lib/analysisPrompt.ts (byte-identical content) so the merge
// module's schema-validation gate can import the exact same schema without
// pulling in server.ts's own top-level side effects. buildAnalysisSystemInstruction
// and ANALYSIS_RESPONSE_SCHEMA are imported from there — see the top of this file.

// ---------------------------------------------------------------------------
// Tier-2 chunk planning (Step B) — splits a set of already-fetched files
// into analysis chunks along LOGICAL SECTION boundaries wherever possible,
// never mid-section unless genuinely unavoidable. Runs once, at job-creation
// time, in /api/analyze-tender; the resulting plan is persisted so worker
// calls never re-fetch/re-extract text and can resume from exactly where
// they left off.
// ---------------------------------------------------------------------------

// Target token budget per chunk — keeps each chunk's own Gemini call well
// inside its ~60-90s per-chunk time budget. A conservative starting
// estimate (~1/6th of the whole-document Tier-2 threshold), not yet tuned
// against real large-tender timing — revisit once Step B/C see real usage.
const CHUNK_TOKEN_TARGET = 150_000;

// Per-chunk retry ceiling — deliberately much lower than
// generateContentWithRetry's default (8), so a single chunk's worst-case
// retry backoff can't itself exceed the chunk's time budget. Does not
// change generateContentWithRetry's own logic, only how many times a chunk
// call is allowed to invoke it (Tier-1 and Step A's whole-job call both
// keep the untouched default).
const CHUNK_RETRY_CEILING = 2;

// If a chunk is 'running' and its startedAt is older than this, treat it as
// abandoned and safe to reclaim. Tighter than JOB_STALE_MS (whole-job scope,
// defined near /api/process-analysis-job) since a single chunk's own budget
// is much smaller than a whole job's.
const CHUNK_STALE_MS = 3 * 60_000;

// Heading heuristics for splitting ONE large text file into logical
// sections when it alone exceeds CHUNK_TOKEN_TARGET. Tried in this order;
// the first pattern that finds ANY matches in the text is used exclusively
// (mixing patterns risks over-splitting on false positives from a weaker
// pattern). This is a heuristic, not a guarantee — genuinely unstructured
// text falls through to paragraph-boundary splitting, then a hard
// character cut as an absolute last resort (the explicitly-allowed
// "unavoidable" case).
const CHUNK_HEADING_PATTERNS: RegExp[] = [
  // "SECTION 3", "CHAPTER II:", "PART A -" style section markers.
  /^(?:SECTION|CHAPTER|PART)\s+[IVXLC\d]+\b.{0,80}$/im,
  // "3. ELIGIBILITY CRITERIA", "12. BILL OF QUANTITIES" — numbered headings.
  /^\d{1,2}\.\s+[A-Z][A-Z0-9 ,.&()\/\-]{5,80}$/m,
  // Bare ALL-CAPS heading lines, e.g. "TERMS AND CONDITIONS", "SCOPE OF WORK".
  /^[A-Z][A-Z0-9 ,.&()\/\-]{8,80}$/m,
];

function findSectionBreakOffsets(text: string): number[] {
  for (const pattern of CHUNK_HEADING_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const re = new RegExp(pattern.source, flags);
    const offsets: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      offsets.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width matches
    }
    if (offsets.length > 0) return offsets;
  }
  return [];
}

/** Splits one large text into chunks no larger than targetChars, cutting
 *  only at detected section-heading offsets when available; falls back to
 *  paragraph boundaries, then a hard character cut, only when no heading
 *  structure is found at all (the "unavoidable" case per spec). */
function sliceTextIntoSections(text: string, targetChars: number): string[] {
  if (text.length <= targetChars) return [text];

  let breaks = findSectionBreakOffsets(text);
  if (breaks.length === 0) {
    breaks = [];
    const paraRe = /\n\s*\n/g;
    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(text)) !== null) breaks.push(m.index + m[0].length);
  }
  const cutPoints = Array.from(new Set<number>([0, ...breaks, text.length])).sort((a, b) => a - b);

  const slices: string[] = [];
  let sliceStart = 0;
  let lastGoodCut = 0;
  for (let i = 1; i < cutPoints.length; i++) {
    const point = cutPoints[i];
    if (point - sliceStart > targetChars) {
      if (lastGoodCut > sliceStart) {
        slices.push(text.slice(sliceStart, lastGoodCut));
        sliceStart = lastGoodCut;
      }
      // else: a single section between cut points is itself bigger than
      // targetChars — nothing to cut at yet; it becomes its own oversized
      // slice below, hard-split as the last resort.
    }
    lastGoodCut = point;
  }
  if (sliceStart < text.length) slices.push(text.slice(sliceStart));

  const result: string[] = [];
  for (const slice of slices) {
    if (slice.length <= targetChars * 1.5) { result.push(slice); continue; }
    for (let off = 0; off < slice.length; off += targetChars) {
      result.push(slice.slice(off, off + targetChars));
    }
  }
  return result;
}

interface Tier2FileEntry {
  sourceLabel: string;
  kind: "text" | "pdf";
  text?: string;         // kind === "text"
  storageUrl?: string;   // kind === "pdf" — re-fetched at chunk-process time (never persisted, avoids Firestore doc-size limits on raw PDF bytes)
  mimeType?: string;     // kind === "pdf"
  estimatedTokens: number;
}

interface Tier2FileSkipped {
  index: number;
  fileName: string;
  reason: string;
}

/** Fetches and normalizes Tier-2 source content into a flat list of
 *  file-like entries — the SAME fetch logic Tier-1/Step A already use for
 *  storage_urls/url/text, just run once up front so text is extracted
 *  exactly once and reused for the whole chunk plan. `fileNames` (when
 *  available, storage_urls only) gives each entry its real filename as a
 *  criticality-classification signal instead of a positional "file N".
 *  Also returns the SAME file-level accounting Tier-1 already surfaces on
 *  its Analysis Notes panel (totalFilesProvided/filesAnalyzed/filesSkipped)
 *  — Tier-2's chunk-based pipeline has no other point where this is known
 *  at a per-FILE granularity (chunks can span multiple files), so it's
 *  computed once here and threaded through the job doc to finalizeJob. */
async function fetchTier2FileEntries(
  tenderType: string,
  tenderContent: any,
  fileNames?: string[] | null,
): Promise<{ entries: Tier2FileEntry[]; notes: string[]; totalFilesProvided: number; filesAnalyzed: number; filesSkipped: Tier2FileSkipped[] }> {
  const notes: string[] = [];
  const entries: Tier2FileEntry[] = [];
  const filesSkipped: Tier2FileSkipped[] = [];
  let totalFilesProvided = 1;

  if (tenderType === "storage_urls") {
    // No file-count cap here — Tier-2 chunking exists precisely to handle
    // submissions Tier-1 can't take in one call, whether that's driven by
    // token volume or file count (see TIER1_SAFE_FILE_COUNT at the call
    // site). Every provided file gets fetched and chunked; the only limit
    // left is TIER2_MAX_CHUNKS, enforced once in createTier2Job after
    // planning, as a clear error rather than a silent per-file skip.
    const allUrls: string[] = Array.isArray(tenderContent) ? tenderContent : [];
    totalFilesProvided = allUrls.length;
    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      const label = resolveFileLabel(fileNames, i);
      try {
        const fetched = await safeFetch(url);
        if (!fetched.ok) {
          const reason = `Fetch failed (HTTP ${fetched.status})`;
          notes.push(`${label}: skipped — fetch failed (HTTP ${fetched.status})`);
          filesSkipped.push({ index: i, fileName: label, reason });
          continue;
        }
        const contentType = fetched.headers.get("content-type") || "application/pdf";
        const buffer = await fetched.arrayBuffer();
        if (contentType.includes("text/plain")) {
          const text = Buffer.from(buffer).toString("utf-8");
          entries.push({ sourceLabel: label, kind: "text", text, estimatedTokens: Math.round(text.length / 4) });
        } else {
          const bytes = buffer.byteLength;
          entries.push({
            sourceLabel: label,
            kind: "pdf",
            storageUrl: url,
            mimeType: contentType,
            // No extracted text to estimate from — a conservative
            // bytes-based proxy (Vision/image content is more
            // token-expensive per byte than plain text, so this is
            // deliberately generous rather than under-estimating).
            estimatedTokens: Math.round(bytes / 3),
          });
        }
      } catch (err) {
        console.error("[fetchTier2FileEntries] Failed to fetch storage URL", url, err);
        notes.push(`${label}: skipped — network error`);
        filesSkipped.push({ index: i, fileName: label, reason: "Network error fetching file" });
      }
    }
  } else if (tenderType === "url") {
    const fetchedRes = await safeFetch(tenderContent, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!fetchedRes.ok) throw new Error(`Failed to fetch URL: ${fetchedRes.statusText}`);
    const htmlContent = await fetchedRes.text();
    const cleanText = htmlContent
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]*>?/gm, " ");
    entries.push({ sourceLabel: "fetched URL", kind: "text", text: cleanText, estimatedTokens: Math.round(cleanText.length / 4) });
  } else {
    const text = String(tenderContent);
    entries.push({ sourceLabel: "pasted text", kind: "text", text, estimatedTokens: Math.round(text.length / 4) });
  }

  return { entries, notes, totalFilesProvided, filesAnalyzed: entries.length, filesSkipped };
}

interface Tier2ChunkPart {
  sourceLabel: string;
  kind: "text" | "pdf_ref";
  text?: string;
  storageUrl?: string;
  mimeType?: string;
  criticality: ChunkCriticality;
}
interface Tier2ChunkPlan {
  parts: Tier2ChunkPart[];
  estimatedTokens: number;
  sourceLabel: string;
  criticality: ChunkCriticality;
}

/** Level 1: groups whole files (or Level-2 text slices) into chunks up to
 *  CHUNK_TOKEN_TARGET, never splitting a piece itself. Level 2: splits any
 *  single oversized TEXT entry into section-based slices first (see
 *  sliceTextIntoSections). A single oversized PDF (image-path, no
 *  extracted text) becomes its own one-file chunk regardless — splitting a
 *  raw PDF byte stream would need page-level manipulation, which is out of
 *  scope here (that territory belongs to BOQ Extraction, which this
 *  feature must not touch) — a known, flagged Step B limitation.
 *
 *  Each piece is classified for criticality BEFORE token-budget grouping
 *  (image-path PDFs are unconditionally financial_critical; text pieces are
 *  classified from their sourceLabel + own text, which includes any section
 *  heading as its first line — see classifyChunkCriticality). Pieces of
 *  different criticality are NEVER merged into the same chunk, so every
 *  resulting chunk has one unambiguous criticality — required so a partial
 *  failure's blast radius (block vs. flag-and-continue) is never ambiguous. */
function planTier2Chunks(entries: Tier2FileEntry[]): Tier2ChunkPlan[] {
  const targetChars = CHUNK_TOKEN_TARGET * 4;

  const pieces: Tier2ChunkPart[] = [];
  const pieceTokens: number[] = [];
  for (const entry of entries) {
    if (entry.kind === "pdf") {
      const criticality = classifyChunkCriticality({ isImagePath: true, sourceLabel: entry.sourceLabel });
      pieces.push({ sourceLabel: entry.sourceLabel, kind: "pdf_ref", storageUrl: entry.storageUrl, mimeType: entry.mimeType, criticality });
      pieceTokens.push(entry.estimatedTokens);
      continue;
    }
    const text = entry.text!;
    if (entry.estimatedTokens <= CHUNK_TOKEN_TARGET) {
      const criticality = classifyChunkCriticality({ isImagePath: false, sourceLabel: entry.sourceLabel, text });
      pieces.push({ sourceLabel: entry.sourceLabel, kind: "text", text, criticality });
      pieceTokens.push(entry.estimatedTokens);
      continue;
    }
    const slices = sliceTextIntoSections(text, targetChars);
    slices.forEach((slice, i) => {
      const sourceLabel = slices.length > 1 ? `${entry.sourceLabel} (part ${i + 1}/${slices.length})` : entry.sourceLabel;
      const criticality = classifyChunkCriticality({ isImagePath: false, sourceLabel, text: slice });
      pieces.push({ sourceLabel, kind: "text", text: slice, criticality });
      pieceTokens.push(Math.round(slice.length / 4));
    });
  }

  const chunks: Tier2ChunkPlan[] = [];
  let currentParts: Tier2ChunkPart[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (currentParts.length === 0) return;
    chunks.push({
      parts: currentParts,
      estimatedTokens: currentTokens,
      sourceLabel: currentParts.map(p => p.sourceLabel).join(" + "),
      criticality: currentParts[0].criticality,
    });
    currentParts = [];
    currentTokens = 0;
  };
  for (let i = 0; i < pieces.length; i++) {
    const tokens = pieceTokens[i];
    const criticalityChanged = currentParts.length > 0 && currentParts[0].criticality !== pieces[i].criticality;
    if (currentParts.length > 0 && (criticalityChanged || currentTokens + tokens > CHUNK_TOKEN_TARGET)) flush();
    currentParts.push(pieces[i]);
    currentTokens += tokens;
  }
  flush();

  return chunks;
}

/** Creates a Tier-2 analysis_jobs doc + its chunks subcollection — the
 *  SAME job-creation logic regardless of which trigger fired (file count
 *  over TIER1_SAFE_FILE_COUNT, or estimated tokens over
 *  TIER2_TOKEN_THRESHOLD). Shared so the two independent routing triggers
 *  in /api/analyze-tender can never drift into creating differently-shaped
 *  jobs. estimatedTokens is computed from the real chunk plan (sum of each
 *  chunk's own estimate) rather than passed in, so it's accurate for BOTH
 *  call sites, including the count-triggered one which fires before the
 *  Tier-1 docContents token scan would otherwise compute it. */
async function createTier2Job(
  db: FirebaseFirestore.Firestore,
  params: {
    uid: string;
    tenderType: string;
    actualContent: any;
    fileNames: string[] | null;
    userProfile: string;
    language: string | null;
    extraContext: string | null;
    userProjectName: string | null;
  },
): Promise<
  | { ok: true; jobId: string; chunkCount: number }
  | { ok: false; status: number; error: string }
> {
  const { uid, tenderType, actualContent, fileNames, userProfile, language, extraContext, userProjectName } = params;

  const { entries, notes, totalFilesProvided, filesAnalyzed, filesSkipped } = await fetchTier2FileEntries(tenderType, actualContent, fileNames);
  const chunkPlan = planTier2Chunks(entries);
  if (chunkPlan.length === 0) {
    return {
      ok: false, status: 422,
      error: "No readable content could be fetched for analysis. If this is a scanned PDF, please upload the original PDF file directly.",
    };
  }
  if (chunkPlan.length > TIER2_MAX_CHUNKS) {
    // Defense-in-depth backstop, not a real-world path — see
    // TIER2_MAX_CHUNKS's comment. A clear, actionable error either way,
    // never a silent drop of any of these chunks/files.
    return {
      ok: false, status: 413,
      error: `This tender is too large even for chunked analysis (${chunkPlan.length} sections). Please split it into smaller batches or contact support.`,
    };
  }
  const estimatedTokens = chunkPlan.reduce((sum, c) => sum + c.estimatedTokens, 0);

  const jobRef = db.collection("analysis_jobs").doc();
  const batch = db.batch();
  batch.set(jobRef, {
    uid,
    status: "queued",
    tier: 2,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    estimatedTokens,
    chunkCount: chunkPlan.length,
    chunksDone: 0,
    chunksFailed: 0,
    chunkPlanNotes: notes,
    totalFilesProvided,
    filesAnalyzed,
    filesSkipped,
    request: {
      tenderType,
      tenderContent: actualContent,
      userProfile,
      language: language ?? null,
      extraContext: extraContext ?? null,
      fileNames: Array.isArray(fileNames) && fileNames.length > 0 ? fileNames : null,
      projectName: (typeof userProjectName === "string" && userProjectName.trim()) ? userProjectName.trim() : null,
    },
  });
  chunkPlan.forEach((chunk, index) => {
    const chunkRef = jobRef.collection("chunks").doc(String(index));
    batch.set(chunkRef, {
      index,
      status: "pending",
      sourceLabel: chunk.sourceLabel,
      parts: chunk.parts,
      estimatedTokens: chunk.estimatedTokens,
      criticality: chunk.criticality,
      retryCount: 0,
      createdAt: Timestamp.now(),
      startedAt: null,
      updatedAt: Timestamp.now(),
      result: null,
      reason: null,
    });
  });
  await batch.commit();
  return { ok: true, jobId: jobRef.id, chunkCount: chunkPlan.length };
}

// ---------------------------------------------------------------------------
// Credit helpers
// ---------------------------------------------------------------------------

async function grantCredits(uid: string, credits: number, paymentId: string): Promise<boolean> {
  const db = getFirestore();
  const processedRef = db.collection("processed_payments").doc(paymentId);
  const userRef = db.collection("users").doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const processedSnap = await tx.get(processedRef);
      if (processedSnap.exists) {
        console.log(`[Credits] Payment ${paymentId} already processed — skipping double-grant`);
        return;
      }
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data() || {};
      const now = new Date();
      const candidateExpiry = new Date(now);
      candidateExpiry.setMonth(candidateExpiry.getMonth() + CREDIT_VALIDITY_MONTHS);
      let finalExpiry = candidateExpiry;
      if (userData.creditsExpiry) {
        const existing: Date = userData.creditsExpiry.toDate();
        if (existing > candidateExpiry) finalExpiry = existing;
      }
      tx.set(processedRef, { uid, credits, paymentId, processedAt: Timestamp.now() });
      tx.set(userRef, {
        creditsTotal: FieldValue.increment(credits),
        creditsExpiry: Timestamp.fromDate(finalExpiry),
      }, { merge: true });
    });
    console.log(`[Credits] Granted ${credits} credits to uid=${uid} (payment=${paymentId})`);
    return true;
  } catch (err) {
    console.error(`[Credits] grantCredits failed uid=${uid} payment=${paymentId}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Usage event logging — fire-and-forget; Admin SDK bypasses Firestore rules.
// ---------------------------------------------------------------------------
function logUsageEvent(event: {
  uid: string;
  type: 'analysis' | 'reanalysis' | 'document' | 'chat' | 'extraction' | 'payment_error' | 'modeb_probe';
  projectId?: string;
  success: boolean;
  failureReason?: string;
  lowConfidence?: boolean;
  amountPaise?: number;
  email?: string;
}): void {
  try {
    // Strip undefined fields: Firestore Admin SDK throws synchronously on undefined
    // values before a Promise is created, bypassing .catch().
    const doc: Record<string, unknown> = { timestamp: Timestamp.now() };
    for (const [k, v] of Object.entries(event)) {
      if (v !== undefined) doc[k] = v;
    }
    getFirestore()
      .collection('usage_events')
      .add(doc)
      .catch(err => console.warn('[UsageEvent] Failed to log (async):', err.message));
  } catch (err: any) {
    console.warn('[UsageEvent] Failed to log (sync):', err.message);
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.post("/api/claim-trial", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  try {
    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (snap.exists && snap.data()?.trialClaimed === true) return; // idempotent
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + CREDIT_VALIDITY_MONTHS);
      tx.set(userRef, {
        creditsTotal: FieldValue.increment(TRIAL_CREDITS),
        creditsUsed: 0,
        creditsExpiry: Timestamp.fromDate(expiry),
        trialClaimed: true,
      }, { merge: true });
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[Trial] claim-trial failed:", err);
    return res.status(500).json({ error: "Failed to claim trial credits" });
  }
});

app.post("/api/admin/grant-credits", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const callerUid = req.user!.uid;
  const { uid: targetUid, credits } = req.body;
  if (!targetUid || typeof credits !== "number" || credits < 1) {
    return res.status(400).json({ error: "uid and credits (positive integer) are required" });
  }
  try {
    const db = getFirestore();
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const callerRole = callerSnap.exists ? (callerSnap.data()?.role || "free") : "free";
    if (!isAdminRole(callerRole, req.user!.email)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const paymentId = `admin_grant_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await grantCredits(targetUid, credits, paymentId);
    console.log(`[Admin] ${callerUid} granted ${credits} credits to ${targetUid}`);
    return res.json({ success: true, credits });
  } catch (err: any) {
    console.error("[Admin] grant-credits failed:", err);
    return res.status(500).json({ error: "Failed to grant credits" });
  }
});

// ---------------------------------------------------------------------------
// Admin read-only stats endpoints (Admin SDK reads bypass Firestore rules)
// ---------------------------------------------------------------------------

app.get("/api/admin/revenue-stats", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const db = getFirestore();
    const callerSnap = await db.collection("users").doc(req.user!.uid).get();
    if (!isAdminRole(callerSnap.data()?.role || "free", req.user!.email)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const paymentsSnap = await db.collection("processed_payments").orderBy("processedAt", "desc").get();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let allTimePaise = 0;
    let thisMonthPaise = 0;
    let thisMonthCount = 0;
    const byPlan: Record<string, { count: number; revenuePaise: number }> = {
      starter: { count: 0, revenuePaise: 0 },
      pro: { count: 0, revenuePaise: 0 },
      admin_test: { count: 0, revenuePaise: 0 },
      admin_grant: { count: 0, revenuePaise: 0 },
    };
    const payingUserUids = new Set<string>();
    const recentPayments: any[] = [];

    for (const d of paymentsSnap.docs) {
      const p = d.data();
      const paymentId: string = p.paymentId || "";
      const credits: number = p.credits || 0;
      const uid: string = p.uid || "";
      const processedAt: admin.firestore.Timestamp = p.processedAt;

      const isAdminGrant = paymentId.startsWith("admin_grant_");

      if (recentPayments.length < 25) {
        recentPayments.push({
          uid, credits, paymentId,
          processedAt: processedAt?.toDate?.() || null,
          isAdminGrant,
        });
      }

      if (isAdminGrant) {
        byPlan.admin_grant.count++;
        continue;
      }

      const plan = PLANS.find(pl => pl.credits === credits);
      if (!plan) continue;

      const planKey = plan.id === "admin_test" ? "admin_test" : plan.id;
      byPlan[planKey] = byPlan[planKey] || { count: 0, revenuePaise: 0 };
      byPlan[planKey].count++;
      byPlan[planKey].revenuePaise += plan.amountPaise;
      allTimePaise += plan.amountPaise;
      payingUserUids.add(uid);

      if (processedAt?.toDate && processedAt.toDate() >= monthStart) {
        thisMonthPaise += plan.amountPaise;
        thisMonthCount++;
      }
    }

    const payingUsersCount = payingUserUids.size;
    return res.json({
      allTime: {
        totalRevenuePaise: allTimePaise,
        payingUsersCount,
        avgRevenuePaise: payingUsersCount > 0 ? Math.round(allTimePaise / payingUsersCount) : 0,
        byPlan,
      },
      thisMonth: { totalRevenuePaise: thisMonthPaise, count: thisMonthCount },
      recentPayments,
    });
  } catch (err: any) {
    console.error("[Admin] revenue-stats failed:", err);
    return res.status(500).json({ error: "Failed to fetch revenue stats" });
  }
});

app.get("/api/admin/usage-stats", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const db = getFirestore();
    const callerSnap = await db.collection("users").doc(req.user!.uid).get();
    if (!isAdminRole(callerSnap.data()?.role || "free", req.user!.email)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const days = Math.min(90, Math.max(7, parseInt(String(req.query.days || "30"))));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const eventsSnap = await db.collection("usage_events")
      .where("timestamp", ">=", Timestamp.fromDate(since))
      .orderBy("timestamp", "desc")
      .get();

    // Initialise daily buckets — keys match client's day.totals.* access pattern
    const dailyMap: Record<string, Record<string, number>> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dailyMap[d.toISOString().slice(0, 10)] = { analysis: 0, reanalysis: 0, document: 0, chat: 0, extraction: 0, failed: 0 };
    }

    const totals: Record<string, number> = { analysis: 0, reanalysis: 0, document: 0, chat: 0, extraction: 0 };
    const consumerMap: Record<string, number> = {};
    const failedEvents: any[] = [];
    const paymentErrors: any[] = [];
    let lowConfidenceCount = 0;

    for (const doc of eventsSnap.docs) {
      const ev = doc.data();
      const ts: admin.firestore.Timestamp = ev.timestamp;
      const date = ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : null;
      const type: string = ev.type;
      const success: boolean = ev.success;
      const uid: string = ev.uid || "";

      if (type === "payment_error") {
        paymentErrors.push({ amountPaise: ev.amountPaise, email: ev.email, failureReason: ev.failureReason, timestamp: ts?.toDate?.() || null });
        continue;
      }

      if (!success) failedEvents.push({ uid, type, failureReason: ev.failureReason, timestamp: ts?.toDate?.() || null });
      if (ev.lowConfidence) lowConfidenceCount++;

      if (date && dailyMap[date]) {
        if (!success) { dailyMap[date].failed++; continue; }
        if (type === "analysis")   { dailyMap[date].analysis++;   totals.analysis++;   }
        if (type === "reanalysis") { dailyMap[date].reanalysis++; totals.reanalysis++; }
        if (type === "document")   { dailyMap[date].document++;   totals.document++;   }
        if (type === "chat")       { dailyMap[date].chat++;       totals.chat++;       }
        if (type === "extraction") { dailyMap[date].extraction++; totals.extraction++; }
      }

      if (uid && success) consumerMap[uid] = (consumerMap[uid] || 0) + 1;
    }

    // Wrap counts in totals: {} so client can do day.totals.analysis
    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, totals: counts }));

    const topUids = Object.entries(consumerMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15);

    const topConsumers = await Promise.all(
      topUids.map(async ([uid, count]) => {
        try {
          const snap = await db.collection("users").doc(uid).get();
          return { uid, count, email: snap.data()?.email || uid };
        } catch { return { uid, count, email: uid }; }
      })
    );

    return res.json({
      daily, totals, topConsumers,
      health: {
        failedEvents: failedEvents.slice(0, 50),
        paymentErrors: paymentErrors.slice(0, 20),
        failedCount: failedEvents.length,
        lowConfidenceCount,
      },
    });
  } catch (err: any) {
    console.error("[Admin] usage-stats failed:", err);
    return res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

app.get("/api/admin/user-payments", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const db = getFirestore();
    const callerSnap = await db.collection("users").doc(req.user!.uid).get();
    if (!isAdminRole(callerSnap.data()?.role || "free", req.user!.email)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const targetUid = String(req.query.uid || "");
    if (!targetUid) return res.status(400).json({ error: "uid is required" });

    const paymentsSnap = await db.collection("processed_payments").where("uid", "==", targetUid).get();
    const payments = paymentsSnap.docs
      .map(d => {
        const p = d.data();
        return {
          paymentId: p.paymentId,
          credits: p.credits,
          processedAt: p.processedAt?.toDate?.() || null,
          isAdminGrant: (p.paymentId || "").startsWith("admin_grant_"),
        };
      })
      .sort((a, b) => (b.processedAt?.getTime() || 0) - (a.processedAt?.getTime() || 0));

    return res.json({ payments });
  } catch (err: any) {
    console.error("[Admin] user-payments failed:", err);
    return res.status(500).json({ error: "Failed to fetch user payments" });
  }
});

app.post("/api/parse-profile", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

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
        responseSchema: {
          type: "object",
          properties: {
            keywords: { type: "array", items: { type: "string" } },
            states: { type: "array", items: { type: "string" } },
            min_capacity_inr: { type: "number", nullable: true },
          },
          required: ["keywords", "states", "min_capacity_inr"],
        },
      },
    });

    const parsedData = robustJsonParse(response.text);
    res.json({ profile: parsedData });
  } catch (err: any) {
    console.error("Parse Profile Error:", err);
    res.status(400).json({ error: err.message });
  }
});

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
    res.status(400).json({ error: "Failed to enhance text" });
  }
});

// ---------------------------------------------------------------------------
// Extract profile data from uploaded certificate (GST cert, PAN, Udyam, CoI…)
// ---------------------------------------------------------------------------
app.post(
  "/api/extract-profile-data",
  verifyFirebaseToken,
  requireCredits,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { fileBase64, fileMimeType } = req.body;
      if (!fileBase64 || !fileMimeType) {
        return res.status(400).json({ error: "fileBase64 and fileMimeType are required" });
      }

      const aiClient = getAI();

      const systemInstruction =
        `You are a certificate data extraction assistant for Indian business documents. ` +
        `The user has uploaded an official certificate or registration document. ` +
        `Extract ONLY data that is clearly and unambiguously visible in the document — ` +
        `do NOT guess, infer, or hallucinate any value. ` +
        `Omit any field you cannot read with full confidence. ` +
        `Return a JSON object containing only the fields you found; leave out fields that are absent or unclear.`;

      const extractionPrompt =
        `Extract structured data from this document. ` +
        `Return ONLY a JSON object — no explanation, no commentary. ` +
        `Include only the keys listed below for which you can clearly read a value:\n\n` +
        `companyName, gstNumber, panNumber, tanNumber, ` +
        `udyamNumber, msmeStatus (one of: Micro / Small / Medium), ` +
        `cinLlpin, dateOfIncorporation (YYYY-MM-DD format), ` +
        `registeredOfficeAddress, worksAddress, ` +
        `phone, mobile, fax, email, website, ` +
        `esicNumber, epfNumber, professionalTaxNumber, ` +
        `bankName, bankAccountNumber, bankIfsc, ` +
        `authorizedSignatoryName, authorizedSignatoryDesignation, authorizedSignatoryDin\n\n` +
        `Return {} if nothing is readable.`;

      const response = await generateContentWithRetry(aiClient, {
        model: "gemini-3.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: fileMimeType as string, data: fileBase64 as string } },
              { text: extractionPrompt },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              companyName:                  { type: "string", nullable: true },
              gstNumber:                    { type: "string", nullable: true },
              panNumber:                    { type: "string", nullable: true },
              tanNumber:                    { type: "string", nullable: true },
              udyamNumber:                  { type: "string", nullable: true },
              msmeStatus:                   { type: "string", nullable: true },
              cinLlpin:                     { type: "string", nullable: true },
              dateOfIncorporation:          { type: "string", nullable: true },
              registeredOfficeAddress:      { type: "string", nullable: true },
              worksAddress:                 { type: "string", nullable: true },
              phone:                        { type: "string", nullable: true },
              mobile:                       { type: "string", nullable: true },
              fax:                          { type: "string", nullable: true },
              email:                        { type: "string", nullable: true },
              website:                      { type: "string", nullable: true },
              esicNumber:                   { type: "string", nullable: true },
              epfNumber:                    { type: "string", nullable: true },
              professionalTaxNumber:        { type: "string", nullable: true },
              bankName:                     { type: "string", nullable: true },
              bankAccountNumber:            { type: "string", nullable: true },
              bankIfsc:                     { type: "string", nullable: true },
              authorizedSignatoryName:      { type: "string", nullable: true },
              authorizedSignatoryDesignation: { type: "string", nullable: true },
              authorizedSignatoryDin:       { type: "string", nullable: true },
            },
          },
        },
      });

      const raw = robustJsonParse(response.text) || {};
      // Strip null / empty values so the client only sees fields that were found
      const extracted: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === "string" && v.trim() !== "") {
          extracted[k] = v.trim();
        }
      }
      logUsageEvent({ uid: req.user!.uid, type: 'extraction', success: true });
      res.json({ extracted });
    } catch (err: any) {
      console.error("Extract Profile Data Error:", err);
      logUsageEvent({ uid: req.user!.uid, type: 'extraction', success: false, failureReason: err.message.slice(0, 300) });
      // Return empty extraction rather than an error — the UI handles the "nothing found" case
      res.json({ extracted: {} });
    }
  }
);

app.post("/api/analyze-tender", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenderDocument, tenderType = "text", tenderContent, userProfile, language,
            projectId: existingProjectId, fileNames, projectName: userProjectName } = req.body;
    const actualContent = tenderContent || tenderDocument;
    const isReanalysis = !!existingProjectId;

    if (!actualContent || !userProfile) {
      return res.status(400).json({ error: "tender content and userProfile are required" });
    }

    const uid = req.user!.uid;
    const db = getFirestore();
    const aiClient = getAI();
    let docContents: any[];
    let remarks: any = null;
    // Holds the Firestore data of the existing project during re-analysis; used later
    // to build the cumulative remarksHistory without a second read.
    let existingProjectData: Record<string, any> = {};

    // ── Credit / run-count gate ──────────────────────────────────────────────
    if (isReanalysis) {
      // Re-analysis: verify project ownership + enforce 5-run cap
      const projectSnap = await db.collection("saved_tenders").doc(existingProjectId).get();
      existingProjectData = (projectSnap.data() as Record<string, any>) ?? {};
      if (!projectSnap.exists || existingProjectData.userId !== uid) {
        return res.status(403).json({ error: "Project not found or access denied" });
      }
      const runsDone: number = existingProjectData.analysisRuns ?? 0;
      const userSnapRA = await db.collection("users").doc(uid).get();
      const userRoleRA: string = userSnapRA.data()?.role || "free";
      const isAdminRA = isAdminRole(userRoleRA, req.user!.email);
      if (!isAdminRA && runsDone >= 5) {
        return res.status(429).json({ error: "This project has reached the 5 re-analysis limit. Start a new project to analyze updated documents." });
      }
    } else {
      // New analysis: check credits, including lazy legacy migration
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.data() || {};
      let creditsTotal: number = userData.creditsTotal ?? 0;
      let creditsUsed: number = userData.creditsUsed ?? 0;
      let creditsExpiry: Date | null = userData.creditsExpiry ? userData.creditsExpiry.toDate() : null;
      const userRole: string = userData.role || "free";
      const isAdmin = isAdminRole(userRole, req.user!.email);

      if (!isAdmin) {
        if (creditsTotal === 0 && userData.subscriptionExpiry && userData.subscriptionExpiry.toDate() > new Date()) {
          // Legacy migration
          const expiry = new Date();
          expiry.setMonth(expiry.getMonth() + CREDIT_VALIDITY_MONTHS);
          await db.collection("users").doc(uid).update({ creditsTotal: 10, creditsUsed: 0, creditsExpiry: Timestamp.fromDate(expiry) });
          console.log(`[Migration] Granted 10 legacy credits to uid=${uid}`);
          creditsTotal = 10; creditsUsed = 0; creditsExpiry = expiry;
        }
        const now = new Date();
        if (creditsUsed >= creditsTotal || !creditsExpiry || creditsExpiry <= now) {
          return res.status(403).json({
            error: "You've used all your analyses. Add more to continue — your existing projects and documents remain fully accessible.",
          });
        }
      }
    }

    const extraContextStr = req.body.extraContext
      ? `\n\n--- EXTRA CONTEXT / RE-ANALYSIS UPDATE ---\n${req.body.extraContext}\n`
      : "";

    // ── File-count routing gate (checked BEFORE any fetching/docContents
    // building) ─────────────────────────────────────────────────────────────
    // Independent of and in addition to the token-based Tier-2 trigger
    // below — a submission can route to Tier-2 for having too many files
    // OR too many tokens; neither check can be bypassed by the other. Only
    // storage_urls carries a knowable file count up front (URLs are cheap
    // to count; other tenderTypes are single documents). No file is ever
    // skipped for count reasons: over the safe count routes to Tier-2 for
    // new analyses, or is rejected with a clear, actionable error for
    // re-analysis (Tier-2 doesn't support re-analysis yet — a separate,
    // deliberately out-of-scope feature, not silently dropped content).
    if (tenderType === "storage_urls" && Array.isArray(actualContent) && actualContent.length > TIER1_SAFE_FILE_COUNT) {
      if (isReanalysis) {
        return res.status(413).json({
          error: "Too many files to add in one re-analysis — please combine into fewer PDFs or contact support.",
        });
      }
      const result = await createTier2Job(db, {
        uid,
        tenderType,
        actualContent,
        fileNames: Array.isArray(fileNames) && fileNames.length > 0 ? (fileNames as string[]) : null,
        userProfile,
        language: language ?? null,
        extraContext: req.body.extraContext ?? null,
        userProjectName,
      });
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      return res.json({ tier: 2, jobId: result.jobId, chunkCount: result.chunkCount });
    }

    if (
      tenderType === "pdfs" ||
      tenderType === "zip" ||
      (tenderType === "pdf" && Array.isArray(actualContent))
    ) {
      docContents = [
        `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENTS (Attached as PDFs) ---\n`,
      ];
      if (Array.isArray(actualContent)) {
        for (const item of actualContent) {
          const match = item.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            docContents.push({ inlineData: { mimeType: match[1], data: match[2] } });
          } else {
            docContents.push({
              inlineData: {
                mimeType: "application/pdf",
                data: item.replace(/^data:application\/pdf;base64,/, ""),
              },
            });
          }
        }
      }
    } else if (tenderType === "pdf") {
      docContents = [
        `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT (Attached as PDF) ---\n`,
        {
          inlineData: {
            mimeType: "application/pdf",
            data: actualContent.replace(/^data:application\/pdf;base64,/, ""),
          },
        },
      ];
    } else if (tenderType === "storage_urls") {
      // Phase 3: every URL goes through safeFetch before touching the network.
      // No file-count skip here — a submission with more than
      // TIER1_SAFE_FILE_COUNT files never reaches this branch at all; it's
      // routed to Tier-2 (or, for re-analysis, rejected with a clear error)
      // by the file-count gate earlier in this handler. Every file that
      // DOES reach this loop is analyzed — none dropped for count reasons.
      const allUrls: string[] = Array.isArray(actualContent) ? actualContent : [];
      const totalFilesProvided = allUrls.length;
      const filesSkipped: { index: number; fileName: string; reason: string }[] = [];
      let filesAnalyzed = 0;

      const notes: string[] = [];
      docContents = [
        `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENTS (Fetched from Storage) ---\n`,
      ];

      for (let i = 0; i < allUrls.length; i++) {
        const label = resolveFileLabel(fileNames, i);
        const url = allUrls[i];
        try {
          const fetched = await safeFetch(url);
          if (!fetched.ok) {
            filesSkipped.push({ index: i, fileName: label, reason: `Fetch failed (HTTP ${fetched.status})` });
            continue;
          }
          const contentType = fetched.headers.get("content-type") || "application/pdf";
          const buffer = await fetched.arrayBuffer();
          if (contentType.includes("text/plain")) {
            const text = Buffer.from(buffer).toString("utf-8");
            docContents.push(`\n--- DOCUMENT CONTENT ---\n${text}\n`);
            notes.push(`${label}: text-layer path (${text.length} chars)`);
          } else {
            const base64 = Buffer.from(buffer).toString("base64");
            docContents.push({ inlineData: { mimeType: contentType, data: base64 } });
            notes.push(`${label}: image/pdf path (${contentType})`);
            console.log(`[analyze-tender] ${label} using image/PDF path — content-type: ${contentType}, size: ${buffer.byteLength} bytes`);
          }
          filesAnalyzed++;
        } catch (err) {
          console.error("Failed to fetch storage URL", url, err);
          filesSkipped.push({ index: i, fileName: label, reason: "Network error fetching file" });
        }
      }

      remarks = { totalFilesProvided, filesAnalyzed, filesSkipped, notes };
    } else if (tenderType === "url") {
      // Phase 3: safeFetch handles SSRF check + fetch atomically
      try {
        const fetchedRes = await safeFetch(actualContent, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!fetchedRes.ok) throw new Error(`Failed to fetch URL: ${fetchedRes.statusText}`);
        const htmlContent = await fetchedRes.text();
        const cleanText = htmlContent
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]*>?/gm, " ");
        docContents = [
          `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT (Fetched from URL: ${actualContent}) ---\n${cleanText}`,
        ];
      } catch (fetchErr: any) {
        if (fetchErr.message?.startsWith("SSRF guard")) {
          return res
            .status(400)
            .json({ error: "Access denied: The specified URL is invalid or points to an unsafe/restricted destination." });
        }
        return res
          .status(400)
          .json({ error: "Failed to directly fetch tender URL. Government portals (like eProcure/GeM) often block automated access. Please download the PDF and upload it instead." });
      }
    } else {
      docContents = [
        `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENT ---\n${actualContent}`,
      ];
    }

    // ── Stats pass: scan assembled docContents (free — no Gemini call) ───────
    let totalTextChars = 0;
    let totalPdfBytes = 0;
    let hasPdfItems = false;
    for (const part of docContents) {
      if (typeof part === "string") {
        totalTextChars += part.length;
      } else if (part?.inlineData?.data) {
        // base64 length × 3/4 ≈ binary bytes
        const bytes = Math.floor((part.inlineData.data as string).length * 3 / 4);
        if ((part.inlineData.mimeType as string)?.includes("text/plain")) {
          totalTextChars += bytes;
        } else {
          totalPdfBytes += bytes;
          hasPdfItems = true;
        }
      }
    }

    // ── Pre-checks (reject before any Gemini call) ───────────────────────────
    // (a) Rate limit: max 5 failed attempts per user per rolling hour
    const rateLimit = await checkRateLimit(uid);
    if (rateLimit.blocked) {
      return res.status(429).json({
        error: `Too many failed analysis attempts. Please wait ${rateLimit.minutesUntilReset} minute${rateLimit.minutesUntilReset !== 1 ? "s" : ""} before trying again.`,
      });
    }

    // (b) Unreadable: no text AND no PDF images → nothing to analyse
    if (totalTextChars < 50 && !hasPdfItems) {
      return res.status(422).json({
        error: "No readable content found in the uploaded document. If this is a scanned PDF, please upload the original PDF file directly.",
      });
    }

    // (c) Token estimate for text content (chars ÷ 4, 10 % headroom below 1 M limit)
    const estimatedTokens = Math.round(totalTextChars / 4);
    if (estimatedTokens > TIER2_TOKEN_THRESHOLD) {
      // Tier 2 (large-tender async job) — Step A scope: only for NEW analyses
      // on the storage_urls/url/text paths, whose request content is small
      // enough (URL strings, or text already under the token cap above) to
      // store directly in the analysis_jobs doc. Re-analysis and the
      // inline-base64 pdf/pdfs/zip paths keep today's exact reject below —
      // widening Tier 2 to those is a separate, later step, not this one.
      const jobifiableType = tenderType === "storage_urls" || tenderType === "url" || tenderType === "text";
      if (!isReanalysis && jobifiableType) {
        // This is the SECOND, independent Tier-2 trigger (token volume) —
        // the file-count trigger above already handled storage_urls
        // submissions over TIER1_SAFE_FILE_COUNT before we ever got here,
        // so by this point any storage_urls request has <= that many
        // files but may still have too many TOKENS (e.g. a few very large
        // files, or url/text content with no file concept at all). Neither
        // trigger can bypass the other. Uses the SAME job-creation helper
        // as the count trigger so the two paths can never drift.
        const result = await createTier2Job(db, {
          uid,
          tenderType,
          actualContent,
          fileNames: Array.isArray(fileNames) && fileNames.length > 0 ? (fileNames as string[]) : null,
          userProfile,
          language: language ?? null,
          extraContext: req.body.extraContext ?? null,
          userProjectName,
        });
        if (result.ok === false) return res.status(result.status).json({ error: result.error });
        return res.json({ tier: 2, jobId: result.jobId, chunkCount: result.chunkCount });
      }
      return res.status(413).json({
        error: `Document is too large for a single analysis (~${Math.round(estimatedTokens / 1000)}k estimated tokens). Please split it into key documents (main conditions, eligibility, BOQ) and analyse each separately.`,
      });
    }

    // (d) PDF size safety net for image-path files (no pdfjs server-side)
    if (totalPdfBytes > 100 * 1024 * 1024) {
      return res.status(413).json({
        error: "PDF files total more than 100 MB. Please compress or split them before uploading.",
      });
    }

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-3.5-flash",
      contents: docContents,
      config: {
        systemInstruction: buildAnalysisSystemInstruction(language),
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      },
    });

    const parsedData = robustJsonParse(response.text);

    if (!remarks) remarks = { notes: [] };
    const { isLow, missing } = detectLowConfidence(parsedData);
    if (isLow) {
      remarks.notes.push(
        `LOW CONFIDENCE — The following critical fields could not be determined: ${missing.join(", ")}. Please verify these details in the source tender document before bidding.`
      );
    }

    if (isReanalysis) {
      // Build cumulative remarks history so the Analysis Notes tab can show per-run breakdowns.
      // If the project has no history yet, seed run 1 from the stored remarks.
      const existingHistory: any[] = Array.isArray(existingProjectData.remarksHistory)
        ? existingProjectData.remarksHistory
        : [];
      const baseHistory: any[] =
        existingHistory.length === 0 && existingProjectData.remarks
          ? [{
              run: 1,
              at: existingProjectData.savedAt ?? null,
              fileNames: existingProjectData.payloadRefNames ?? [],
              ...existingProjectData.remarks,
            }]
          : existingHistory;

      // For Path 1 (re-analyze with existing files), fileNames is not sent — use original names.
      const runFileNames: string[] =
        Array.isArray(fileNames) && fileNames.length > 0
          ? fileNames as string[]
          : (existingProjectData.payloadRefNames ?? []);

      const runNumber = (existingProjectData.analysisRuns ?? 1) + 1;
      const newRun = {
        run: runNumber,
        at: Timestamp.now(),
        fileNames: runFileNames,
        ...remarks,
      };

      try {
        await db.collection("saved_tenders").doc(existingProjectId).update({
          details: parsedData,
          remarks,                                        // last-run snapshot, kept for backward compat
          remarksHistory: [...baseHistory, newRun],       // cumulative across all runs
          // Accumulate file names from re-analysis uploads (add-document path)
          ...(Array.isArray(fileNames) && fileNames.length > 0
            ? { payloadRefNames: FieldValue.arrayUnion(...(fileNames as string[])) }
            : {}),
          lowConfidence: isLow,
          lastReanalyzedAt: Timestamp.now(),
          analysisRuns: FieldValue.increment(1),
        });
      } catch (saveErr) {
        console.error("[analyze-tender] Failed to save re-analysis:", saveErr);
      }
      logUsageEvent({ uid, type: 'reanalysis', projectId: existingProjectId, success: true, lowConfidence: isLow });
      return res.json({ analysis: parsedData, remarks, lowConfidence: isLow, projectId: existingProjectId });
    }

    // New analysis: atomically deduct 1 credit and auto-save the project
    const userRef = db.collection("users").doc(uid);
    const projectRef = db.collection("saved_tenders").doc();
    const newProjectId = projectRef.id;

    // Determine payloadRef for the saved project
    const payloadRef = tenderType === "storage_urls" || tenderType === "url"
      ? actualContent
      : tenderType === "text"
        ? String(actualContent).slice(0, 2000)
        : "Document";

    try {
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const creditsTotal: number = userData.creditsTotal ?? 0;
        const creditsUsed: number = userData.creditsUsed ?? 0;
        const creditsExpiry: Date | null = userData.creditsExpiry ? userData.creditsExpiry.toDate() : null;
        const userRole: string = userData.role || "free";
        const isAdmin = isAdminRole(userRole, req.user!.email);

        if (!isAdmin) {
          const now = new Date();
          if (creditsUsed >= creditsTotal || !creditsExpiry || creditsExpiry <= now) {
            throw new Error("CREDITS_EXHAUSTED");
          }
          tx.set(userRef, { creditsUsed: FieldValue.increment(1) }, { merge: true });
        }

        tx.set(projectRef, {
          userId: uid,
          projectName: (typeof userProjectName === "string" && userProjectName.trim()) ? userProjectName.trim() : (parsedData?.tender_simplified?.tender_name || "Untitled Tender"),
          tenderId: Date.now().toString(),
          details: parsedData,
          payloadRef,
          ...(Array.isArray(fileNames) && fileNames.length > 0 ? { payloadRefNames: fileNames } : {}),
          remarks,
          lowConfidence: isLow,
          savedAt: Timestamp.now(),
          analysisRuns: 1,
        });
      });
    } catch (txErr: any) {
      if (txErr.message === "CREDITS_EXHAUSTED") {
        return res.status(403).json({
          error: "You've used all your analyses. Add more to continue — your existing projects and documents remain fully accessible.",
        });
      }
      throw txErr; // re-throw to outer catch → recordFailedAttempt
    }

    logUsageEvent({ uid, type: 'analysis', projectId: newProjectId, success: true, lowConfidence: isLow });
    return res.json({ analysis: parsedData, remarks, lowConfidence: isLow, projectId: newProjectId });
  } catch (err: any) {
    console.error("Analyze Tender Error:", err);
    const uid = (req as AuthenticatedRequest).user?.uid;
    if (uid) {
      await recordFailedAttempt(uid);
      logUsageEvent({ uid, type: !!(req as any).body?.projectId ? 'reanalysis' : 'analysis', success: false, failureReason: err.message.slice(0, 300) });
    }
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Tier-2 (large tender) async job worker — Step B: processes ONE chunk per
// call (sequential-with-resume, client-driven — see the approved
// architecture for why: no fire-and-forget, no Vercel Cron, no new queue
// infra). The SERVER decides which chunk is next each call and writes that
// chunk's completion status itself, before responding — so a client that
// disconnects mid-chunk never loses a completed chunk and never causes it
// to be reprocessed; resume just means calling this endpoint again, and the
// claim logic below picks up from exactly the right place. No merge yet
// (Step C) — once every chunk reaches a terminal state (done or failed),
// the job moves to 'chunks_done' and waits there.
// ---------------------------------------------------------------------------
// If a job is 'running' and its startedAt is older than this, treat it as
// abandoned (crashed tab, network drop, etc.) — mirrors BOQViewer's
// STALE_MS convention. Whole-job scope; CHUNK_STALE_MS (defined alongside
// chunk planning above) is the tighter, actually-used threshold for
// per-chunk resume in this step.
const JOB_STALE_MS = 5 * 60_000;

// Terminal escape hatch (Step C, approved): after this many failures on a
// SINGLE critical chunk, the client stops offering plain auto-retry for
// that chunk and instead surfaces Abandon (always available) and, only if
// none of the currently-blocked chunks are financial_critical,
// "proceed without this section". Counts every failure of that chunk
// (including its first, non-user-initiated attempt), not just explicit
// retry_chunk calls — simpler to reason about and already generous (3
// total attempts) relative to the user's "e.g. 3 user-initiated resume
// attempts" framing.
const USER_CHUNK_RETRY_LIMIT = 3;

/** Atomically finds and claims the next processable chunk for a job:
 *  'pending', or 'running' but stale (abandoned by a dead worker call).
 *  Never claims a chunk that's genuinely live elsewhere, or already
 *  done/failed. The candidate scan runs a plain ordered read (no `in`
 *  filter combined with orderBy, which would require provisioning a new
 *  Firestore composite index — avoided deliberately to keep this additive
 *  and infra-risk-free); each candidate is then re-verified and claimed
 *  inside its own transaction — the standard safe "find work, then
 *  atomically claim it" pattern. Returns "all_terminal" once every chunk
 *  is done/failed, or null when chunks remain but none are claimable right
 *  now (something else is genuinely mid-chunk). */
async function claimNextChunk(
  db: FirebaseFirestore.Firestore,
  jobId: string,
): Promise<{ chunkRef: FirebaseFirestore.DocumentReference; data: any } | "all_terminal" | null> {
  const chunksRef = db.collection("analysis_jobs").doc(jobId).collection("chunks");
  const allSnap = await chunksRef.orderBy("index").get();
  let sawNonTerminal = false;
  for (const candidateDoc of allSnap.docs) {
    const d = candidateDoc.data();
    if (d.status === "done" || d.status === "failed") continue;
    sawNonTerminal = true;
    const chunkRef = candidateDoc.ref;
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(chunkRef);
      if (!snap.exists) return null;
      const data = snap.data()!;
      if (data.status === "done" || data.status === "failed") return null;
      if (data.status === "running") {
        const startedAtMs: number = data.startedAt?.toMillis?.() ?? 0;
        if (Date.now() - startedAtMs < CHUNK_STALE_MS) return null; // still live elsewhere
      }
      tx.update(chunkRef, { status: "running", startedAt: Timestamp.now(), updatedAt: Timestamp.now() });
      return { data };
    });
    if (claim) return { chunkRef, data: claim.data };
  }
  return sawNonTerminal ? null : "all_terminal";
}

/** Builds one chunk's docContents from its precomputed parts. Text parts
 *  are used exactly as extracted at job-creation time (never re-extracted —
 *  "reuse extracted text" per spec). PDF parts are re-fetched from their
 *  storage URL (raw PDF bytes are never persisted in the chunk doc, to stay
 *  well clear of Firestore's per-doc size limit) — a single, non-redundant
 *  re-fetch per whole-file PDF chunk, not a repeat of any prior analysis. */
async function buildChunkDocContents(
  chunk: any,
  userProfile: string,
  extraContextStr: string,
  chunkIndex: number,
  chunkCount: number,
): Promise<any[]> {
  const scopeNote =
    `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n` +
    `--- IMPORTANT: PARTIAL DOCUMENT EXCERPT ---\n` +
    `You are analyzing chunk ${chunkIndex + 1} of ${chunkCount} from a large tender document, covering: ${chunk.sourceLabel}. ` +
    `This is NOT the complete document — other chunks cover the rest. For ANY field in the required JSON output that you cannot ` +
    `determine with confidence from THIS EXCERPT ALONE, return null (or an empty array for list fields) — do NOT guess, do NOT ` +
    `fabricate a plausible-sounding value, and do NOT copy an example value from the schema. A later merge step combines every ` +
    `chunk's results — a null here is correct and expected when this excerpt doesn't cover that topic.\n\n` +
    `--- TENDER DOCUMENT EXCERPT (${chunk.sourceLabel}) ---\n`;

  const docContents: any[] = [scopeNote];
  for (const part of chunk.parts as any[]) {
    if (part.kind === "text") {
      docContents.push(`\n--- ${part.sourceLabel} ---\n${part.text}\n`);
    } else {
      const fetched = await safeFetch(part.storageUrl);
      if (!fetched.ok) throw new Error(`Failed to re-fetch ${part.sourceLabel} (HTTP ${fetched.status})`);
      const buffer = await fetched.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      docContents.push({ inlineData: { mimeType: part.mimeType || "application/pdf", data: base64 } });
    }
  }
  return docContents;
}

/** Runs the deterministic merge + schema-validation gate + single credit
 *  deduction, using ONLY the given chunk docs' `result`s (status === 'done'
 *  chunks) — any 'failed' chunk among `chunkDocs` is by construction either
 *  non_critical (auto-skippable) or an eligibility_critical chunk the user
 *  has explicitly chosen to proceed without (server-verified by the caller
 *  before this runs); a financial_critical failure must NEVER reach this
 *  function — callers are responsible for that guarantee. Mirrors Tier-1's
 *  own credit-transaction + saved_tenders write byte-for-byte (same field
 *  shape, same CREDITS_EXHAUSTED handling, same admin bypass) so Tier-2
 *  projects are indistinguishable from Tier-1 ones to every downstream
 *  consumer. Credit is deducted ONLY inside this transaction, i.e. only on
 *  a validated, successfully-written result — never on merge failure,
 *  validation failure, all-critical-blocked, or abandon. */
async function finalizeJob(
  db: FirebaseFirestore.Firestore,
  jobRef: FirebaseFirestore.DocumentReference,
  job: any,
  chunkDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  req: AuthenticatedRequest,
): Promise<any> {
  const doneChunks = chunkDocs.filter(d => d.data().status === "done");
  const skippedChunks = chunkDocs.filter(d => d.data().status === "failed");
  const chunkResults = doneChunks.map(d => d.data().result);

  // Computed once up front so every terminal write below — success or
  // failure — reflects the TRUE final counts at finalize time, not
  // whatever the second-to-last per-chunk update happened to persist.
  const finalChunksDone = doneChunks.length;
  const finalChunksFailed = skippedChunks.length;

  let parsedData: any;
  try {
    parsedData = mergeChunkResults(chunkResults);
  } catch (mergeErr: any) {
    const reason = `Merge failed: ${String(mergeErr?.message || mergeErr).slice(0, 300)}`;
    await jobRef.update({ status: "failed", reason, chunksDone: finalChunksDone, chunksFailed: finalChunksFailed, updatedAt: Timestamp.now() });
    return { jobStatus: "failed", reason };
  }

  const schemaErrors = validateAgainstAnalysisSchema(parsedData);
  if (schemaErrors.length > 0) {
    const reason = `Merged result failed schema validation: ${schemaErrors.slice(0, 5).join("; ")}`;
    await jobRef.update({ status: "failed", reason, chunksDone: finalChunksDone, chunksFailed: finalChunksFailed, updatedAt: Timestamp.now() });
    return { jobStatus: "failed", reason };
  }

  // Content-sanity backstop: validateAgainstAnalysisSchema above checks
  // SHAPE only — a fully-empty merge (every chunk empty/placeholder-only)
  // passes it cleanly, since every field still has a schema-correct
  // default. This is what actually protects the credit deduction below
  // from firing on a useless result.
  if (hasNoMeaningfulContent(parsedData)) {
    const reason = "Merged result contains no meaningful analysis content (empty tender name, scope, score, and key data) — likely a chunk-processing failure. No credit was charged.";
    await jobRef.update({ status: "failed", reason, chunksDone: finalChunksDone, chunksFailed: finalChunksFailed, updatedAt: Timestamp.now() });
    return { jobStatus: "failed", reason };
  }

  const remarks: any = {
    notes: [],
    ...(typeof job.totalFilesProvided === "number" ? { totalFilesProvided: job.totalFilesProvided } : {}),
    ...(typeof job.filesAnalyzed === "number" ? { filesAnalyzed: job.filesAnalyzed } : {}),
    ...(Array.isArray(job.filesSkipped) ? { filesSkipped: job.filesSkipped } : {}),
  };
  const { isLow, missing } = detectLowConfidence(parsedData);
  if (isLow) {
    remarks.notes.push(
      `LOW CONFIDENCE — The following critical fields could not be determined: ${missing.join(", ")}. Please verify these details in the source tender document before bidding.`
    );
  }
  for (const d of skippedChunks) {
    const c = d.data();
    const label = c.criticality === "non_critical" ? "non-critical" : "critical, user-approved skip";
    remarks.notes.push(
      `SECTION SKIPPED — "${c.sourceLabel}" (${label}) could not be analyzed after repeated attempts and was excluded from this result. Reason: ${c.reason || "processing failed"}.`
    );
  }

  const uid: string = job.uid;
  const { tenderType, tenderContent, fileNames, projectName } = job.request;
  const payloadRef =
    tenderType === "storage_urls" || tenderType === "url"
      ? tenderContent
      : tenderType === "text"
        ? String(tenderContent).slice(0, 2000)
        : "Document";

  const userRef = db.collection("users").doc(uid);
  const projectRef = db.collection("saved_tenders").doc();
  const newProjectId = projectRef.id;

  try {
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data() || {};
      const creditsTotal: number = userData.creditsTotal ?? 0;
      const creditsUsed: number = userData.creditsUsed ?? 0;
      const creditsExpiry: Date | null = userData.creditsExpiry ? userData.creditsExpiry.toDate() : null;
      const userRole: string = userData.role || "free";
      const isAdmin = isAdminRole(userRole, req.user!.email);

      if (!isAdmin) {
        const now = new Date();
        if (creditsUsed >= creditsTotal || !creditsExpiry || creditsExpiry <= now) {
          throw new Error("CREDITS_EXHAUSTED");
        }
        tx.set(userRef, { creditsUsed: FieldValue.increment(1) }, { merge: true });
      }

      tx.set(projectRef, {
        userId: uid,
        projectName: (typeof projectName === "string" && projectName.trim()) ? projectName.trim() : (parsedData?.tender_simplified?.tender_name || "Untitled Tender"),
        tenderId: Date.now().toString(),
        details: parsedData,
        payloadRef,
        ...(Array.isArray(fileNames) && fileNames.length > 0 ? { payloadRefNames: fileNames } : {}),
        remarks,
        lowConfidence: isLow,
        savedAt: Timestamp.now(),
        analysisRuns: 1,
      });
    });
  } catch (txErr: any) {
    if (txErr.message === "CREDITS_EXHAUSTED") {
      await jobRef.update({ status: "failed", reason: "CREDITS_EXHAUSTED", chunksDone: finalChunksDone, chunksFailed: finalChunksFailed, updatedAt: Timestamp.now() });
      return { jobStatus: "failed", reason: "CREDITS_EXHAUSTED" };
    }
    console.error("[finalizeJob] Save transaction failed:", txErr);
    const reason = `Save failed: ${String(txErr?.message || txErr).slice(0, 300)}`;
    await jobRef.update({ status: "failed", reason, chunksDone: finalChunksDone, chunksFailed: finalChunksFailed, updatedAt: Timestamp.now() });
    return { jobStatus: "failed", reason };
  }

  // Persists the TRUE final terminal counts (computed once, above) — the
  // per-chunk inline handlers only write chunksDone/chunksFailed on their
  // "not yet all-terminal" branch; the chunk that actually completes the
  // job never gets its own count persisted otherwise, leaving the job doc
  // frozen one chunk behind forever even though finalize itself always
  // operates on the fresh, correct chunkDocs passed in above.
  await jobRef.update({
    status: "done",
    projectId: newProjectId,
    details: parsedData,
    remarks,
    lowConfidence: isLow,
    chunksDone: finalChunksDone,
    chunksFailed: finalChunksFailed,
    updatedAt: Timestamp.now(),
  });

  logUsageEvent({ uid, type: "analysis", projectId: newProjectId, success: true, lowConfidence: isLow });

  return {
    jobStatus: "done", projectId: newProjectId, details: parsedData, remarks, lowConfidence: isLow,
    chunkCount: job.chunkCount, chunksDone: finalChunksDone, chunksFailed: finalChunksFailed,
  };
}

/** Runs once every chunk has reached a terminal state (done/failed).
 *  Non-critical-only failures auto-finalize (matches the approved policy:
 *  "non-critical-only failures produce flagged partial result + deduct").
 *  Any financial_critical or eligibility_critical failure blocks the job
 *  instead — surfacing exactly which chunks are stuck, whether the user
 *  may explicitly proceed without them (never true if ANY blocked chunk is
 *  financial_critical — that tier has no override, only abandon), and
 *  which blocked chunks have hit the terminal-escape-hatch retry limit. */
async function finalizeOrBlockJob(
  db: FirebaseFirestore.Firestore,
  jobRef: FirebaseFirestore.DocumentReference,
  job: any,
  req: AuthenticatedRequest,
): Promise<any> {
  const chunkSnap = await jobRef.collection("chunks").get();
  const chunks = chunkSnap.docs;
  const chunksDone = chunks.filter(d => d.data().status === "done").length;
  const failedDocs = chunks.filter(d => d.data().status === "failed");
  const chunksFailed = failedDocs.length;

  const criticalFailed = failedDocs.filter(d => d.data().criticality !== "non_critical");
  if (criticalFailed.length === 0) {
    return finalizeJob(db, jobRef, job, chunks, req);
  }

  const blockedChunkIndexes = criticalFailed.map(d => d.data().index).sort((a, b) => a - b);
  const canProceedWithoutBlocked = criticalFailed.every(d => d.data().criticality === "eligibility_critical");
  const chunksAtRetryLimit = criticalFailed
    .filter(d => (d.data().retryCount ?? 0) >= USER_CHUNK_RETRY_LIMIT)
    .map(d => d.data().index)
    .sort((a, b) => a - b);

  await jobRef.update({
    status: "blocked",
    chunksDone, chunksFailed,
    blockedChunkIndexes,
    canProceedWithoutBlocked,
    chunksAtRetryLimit,
    updatedAt: Timestamp.now(),
  });

  return {
    jobStatus: "blocked",
    chunksDone, chunksFailed, chunkCount: job.chunkCount,
    blockedChunkIndexes, canProceedWithoutBlocked, chunksAtRetryLimit,
  };
}

app.post("/api/process-analysis-job", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const { jobId, action, chunkIndex } = req.body;
  if (!jobId || typeof jobId !== "string") {
    return res.status(400).json({ error: "jobId is required" });
  }
  if (action !== undefined && action !== "retry_chunk" && action !== "abandon" && action !== "proceed_without") {
    return res.status(400).json({ error: "Invalid action" });
  }
  const db = getFirestore();
  const jobRef = db.collection("analysis_jobs").doc(jobId);

  try {
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) return res.status(404).json({ error: "Job not found" });
    const job = jobSnap.data()!;
    if (job.uid !== uid) return res.status(403).json({ error: "Access denied" });

    // Already terminal — nothing left for this endpoint to do.
    if (job.status === "done" || job.status === "abandoned") {
      return res.json({ jobStatus: job.status, chunksDone: job.chunksDone, chunksFailed: job.chunksFailed, chunkCount: job.chunkCount, projectId: job.projectId ?? null });
    }

    // ── Terminal-escape-hatch actions — only meaningful while blocked ──────
    if (action === "abandon") {
      await jobRef.update({ status: "abandoned", updatedAt: Timestamp.now() });
      return res.json({ jobStatus: "abandoned" });
    }

    if (action === "retry_chunk") {
      if (job.status !== "blocked") return res.status(400).json({ error: "Job is not blocked — nothing to retry" });
      if (typeof chunkIndex !== "number") return res.status(400).json({ error: "chunkIndex is required for retry_chunk" });
      const chunkRef = jobRef.collection("chunks").doc(String(chunkIndex));
      const chunkSnap = await chunkRef.get();
      if (!chunkSnap.exists || chunkSnap.data()!.status !== "failed") {
        return res.status(400).json({ error: "Chunk is not in a retryable state" });
      }
      // Reset to pending (keep retryCount — it tracks lifetime attempts,
      // not just this resume) so the normal claim path below picks it up.
      await chunkRef.update({ status: "pending", reason: null, updatedAt: Timestamp.now() });
      await jobRef.update({
        status: "running",
        blockedChunkIndexes: FieldValue.delete(),
        canProceedWithoutBlocked: FieldValue.delete(),
        chunksAtRetryLimit: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      });
      return res.json({ jobStatus: "running", retriedChunkIndex: chunkIndex });
    }

    if (action === "proceed_without") {
      if (job.status !== "blocked") return res.status(400).json({ error: "Job is not blocked" });
      // Re-verify server-side — never trust the client's cached snapshot of
      // canProceedWithoutBlocked for the actual finalize decision.
      const chunkSnap = await jobRef.collection("chunks").get();
      const stillFailed = chunkSnap.docs.filter(d => d.data().status === "failed");
      const stillCriticalFailed = stillFailed.filter(d => d.data().criticality !== "non_critical");
      const anyFinancialCritical = stillCriticalFailed.some(d => d.data().criticality === "financial_critical");
      if (anyFinancialCritical) {
        return res.status(400).json({ error: "Cannot proceed — a financial-critical section failed. Abandon is the only option." });
      }
      if (stillCriticalFailed.length === 0) {
        // Nothing actually blocking anymore (e.g. a concurrent retry
        // already succeeded) — just finalize normally.
        const result = await finalizeOrBlockJob(db, jobRef, job, req);
        return res.json(result);
      }
      const result = await finalizeJob(db, jobRef, job, chunkSnap.docs, req);
      return res.json(result);
    }

    // ── Normal (no-action) flow ─────────────────────────────────────────────
    if (job.status === "blocked") {
      // Nothing to claim — blocked chunks are terminal 'failed' and won't
      // be reclaimed. Surface the existing blocked-state fields as-is
      // rather than re-deriving them (cheaper, and avoids any chance of
      // flip-flopping status on a bare poll).
      return res.json({
        jobStatus: "blocked",
        chunksDone: job.chunksDone, chunksFailed: job.chunksFailed, chunkCount: job.chunkCount,
        blockedChunkIndexes: job.blockedChunkIndexes ?? [],
        canProceedWithoutBlocked: job.canProceedWithoutBlocked ?? false,
        chunksAtRetryLimit: job.chunksAtRetryLimit ?? [],
      });
    }

    const claimed = await claimNextChunk(db, jobId);
    if (claimed === "all_terminal") {
      const result = await finalizeOrBlockJob(db, jobRef, job, req);
      return res.json(result);
    }
    if (!claimed) {
      // Chunks remain but none claimable — something else is genuinely
      // mid-chunk (sequential model: back off rather than fight over it;
      // the onSnapshot listener still reflects live progress either way).
      return res.json({ jobStatus: job.status === "queued" ? "running" : job.status, noMoreClaimable: true });
    }

    const { chunkRef, data: chunk } = claimed;
    if (job.status === "queued") {
      await jobRef.update({ status: "running", updatedAt: Timestamp.now() });
    }

    const { userProfile, language, extraContext } = job.request;
    const extraContextStr = extraContext
      ? `\n\n--- EXTRA CONTEXT / RE-ANALYSIS UPDATE ---\n${extraContext}\n`
      : "";

    try {
      const aiClient = getAI();
      const docContents = await buildChunkDocContents(chunk, userProfile, extraContextStr, chunk.index, job.chunkCount);

      const response = await generateContentWithRetry(
        aiClient,
        {
          model: "gemini-3.5-flash",
          contents: docContents,
          config: {
            systemInstruction: buildAnalysisSystemInstruction(language),
            responseMimeType: "application/json",
            responseSchema: ANALYSIS_RESPONSE_SCHEMA_CHUNK,
          },
        },
        CHUNK_RETRY_CEILING,
      );

      const parsedData = robustJsonParse(response.text);
      // Server-side completion write (carry-forward requirement #1) — this
      // happens regardless of whether the client that triggered it is
      // still connected; resume's "what's next" query reads exactly this.
      await chunkRef.update({ status: "done", result: parsedData, updatedAt: Timestamp.now() });

      const counts = await jobRef.collection("chunks").get();
      const chunksDone = counts.docs.filter(d => d.data().status === "done").length;
      const chunksFailed = counts.docs.filter(d => d.data().status === "failed").length;
      const allTerminal = chunksDone + chunksFailed >= job.chunkCount;
      if (allTerminal) {
        const result = await finalizeOrBlockJob(db, jobRef, { ...job, chunksDone, chunksFailed }, req);
        return res.json({ ...result, chunkIndex: chunk.index, chunkStatus: "done" });
      }
      await jobRef.update({ chunksDone, chunksFailed, status: "running", updatedAt: Timestamp.now() });
      return res.json({
        jobStatus: "running",
        chunkIndex: chunk.index, chunkStatus: "done",
        chunksDone, chunksFailed, chunkCount: job.chunkCount,
      });
    } catch (chunkErr: any) {
      // A chunk failing after its retry ceiling does NOT fail the job —
      // mark just this chunk failed; whether that blocks the job or is
      // auto-skipped depends on its criticality, decided below.
      const message = chunkErr?.message ? String(chunkErr.message).slice(0, 300) : "Unknown error";
      console.error(`[process-analysis-job] Chunk ${chunk.index} failed:`, chunkErr);
      await chunkRef.update({
        status: "failed",
        reason: message,
        retryCount: FieldValue.increment(1),
        updatedAt: Timestamp.now(),
      });

      const counts = await jobRef.collection("chunks").get();
      const chunksDone = counts.docs.filter(d => d.data().status === "done").length;
      const chunksFailed = counts.docs.filter(d => d.data().status === "failed").length;
      const allTerminal = chunksDone + chunksFailed >= job.chunkCount;
      if (allTerminal) {
        // Only decide block-vs-finalize once EVERY chunk has reached a
        // terminal state — deciding early (e.g. the instant one critical
        // chunk fails) would leave other, still-'pending' chunks neither
        // done nor failed; if the user later chose "proceed without" while
        // those sat unprocessed, their content would silently vanish from
        // the merge instead of being properly included or flagged skipped.
        const result = await finalizeOrBlockJob(db, jobRef, { ...job, chunksDone, chunksFailed }, req);
        return res.json({ ...result, chunkIndex: chunk.index, chunkStatus: "failed" });
      }
      await jobRef.update({ chunksDone, chunksFailed, status: "running", updatedAt: Timestamp.now() });
      return res.json({
        jobStatus: "running",
        chunkIndex: chunk.index, chunkStatus: "failed",
        chunksDone, chunksFailed, chunkCount: job.chunkCount,
      });
    }
  } catch (err: any) {
    console.error("[process-analysis-job] Error:", err);
    return res.status(400).json({ error: err?.message ?? "Unknown error" });
  }
});

app.post("/api/compare-tender", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { originalTender, newDocument, documentType = "DOCUMENT", language } = req.body;
    if (!originalTender || !newDocument) {
      return res.status(400).json({ error: "originalTender and newDocument are required" });
    }

    const aiClient = getAI();
    const safeDocType = (documentType || "DOCUMENT").toUpperCase();
    let docContents: any[];

    if (newDocument.startsWith("data:application/pdf;base64,")) {
      docContents = [
        `--- ORIGINAL TENDER DETAILS ---\n${JSON.stringify(originalTender)}\n\n--- NEW ${safeDocType} DOCUMENT (Attached as PDF) ---\n`,
        {
          inlineData: {
            mimeType: "application/pdf",
            data: newDocument.replace(/^data:application\/pdf;base64,/, ""),
          },
        },
      ];
    } else {
      docContents = [
        `--- ORIGINAL TENDER DETAILS ---\n${JSON.stringify(originalTender)}\n\n--- NEW ${safeDocType} DOCUMENT ---\n${newDocument}`,
      ];
    }

    const systemInstruction = `You are a Tender Document Comparison Engine. Compare the Original Tender Details against the New ${safeDocType} uploaded by the user. Highlight EXACTLY what changed. Outputs must be clear and direct.${
      language && language !== "en"
        ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all content STRICTLY in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}.`
        : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all content STRICTLY in English.`
    }`;

    const response = await generateContentWithRetry(aiClient, {
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: docContents.map((d) => (typeof d === "string" ? { text: d || " " } : d)),
        },
      ],
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
            new_recommendations: { type: "string" },
          },
          required: [
            "added_clauses",
            "removed_clauses",
            "changed_dates",
            "changed_eligibility",
            "changed_emd",
            "critical_changes_summary",
            "new_recommendations",
          ],
        },
      },
    });

    res.json({ comparison: robustJsonParse(response.text) });
  } catch (err: any) {
    console.error("Compare Tender Error:", err);
    res.status(400).json({ error: err.message });
  }
});

app.post(
  "/api/chat-tender",
  verifyFirebaseToken,
  requireTrialAwareAccess("chat"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { tenderDocument, analysisResult, messages, language, paymentRecords } = req.body;
      if ((!tenderDocument && !analysisResult) || !messages || !Array.isArray(messages)) {
        return res
          .status(400)
          .json({ error: "tenderDocument and messages array are required" });
      }

      const aiClient = getAI();
      let tenderContextText = "";
      const documentParts: any[] = [];

      if (typeof tenderDocument === "string") {
        tenderContextText = tenderDocument.substring(0, 50000);
      } else if (Array.isArray(tenderDocument)) {
        tenderContextText = "Multiple documents attached as files.";
        for (const item of tenderDocument) {
          if (typeof item === "string") {
            if (item.startsWith("data:")) {
              const match = item.match(/^data:([^;]+);base64,(.*)$/);
              if (match) {
                documentParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
              }
            } else if (item.startsWith("http")) {
              // Phase 3: safeFetch guards against SSRF before touching the network
              try {
                const fetched = await safeFetch(item);
                if (fetched.ok) {
                  const contentType = fetched.headers.get("content-type") || "application/pdf";
                  const buffer = await fetched.arrayBuffer();
                  if (contentType.includes("text/plain")) {
                    tenderContextText += `\n--- DOCUMENT CONTENT ---\n${Buffer.from(buffer).toString("utf-8")}\n`;
                  } else {
                    documentParts.push({
                      inlineData: {
                        mimeType: contentType,
                        data: Buffer.from(buffer).toString("base64"),
                      },
                    });
                  }
                }
              } catch (err) {
                console.error("Failed to fetch storage URL in chat", item, err);
              }
            }
          }
        }
      }

      const instructionText = `You are a tender assistant for this specific tender. Answer questions about this tender document, the bidding process, eligibility, requirements, deadlines, the user's business profile and payment records, and drafting tender-related letters. If asked about anything unrelated to tenders or this project, politely decline and redirect: "I can only help with questions about this tender and your bid. What would you like to know about it?"

You are a specialized Procurement Assistant and Letter Drafter helping an Indian business with a specific tender.

CAPABILITIES:
1. ANSWER QUESTIONS: Respond clearly to questions about the tender, deadlines, eligibility, documents, and payment records. Follow Indian tendering terminology (EMD, PBG, BOQ, etc.). If a detail is missing, state it is not specified and advise to check for corrigendums.
2. DRAFT LETTERS & APPLICATIONS: When asked to write, draft, or compose a letter, application, notice, or formal correspondence, produce a complete, ready-to-use draft. Use the tender details (tender number, authority name, dates) and business profile (company name, address, GST, PAN) already in context to fill in real specifics. Typical requests include: "write an EMD refund request", "draft a deadline extension letter", "write a clarification query to the department", "compose a bank guarantee release letter".

LETTER FORMAT RULES — when producing a drafted letter or application:
• Start your ENTIRE response with the token %%LETTER_DRAFT%% on the very first line, with nothing before it.
• Immediately follow with the complete letter in Markdown: date line, To/From address blocks, subject, salutation, body, closing, signature block.
• Use __________ (12 underscores) for any value not available in the provided context.
• Do NOT write a preamble or explanation before the letter body — the token is immediately followed by the letter.
• You MAY add a short note AFTER the letter (e.g. "Please verify the tender number before sending.").

⚠️ ABSOLUTE PROHIBITION ON FABRICATED DATA (applies to both answers AND drafted letters):
You may ONLY use values actually present in the Business Profile, Tender Details, or Payment Records provided. NEVER invent, guess, infer, or use example values for:
- Statutory identifiers: GST, PAN, TAN, CIN, LLPIN, DIN, Udyam/MSME, ESIC, EPF, professional tax numbers
- Stamp paper / e-stamp certificate numbers, serial numbers, account references, or issue dates
- Bank details: account numbers, IFSC, bank guarantee numbers, DD numbers
- Registration/licence numbers of any kind
- Dates (incorporation, execution, payment) not supplied
- Turnover, net worth, or any financial figure not supplied
- Names, addresses, or contact details not supplied
- Notary details, commission numbers, or attestation particulars
If ANY value is not in the provided data, output __________ in its place. A blank the user fills by hand is CORRECT. An invented plausible-looking value is a SERIOUS ERROR that could invalidate the user's bid or expose them to legal liability.${
        language && !language.startsWith("en")
          ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST respond entirely in ${language.startsWith("hi") ? "Hindi" : language.startsWith("gu") ? "Gujarati" : language}. Every part of your reply — explanations, headings, lists, and any drafted letters — must be written in that language. Do not reply in English.`
          : ""
      }

--- TENDER CONTEXT ---
${tenderContextText || "No raw text provided."}

--- PREVIOUS AI ANALYSIS ---
${analysisResult ? JSON.stringify(analysisResult) : "No previous analysis provided."}
${Array.isArray(paymentRecords) && paymentRecords.length > 0 ? `
--- PAYMENT RECORDS (user-recorded for this project) ---
${paymentRecords.map((p: any) => {
  const refundable = p.refundable ?? ['EMD','Security Deposit','Performance Security','Retention Money'].includes(p.type);
  const status = p.refundStatus ?? p.emdStatus;
  return `${p.type} [${refundable ? 'Refundable' : 'Non-refundable'}]: ₹${p.amount} | Date: ${p.datePaid} | Mode: ${p.paymentMode} | Ref: ${p.referenceNumber || "N/A"}${refundable ? ` | Refund Status: ${status || 'Paid'}` : ""}${p.expectedRefundDate ? ` | Expected Refund: ${p.expectedRefundDate}` : ""}${p.notes ? ` | Notes: ${p.notes}` : ""}`;
}).join("\n")}
Total Paid: ₹${paymentRecords.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)} | Refundable Locked: ₹${paymentRecords.filter((p: any) => (p.refundable ?? ['EMD','Security Deposit','Performance Security','Retention Money'].includes(p.type)) && (p.refundStatus ?? p.emdStatus) !== "Refunded").reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)} | Non-refundable Spent: ₹${paymentRecords.filter((p: any) => !(p.refundable ?? ['EMD','Security Deposit','Performance Security','Retention Money'].includes(p.type))).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)}
` : ""}
`;

      const formattedContents = messages.map((msg: any) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text || " " }],
      }));

      if (documentParts.length > 0 && formattedContents.length > 0) {
        formattedContents[0].parts.unshift(...documentParts);
      }

      const response = await generateContentWithRetry(aiClient, {
        model: "gemini-3.5-flash",
        contents: formattedContents,
        config: { systemInstruction: { parts: [{ text: instructionText }] } },
      });

      logUsageEvent({ uid: req.user!.uid, type: 'chat', success: true });
      res.json({ answer: response.text });
    } catch (err: any) {
      console.error("Chat Tender Error:", err);
      logUsageEvent({ uid: req.user!.uid, type: 'chat', success: false, failureReason: err.message.slice(0, 300) });
      res.status(400).json({ error: err.message });
    }
  }
);

app.post(
  "/api/extract-receipt",
  verifyFirebaseToken,
  requireCredits,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { receiptBase64, mimeType } = req.body;
      if (!receiptBase64) return res.status(400).json({ error: "receiptBase64 is required" });

      const aiClient = getAI();
      const response = await generateContentWithRetry(aiClient, {
        model: "gemini-3.5-flash",
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType || "image/jpeg", data: receiptBase64 } },
            { text: `Extract payment details from this receipt/challan/bank statement.
Return ONLY a JSON object with these fields (omit any field you cannot determine with confidence):
{
  "amount": <number in INR, no symbols>,
  "datePaid": "<YYYY-MM-DD>",
  "referenceNumber": "<UTR / transaction ID / challan no. / DD no.>",
  "paymentMode": "<one of: DD, Bank Guarantee, Online, Cash>"
}
Rules:
- amount: total payment as a plain number (e.g. 50000)
- datePaid: in YYYY-MM-DD format
- referenceNumber: the most specific identifier on the receipt
- paymentMode: map to the closest of DD / Bank Guarantee / Online / Cash
- Return ONLY valid JSON, no markdown fences, no extra text` }
          ]
        }],
      });

      let extracted: Record<string, any> = {};
      try {
        const raw = (response.text || "").trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        extracted = JSON.parse(raw);
      } catch {
        // parsing failure is non-fatal — client handles empty gracefully
      }
      logUsageEvent({ uid: req.user!.uid, type: 'extraction', success: true });
      res.json(extracted);
    } catch (err: any) {
      console.error("Extract receipt error:", err);
      logUsageEvent({ uid: req.user!.uid, type: 'extraction', success: false, failureReason: err.message.slice(0, 300) });
      res.status(400).json({ error: err.message });
    }
  }
);

app.post(
  "/api/generate-doc",
  verifyFirebaseToken,
  requireTrialAwareAccess("doc"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { docType, tenderDetails, userProfile, financialData, finalizedBid, extraInstructions, language,
              exactFormBase64, exactFormMimeType, exactFormUrl } =
        req.body;
      if (!tenderDetails) {
        return res.status(400).json({ error: "tenderDetails is required" });
      }
      if (!exactFormBase64 && !exactFormUrl && !docType) {
        return res.status(400).json({ error: "docType is required when not using exact form mode" });
      }

      const aiClient = getAI();
      let financialContext = "";
      if (financialData?.revenue) {
        financialContext = `\n--- PREPARED BID FINANCIALS ---\nTotal Bid Amount: ₹${financialData.revenue}\nMaterial Costs: ${JSON.stringify(financialData.materials)}\nLabour Costs: ${JSON.stringify(financialData.labour)}\nEnsure that if the document is a commercial / financial bid proposal or cost breakdown, you strictly use these final user-approved numbers.`;
      }

      // Populated only once a bid has been finalized at least once (see
      // ProjectDetails.tsx's `finalizedBid` construction, gated on
      // boq.finalisedAt with per-field confirm flags) — every currency
      // figure is pre-formatted with fmtINR (the same formatter BOQSection's
      // Financial Summary and BOQViewer's exports use) so the model only
      // ever echoes an already-correct string, never formats one itself.
      let finalizedBidContext = "";
      if (finalizedBid) {
        const lines: string[] = [];
        if (finalizedBid.projectName) lines.push(`Project Name: ${finalizedBid.projectName}`);
        if (finalizedBid.tenderName) lines.push(`Tender Name: ${finalizedBid.tenderName}`);
        if (finalizedBid.tenderValue) lines.push(`Tender Value (reference only): ${finalizedBid.tenderValue}`);
        if (finalizedBid.pricingMethod) lines.push(`Pricing Method: ${finalizedBid.pricingMethod}`);
        if (finalizedBid.scheduleBAmount != null) lines.push(`Schedule-B Amount: ${fmtINR(finalizedBid.scheduleBAmount)}`);
        if (finalizedBid.bidPercent != null) lines.push(`Bid %: ${finalizedBid.bidPercent}% ${finalizedBid.aboveBelow ?? ''}`.trim());
        if (finalizedBid.quotedAmount != null) lines.push(`Quoted Amount: ${fmtINR(finalizedBid.quotedAmount)}${finalizedBid.quotedAmountWords ? ` (${finalizedBid.quotedAmountWords})` : ''}`);
        if (finalizedBid.gstIncluded) {
          const gstLabel = finalizedBid.gstIncluded === 'yes' ? 'Rates are inclusive of GST'
            : finalizedBid.gstIncluded === 'no' ? 'GST is not applicable'
            : `GST payable separately${finalizedBid.gstPercent != null ? ` @ ${finalizedBid.gstPercent}%` : ''}`;
          lines.push(`GST Treatment: ${gstLabel}`);
        }
        if (finalizedBid.cessAmount != null) lines.push(`Welfare Cess: ${fmtINR(finalizedBid.cessAmount)}${finalizedBid.cessPercent != null ? ` (${finalizedBid.cessPercent}%)` : ''}`);
        if (finalizedBid.gstAmount != null) lines.push(`GST Amount: ${fmtINR(finalizedBid.gstAmount)}`);
        if (finalizedBid.finalTotal != null) lines.push(`Final Total (incl. GST): ${fmtINR(finalizedBid.finalTotal)}`);
        if (finalizedBid.completionPeriodLabel) lines.push(`Completion Period: ${finalizedBid.completionPeriodLabel}`);
        if (finalizedBid.bidValidityLabel) lines.push(`Bid Validity: ${finalizedBid.bidValidityLabel}`);
        if (finalizedBid.expectedRevenue != null) lines.push(`Expected Revenue: ${fmtINR(finalizedBid.expectedRevenue)}`);

        if (lines.length > 0) {
          finalizedBidContext = `\n--- FINALIZED BID DATA ---\nUse these EXACT figures verbatim wherever the document needs bid-pricing/financial figures — they are already correctly formatted; do not reformat, recompute, round, or re-derive them.\n${lines.join('\n')}\nIf a bid-pricing figure is needed but not listed above, output __________ (12 underscores) — never guess or derive one.`;
        }
      }

      let extraContext = "";
      if (extraInstructions) {
        extraContext = `\n--- USER SPECIFIC INSTRUCTIONS FOR THIS DOCUMENT ---\n${extraInstructions}\nPlease strictly incorporate the user's instructions above when filling out this document.`;
      }

      const systemInstruction = `You are "Tender MasterAI", an expert legal and corporate procurement assistant specializing in Indian tenders.
Your task is to generate high-quality, professional draft documents based on the provided tender analysis and the user's business profile.
Use the business profile data (Company Name, Address, GST, PAN, etc.) and Tender Details (Tender No., Dates, Authority Name, etc.) to automatically fill in ALL placeholders.
CRITICAL RULE: DO NOT leave placeholders like "[Tender Number - To be filled by bidder]" or "[Date]" or "[Bidder Name]" in the output. You MUST aggressively find and replace all such "fill in the blank" brackets with the actual data from the provided Tender Details and Business Profile. If a specific value is not present in the provided data, output __________ (12 underscores) in its place — never invent or assume a value.

⚠️ ABSOLUTE PROHIBITION ON FABRICATED DATA:
You may ONLY use values that are actually present in the Business Profile or Tender Details provided to you. You must NEVER invent, guess, infer, or use example/placeholder values for ANY of the following:
- Statutory identifiers: GST, PAN, TAN, CIN, LLPIN, DIN, Udyam/MSME, ESIC, EPF, professional tax numbers
- Stamp paper / e-stamp certificate numbers, serial numbers, account references, or issue dates
- Bank details: account numbers, IFSC, bank guarantee numbers, DD numbers
- Registration/licence numbers of any kind
- Dates (incorporation, execution, payment) that are not supplied
- Turnover, net worth, or any financial figure not supplied
- Names, addresses, or contact details not supplied
- Notary details, commission numbers, or attestation particulars
If ANY required value is not present in the provided data, output __________ (12 underscores) in its place. A blank the user fills by hand is CORRECT. A plausible-looking invented value is a SERIOUS ERROR that could invalidate the user's bid or expose them to legal consequences. Do not produce sample/dummy values even if the field seems to require one.
If the document requested is an "Auto-Fill: [Annexure Name]", your job is to auto-generate the filled-up annexure exactly as it should be submitted. Since real annexures are often tabular forms in PDFs, YOU MUST reconstruct the exact Annexure/Schedule/Form tabular layout required by the agency using Markdown tables and lists. Place the bidder's information directly into the respective form fields/cells. Ensure it accurately represents the structured form that can be submitted to the agency. Do not leave blanks if information can be reasonably derived or if standard boilerplate is applicable.

--- FORMAT DETECTION — MANDATORY FIRST STEP ---
Before generating the document, examine the TENDER DETAILS JSON below to determine whether the tender authority prescribes a SPECIFIC FORMAT, PROFORMA, or STRUCTURE for the requested document type. Signals to look for:
• An entry in "required_annexures" or "required_documents_checklist" whose name or description matches the requested document type.
• References to a named form or annexure (e.g. "Annexure-C", "Form-T1", "as per proforma", "as per attached format").
• Specified table columns, field labels, declarations, or clause wording associated with the document type.
• Any phrase indicating the format is "prescribed", "mandatory", or "as specified by the authority".

CASE A — Tender DOES specify a format for this document:
• Reproduce THAT exact structure VERBATIM: every field label, row heading, table column, section title, and prescribed clause wording must match the tender's original as closely as the extracted content permits. Where clause wording appears in the tender, copy it exactly — do NOT paraphrase or rewrite it in your own words.
• Do NOT add sections, blocks, or declarations that are not in the original. For example: do not invent stamp-certificate blocks, notary sections, witness fields, or authority attestation panels unless the tender explicitly includes them.
• Do NOT reorder the fields or sections — preserve the tender's sequence exactly.
• Fill the bidder's actual data into the correct cells/fields. Do not leave blanks or bracketed placeholders if the information is available.

CASE B — Tender does NOT specify a format for this document:
• Generate using a standard professional format appropriate for Indian government tendering.${
        language && language !== "en"
          ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST draft the document STRICTLY in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}, unless the user asks otherwise.`
          : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST draft the document STRICTLY in English, unless the user asks otherwise.`
      }
${financialContext}${finalizedBidContext}${extraContext}

--- BUSINESS PROFILE ---
${userProfile ? JSON.stringify(userProfile) : "Not provided."}

--- TENDER DETAILS ---
${JSON.stringify(tenderDetails)}
`;

      let response: any;

      if ((exactFormBase64 && exactFormMimeType) || exactFormUrl) {
        // ── Exact-form mode: user uploaded the blank form; reproduce it verbatim ──
        const exactFormSystemInstruction = `You are "Tender MasterAI". The user has uploaded the EXACT blank form/annexure they must submit to the tender authority.

YOUR TASK:
Reproduce the uploaded form in its entirety and fill in the blank fields using the bidder's Business Profile and Tender Details provided below.

STRICT RULES — follow every one without exception:
1. Copy every field label, row heading, column header, table structure, section title, and prescribed clause wording VERBATIM from the uploaded form — character for character where visible. Do NOT paraphrase, simplify, or rephrase any printed text.
2. Do NOT add any section, block, row, field, or declaration that is not present in the uploaded form (e.g. do not invent stamp-certificate panels, notary blocks, witness fields, or authority attestations unless they appear in the uploaded image).
3. Do NOT reorder any field or section — preserve the form's sequence exactly as shown.
4. Fill blank/empty response fields using two sources in order of priority:
   a) TENDER-REFERENCE FIELDS (Tender No., Tender ID, Name of Work, submission deadline, issuing department/authority, NIT number, etc.) — fill these from the TENDER DETAILS provided below. These values are known; do NOT leave them blank.
   b) BIDDER FIELDS (company name, address, GST, PAN, signatory, etc.) — fill from the BUSINESS PROFILE below.
   For any field where data is genuinely unavailable from both sources, output exactly "__________" (12 underscores). NEVER output "[FILL MANUALLY]", "[NOT APPLICABLE]", "[INSERT HERE]", "[FILL]", "[N/A]", or any other bracketed marker — only "__________".
5. Reproduce the form's layout as faithfully as possible using HTML tables (<table>/<tr>/<th>/<td>) with rowspan and colspan attributes to faithfully reproduce merged cells, column spans, nested cells, and the form's exact visual structure. Multi-column forms become multi-column <table> elements. Nested cells (e.g. multiple fields stacked in one cell) use rowspan/colspan or nested <table> elements.
6. Output ONLY the completed form as a clean HTML fragment — no preamble, no commentary, no <html>/<head>/<body>/<style>/<script> wrapper, no inline CSS. Do NOT add any title, label, date, timestamp, or metadata that is not present in the uploaded form — begin directly with the form's own content. Use <table>, <tr>, <th>, <td> with rowspan/colspan as needed. Use <p> for paragraph text, <strong> for bold, <br> for line breaks within a cell. Do NOT embed base64 image data, data: URIs, or any binary content — omit logos and images entirely. Do NOT output any Markdown syntax.
7. HEADER/FOOTER STRUCTURE — wrap your ENTIRE output in a page-layout table so the header and footer repeat on every printed page without overlapping content:
   <table class="page-layout">
     <thead id="letterhead-header"><tr><td>[letterhead block: org name, CIN/registration, address, tagline]</td></tr></thead>
     <tbody><tr><td>[ALL form content: every field, table, section, declaration, clause]</td></tr></tbody>
     <tfoot id="letterhead-footer"><tr><td>[contact/footer block: phone, email, website]</td></tr></tfoot>
   </table>
   The browser's print engine repeats <thead> at the top and <tfoot> at the bottom of every page automatically — heights are driven by content, so nothing is clipped and nothing overlaps.
   • If the form has no distinct letterhead/header block, omit <thead id="letterhead-header"> entirely.
   • If the form has no distinct footer block, omit <tfoot id="letterhead-footer"> entirely.
   • Nesting <table> elements inside the <tbody><tr><td> is valid — preserve all form tables there.
   • Do NOT use <header> or <footer> HTML elements — use only the <thead>/<tfoot> structure above.
8. ARTIFACT REMOVAL: The following are print/pagination artifacts — remove them completely, do not reproduce them anywhere in your output:
   • Page number markers in any form: "- 10 -", "- 11 -", "Page 2 of 5", "2/5", etc.
   • Repeated website URLs, telephone lines, or taglines such as "ASSURING THE BEST SERVICES..." or "YOUR SATISFACTION IS OUR MOTTO" when they appear mid-document as page-footer repetitions.
   • Any text that is clearly a running page header or footer repeating on each physical page rather than being part of the actual form content.
9. ⚠️ ABSOLUTE PROHIBITION ON FABRICATED DATA: You may ONLY use values that are actually present in the Business Profile or Tender Details provided to you. You must NEVER invent, guess, infer, or use example/placeholder values for ANY of the following:
   - Statutory identifiers: GST, PAN, TAN, CIN, LLPIN, DIN, Udyam/MSME, ESIC, EPF, professional tax numbers
   - Stamp paper / e-stamp certificate numbers, serial numbers, account references, or issue dates
   - Bank details: account numbers, IFSC, bank guarantee numbers, DD numbers
   - Registration/licence numbers of any kind
   - Dates (incorporation, execution, payment) that are not supplied
   - Turnover, net worth, or any financial figure not supplied
   - Names, addresses, or contact details not supplied
   - Notary details, commission numbers, or attestation particulars
   If ANY required value is not present in the provided data, output __________ (12 underscores) in its place. A blank the user fills by hand is CORRECT. A plausible-looking invented value is a SERIOUS ERROR that could invalidate the user's bid or expose them to legal consequences. Do not produce sample/dummy values even if the field seems to require one. NEVER generate, fabricate, or invent stamp paper certificates, e-stamp blocks, e-stamp certificate numbers (e-SBTR, CERT-IN, or any format), serial numbers, UID/UUID codes, or any fictional statutory document identifiers.${
  language && language !== "en"
    ? `\nCRITICAL LANGUAGE REQUIREMENT: Fill in bidder data in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}, but keep all printed form labels exactly as they appear in the uploaded image.`
    : ""
}

--- BUSINESS PROFILE ---
${userProfile ? JSON.stringify(userProfile) : "Not provided."}

--- TENDER DETAILS ---
${JSON.stringify(tenderDetails)}${financialContext}${finalizedBidContext}${extraContext}`;

        // Resolve base64 + mimeType from URL (Storage-first path) or direct upload (fallback)
        let resolvedBase64 = exactFormBase64 as string;
        let resolvedMimeType = (exactFormMimeType || "application/pdf") as string;
        if (exactFormUrl) {
          let urlResp: Response;
          try {
            urlResp = await safeFetch(exactFormUrl as string);
          } catch (e) {
            return res.status(400).json({ error: "Could not fetch form file: " + (e as Error).message });
          }
          if (!urlResp.ok) {
            return res.status(400).json({ error: `Failed to fetch form file: HTTP ${urlResp.status}` });
          }
          const buf = await urlResp.arrayBuffer();
          resolvedBase64 = Buffer.from(buf).toString("base64");
          resolvedMimeType = urlResp.headers.get("content-type") || resolvedMimeType;
        }
        const formPart = {
          inlineData: { mimeType: resolvedMimeType, data: resolvedBase64 },
        };
        const textPart = {
          text: "Reproduce and fill the exact blank form shown in the uploaded file. Follow all rules in your instructions strictly. Return ONLY the completed form as a clean HTML fragment — no <html>/<head>/<body> wrapper, no inline CSS, no Markdown syntax. Use HTML tables with rowspan/colspan to reproduce merged and nested cells exactly.",
        };

        response = await generateContentWithRetry(aiClient, {
          model: "gemini-3.5-flash",
          contents: [{ role: "user", parts: [formPart, textPart] }],
          config: { systemInstruction: exactFormSystemInstruction },
        });
        const fragment = response.text || "<p>Empty response from AI.</p>";
        logUsageEvent({ uid: req.user!.uid, type: 'document', success: true });
        if ((req as any).isTrialDocRequest) incrementTrialDocUsed(req.user!.uid);
        return res.json({ document: buildFormDocHtml(fragment), format: "html" });
      } else {
        // ── Standard mode: generate from tender data analysis ──
        const isAutoFill =
          docType.includes("Auto-Fill") ||
          docType.includes("Annexure") ||
          docType.includes("Schedule") ||
          docType.includes("Form");
        const prompt = isAutoFill
          ? `Apply the FORMAT DETECTION step from your instructions, then auto-fill the requested form/annexure/schedule: "${docType}". Re-create the form's exact structural layout using Markdown tables and lists to faithfully emulate the form's columns and rows, and insert the bidder's data directly. Return ONLY the completed form as clean Markdown — no HTML tags, no preamble, no commentary.`
          : `Apply the FORMAT DETECTION step from your instructions, then draft a highly professional, ready-to-use "${docType}" based on the Tender Details and Business Profile provided. Keep constraints and specifics of Indian tendering format in mind. Return ONLY the document as clean Markdown — use ## and ### headings, **bold**, Markdown tables, and bullet/numbered lists where appropriate. No HTML tags.`;

        response = await generateContentWithRetry(aiClient, {
          model: "gemini-3.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt || " " }] }],
          config: { systemInstruction },
        });
      }

      logUsageEvent({ uid: req.user!.uid, type: 'document', success: true });
      if ((req as any).isTrialDocRequest) incrementTrialDocUsed(req.user!.uid);
      res.json({ document: response.text || "Empty response from AI.", format: "markdown" });
    } catch (err: any) {
      console.error("Generate Doc Error:", err);
      logUsageEvent({ uid: req.user!.uid, type: 'document', success: false, failureReason: err.message.slice(0, 300) });
      res.status(400).json({ error: err.message });
    }
  }
);

// ---------------------------------------------------------------------------
// PDF generation endpoint (Puppeteer + @sparticuz/chromium-min)
// ---------------------------------------------------------------------------
app.post(
  "/api/generate-pdf",
  verifyFirebaseToken,
  requireTrialAwareAccess("export"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const {
        html,
        filename,
        isMarkdown,
        useUserLetterhead,
        letterheadImageBase64,
        letterheadHeaderHtml,
        letterheadFooterHtml,
      } = req.body as {
        html?: string;
        filename?: string;
        isMarkdown?: boolean;
        useUserLetterhead?: boolean;
        letterheadImageBase64?: string;
        letterheadHeaderHtml?: string;
        letterheadFooterHtml?: string;
      };
      if (!html || typeof html !== "string") {
        return res.status(400).json({ error: "html is required" });
      }

      // Convert Markdown → HTML shell when the document is Markdown-formatted (Mode A)
      let renderHtml: string;
      if (isMarkdown) {
        const { marked } = await import("marked");
        const fragment = String(marked.parse(html, { gfm: true }));
        renderHtml = buildDocHtml(fragment, filename || "document");
      } else {
        renderHtml = html;
      }

      // Path B: HTML header/footer — inject before Puppeteer renders (no image available)
      const hasImage = useUserLetterhead && letterheadImageBase64;
      const hasHtml =
        useUserLetterhead && !hasImage && (letterheadHeaderHtml || letterheadFooterHtml);
      if (hasHtml) {
        if (letterheadHeaderHtml) {
          renderHtml = renderHtml.replace(
            "</body>",
            `<div style="position:fixed;top:0;left:0;right:0;height:44mm;overflow:hidden;box-sizing:border-box;">${letterheadHeaderHtml}</div></body>`
          );
        }
        if (letterheadFooterHtml) {
          renderHtml = renderHtml.replace(
            "</body>",
            `<div style="position:fixed;bottom:0;left:0;right:0;height:30mm;overflow:hidden;box-sizing:border-box;">${letterheadFooterHtml}</div></body>`
          );
        }
      }

      // Tell chromium-min it's in a Lambda-like environment so it inflates
      // al2.tar.br (contains libnss3 etc.) and sets LD_LIBRARY_PATH correctly.
      // Vercel doesn't set AWS_EXECUTION_ENV, so the module's init code skips
      // the library setup — setting it here before the first import fixes that.
      if (!process.env.AWS_EXECUTION_ENV) {
        process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs18.x";
      }
      const chromium = (await import("@sparticuz/chromium-min")).default;
      const puppeteer = (await import("puppeteer-core")).default;

      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: null,
        executablePath: await chromium.executablePath(
          "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
        ),
        headless: chromium.headless as any,
      });

      const page = await browser.newPage();
      // networkidle0 ensures fonts/resources in srcdoc are fully settled
      await page.setContent(renderHtml, { waitUntil: "networkidle0" });
      const hasFormHeader = /id=["']form-header["']/.test(renderHtml);
      const hasFormFooter = /id=["']form-footer["']/.test(renderHtml);
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        margin: {
          top:    hasFormHeader ? "40mm" : "44mm",
          right:  "20mm",
          bottom: hasFormFooter ? "25mm" : "30mm",
          left:   "20mm",
        },
      });
      await browser.close();

      // Path A: image overlay — embed PNG/JPEG onto every page's 44mm top zone via pdf-lib
      let finalPdfBytes: Uint8Array = pdfBuffer;
      if (hasImage) {
        try {
          const { PDFDocument } = await import("pdf-lib");
          let imgStr = letterheadImageBase64 as string;
          let isJpeg = false;
          if (imgStr.startsWith("data:")) {
            const [header, data] = imgStr.split(",");
            isJpeg = header.includes("jpeg") || header.includes("jpg");
            imgStr = data;
          }
          const imgBytes = Buffer.from(imgStr, "base64");
          const docPdf = await PDFDocument.load(pdfBuffer);
          const lhImage = isJpeg
            ? await docPdf.embedJpg(imgBytes)
            : await docPdf.embedPng(imgBytes);
          const { width: imgW, height: imgH } = lhImage;
          // A4 in points; 44mm zone at top (bottom-left origin)
          const A4_W = 595.28;
          const A4_H = 841.89;
          const ZONE_H = 44 * (72 / 25.4); // 124.72 pt
          const scale = Math.min(A4_W / imgW, ZONE_H / imgH);
          const drawW = imgW * scale;
          const drawH = imgH * scale;
          const x = (A4_W - drawW) / 2;
          const y = A4_H - ZONE_H + (ZONE_H - drawH) / 2; // center in zone, bottom-left origin
          for (const pg of docPdf.getPages()) {
            pg.drawImage(lhImage, { x, y, width: drawW, height: drawH });
          }
          finalPdfBytes = await docPdf.save();
        } catch (overlayErr) {
          console.error("Letterhead overlay error, returning plain PDF:", overlayErr);
        }
      }

      const safeName =
        (filename || "document")
          .replace(/[^a-zA-Z0-9_\- ]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 80) || "document";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      res.send(Buffer.from(finalPdfBytes));
    } catch (err: any) {
      console.error("Generate PDF Error:", err);
      res.status(500).json({ error: err.message || "PDF generation failed" });
    }
  }
);

// ---------------------------------------------------------------------------
// Word (.docx) generation endpoint
// ---------------------------------------------------------------------------
app.post(
  "/api/generate-docx",
  verifyFirebaseToken,
  requireTrialAwareAccess("export"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { html, filename, isMarkdown } = req.body as {
        html?: string;
        filename?: string;
        isMarkdown?: boolean;
      };
      if (!html || typeof html !== "string") {
        return res.status(400).json({ error: "html is required" });
      }

      let docHtml: string;
      if (isMarkdown) {
        const { marked } = await import("marked");
        const fragment = String(marked.parse(html, { gfm: true }));
        // Minimal HTML wrapper — no PDF-specific CSS, cleaner for Word conversion
        docHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;}
          h1{font-size:16pt;font-weight:bold;text-align:center;}
          h2{font-size:13pt;font-weight:bold;}
          h3{font-size:12pt;font-weight:bold;}
          table{width:100%;border-collapse:collapse;margin:8pt 0;}
          th,td{border:1px solid #374151;padding:4pt 8pt;text-align:left;vertical-align:top;}
          th{background:#f3f4f6;font-weight:bold;}
        </style></head><body>${fragment}</body></html>`;
      } else {
        docHtml = html;
      }

      const HTMLtoDOCX = (await import("html-to-docx")).default;
      const buffer = await HTMLtoDOCX(docHtml, undefined, {
        table: { row: { cantSplit: true } },
        footer: false,
        pageNumber: false,
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      });

      const safeName =
        (filename || "document")
          .replace(/[^a-zA-Z0-9_\- ]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 80) || "document";

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
      logUsageEvent({ uid: req.user!.uid, type: 'document', success: true });
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("Generate DOCX Error:", err);
      logUsageEvent({ uid: req.user!.uid, type: 'document', success: false, failureReason: err.message.slice(0, 300) });
      res.status(500).json({ error: err.message || "Word generation failed" });
    }
  }
);

// ---------------------------------------------------------------------------
// Mode B — Vision field probe: POST /api/modeb/probe
// ---------------------------------------------------------------------------
// Accepts a Firebase Storage URL, runs Gemini Vision on all pages, and
// returns the detected field map (labels + bounding boxes + page numbers).
// Probe results are cached in Firestore for 7 days to avoid re-running Vision
// on the same form.  Gated with requireTrialAwareAccess('doc') so it counts
// against the same entitlement as document generation.
// ---------------------------------------------------------------------------
const MODEB_PROBE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

app.post(
  '/api/modeb/probe',
  verifyFirebaseToken,
  requireTrialAwareAccess('doc'),
  async (req: AuthenticatedRequest, res) => {
    // Helper: compact ISO timestamp for every log line
    const mts = () => new Date().toISOString().slice(11, 23);
    const P = '[ModeBProbe]'; // log prefix
    let t: number;

    console.log(`${P} [START] request uid=${req.user!.uid} t=${mts()}`);

    const uid = req.user!.uid;
    const { storageUrl, projectId } = req.body as { storageUrl?: string; projectId?: string };

    if (!storageUrl || typeof storageUrl !== 'string') {
      return res.status(400).json({ error: 'storageUrl is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY ?? '';
    if (!apiKey) {
      return res.status(500).json({ error: 'Vision service not configured.' });
    }

    // ── 1. Firestore cache read ────────────────────────────────────────────────
    const urlHash = crypto.createHash('sha256').update(storageUrl).digest('hex');
    const db = getFirestore();
    const cacheRef = db.collection('modeb_probe_cache').doc(urlHash);
    t = Date.now();
    console.log(`${P} [START] cache-read hash=${urlHash.slice(0, 8)}… t=${mts()}`);
    try {
      const snap = await cacheRef.get();
      console.log(`${P} [END] cache-read duration=${Date.now() - t}ms exists=${snap.exists}`);
      if (snap.exists) {
        const d = snap.data()!;
        const age = Date.now() - (d.cachedAt?.toDate?.()?.getTime?.() ?? 0);
        if (age < MODEB_PROBE_CACHE_TTL_MS) {
          console.log(`${P} [INFO] cache hit (age=${Math.round(age / 1000)}s) — returning cached result`);
          return res.json({ fields: d.fields, pageW: d.pageW, pageH: d.pageH, pageCount: d.pageCount, fromCache: true });
        }
        console.log(`${P} [INFO] cache stale (age=${Math.round(age / 1000)}s) — re-probing`);
      }
    } catch (e) {
      console.log(`${P} [FAIL] cache-read duration=${Date.now() - t}ms err=${(e as Error).message} — continuing without cache`);
    }

    // ── 2. Fetch PDF from Firebase Storage (SSRF-guarded, 30 s abort) ─────────
    let pdfBuf: Buffer;
    const fetchController = new AbortController();
    const fetchTimeoutId = setTimeout(() => {
      console.log(`${P} [TIMEOUT] safeFetch aborted after 30s t=${mts()}`);
      fetchController.abort();
    }, 30_000);
    t = Date.now();
    console.log(`${P} [START] safeFetch url=${storageUrl.slice(0, 80)}… t=${mts()}`);
    try {
      const resp = await safeFetch(storageUrl, { signal: fetchController.signal });
      clearTimeout(fetchTimeoutId);
      console.log(`${P} [END] safeFetch duration=${Date.now() - t}ms status=${resp.status} content-type=${resp.headers.get('content-type')}`);
      if (!resp.ok) {
        return res.status(400).json({ error: `Could not fetch form file: HTTP ${resp.status}` });
      }
      const t2 = Date.now();
      console.log(`${P} [START] resp.arrayBuffer t=${mts()}`);
      pdfBuf = Buffer.from(await resp.arrayBuffer());
      console.log(`${P} [END] resp.arrayBuffer duration=${Date.now() - t2}ms bytes=${pdfBuf.length}`);
    } catch (e) {
      clearTimeout(fetchTimeoutId);
      console.log(`${P} [FAIL] safeFetch duration=${Date.now() - t}ms err=${(e as Error).message}`);
      return res.status(400).json({ error: 'Could not fetch form file: ' + (e as Error).message });
    }

    // ── 3. Vision probe (all pages; detailed per-step logging inside helper) ──
    let probeResult;
    t = Date.now();
    console.log(`${P} [START] probeAllPagesFromBuffer bytes=${pdfBuf.length} t=${mts()}`);
    try {
      probeResult = await probeAllPagesFromBuffer(
        pdfBuf,
        'form.pdf',
        apiKey,
        (msg) => console.log(`${P} ${msg}`),
      );
      console.log(`${P} [END] probeAllPagesFromBuffer duration=${Date.now() - t}ms fields=${probeResult.fields.length} partial=${probeResult.partial ?? false}`);
    } catch (e: any) {
      console.log(`${P} [FAIL] probeAllPagesFromBuffer duration=${Date.now() - t}ms err=${e?.message}`);
      logUsageEvent({ uid, type: 'modeb_probe', projectId, success: false, failureReason: (e?.message ?? '').slice(0, 300) });
      if (isProbeRetryable(e)) {
        return res.status(503).json({ error: 'Vision service is busy. Please try again in a few minutes.' });
      }
      return res.status(500).json({ error: 'Field detection failed. Please try again.' });
    }

    // ── 4. Usage event (fire-and-forget Firestore write) ──────────────────────
    console.log(`${P} [INFO] logUsageEvent (fire-and-forget) t=${mts()}`);
    logUsageEvent({ uid, type: 'modeb_probe', projectId, success: true });
    if ((req as any).isTrialDocRequest) incrementTrialDocUsed(uid);

    // ── 5. Cache write (fire-and-forget, but both sync and async errors caught) ──
    console.log(`${P} [INFO] cache-write (fire-and-forget) t=${mts()}`);
    try {
      cacheRef.set({ ...probeResult, cachedAt: Timestamp.now() })
        .catch(e => console.log(`${P} [FAIL] cache-write (async) err=${(e as Error).message}`));
    } catch (e: any) {
      console.log(`${P} [FAIL] cache-write (sync) err=${e.message}`);
    }

    // ── 6. Serialize and send response ────────────────────────────────────────
    const payload = {
      fields:      probeResult.fields,
      pageW:       probeResult.pageW,
      pageH:       probeResult.pageH,
      pageCount:   probeResult.pageCount,
      partial:     probeResult.partial ?? false,
      failedPages: probeResult.failedPages ?? [],
      fromCache:   false,
    };
    console.log(`${P} [INFO] serializing response: ${probeResult.fields.length} fields, ${JSON.stringify(payload).length} bytes t=${mts()}`);

    // Dump active handles — if this count is non-zero after res.json(), open
    // handles are what keep the Vercel function alive past our logic.
    const activeHandles   = (process as any)._getActiveHandles?.()?.length ?? 'n/a';
    const activeRequests  = (process as any)._getActiveRequests?.()?.length ?? 'n/a';
    console.log(`${P} [DIAG] before res.json: handles=${activeHandles} requests=${activeRequests} t=${mts()}`);

    console.log(`${P} [START] res.json t=${mts()}`);
    res.json(payload);
    console.log(`${P} [END] res.json — HTTP response written t=${mts()}`);

    // If the function does not exit after this point, open handles are keeping
    // the event loop alive.  Check handles/requests count above for clues.
    console.log(`${P} [INFO] handler returning t=${mts()}`);
  },
);

// ---------------------------------------------------------------------------
// Startup: sync Firestore roles for SUPERADMIN_EMAILS (makes DB the authority)
// ---------------------------------------------------------------------------
async function ensureSuperadminRoles() {
  const db = getFirestore();
  const auth = getAuth();
  for (const email of SUPERADMIN_EMAILS) {
    try {
      const userRecord = await auth.getUserByEmail(email);
      const ref = db.collection("users").doc(userRecord.uid);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.role !== "superadmin") {
        await ref.set({ role: "superadmin" }, { merge: true });
        console.log(`[Startup] Set superadmin role for ${email} (uid=${userRecord.uid})`);
      }
    } catch (e: any) {
      if (e.code !== "auth/user-not-found") {
        console.warn(`[Startup] Could not set superadmin role for ${email}:`, e.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dev server + static serving
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  ensureSuperadminRoles().catch(e => console.warn("[Startup] ensureSuperadminRoles:", e.message));

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
} else {
  // Vercel: fire-and-forget on cold start so Firestore role is synced
  ensureSuperadminRoles().catch(e => console.warn("[Startup] ensureSuperadminRoles:", e.message));
}

export default app;
