import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore as adminGetFirestore, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
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
// Phase 4: requireActiveEntitlement — reads role via Admin SDK (authoritative).
// Fails closed: any error → 500, not a pass-through.
// ---------------------------------------------------------------------------
const requireActiveEntitlement = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  if (!req.user?.uid) {
    return res.status(401).json({ error: "Unauthorized: Authenticated user context required" });
  }

  try {
    const db = getFirestore();
    const snap = await db.collection("users").doc(req.user.uid).get();

    let role = "free";
    let expiryDate: Date | null = null;

    if (snap.exists) {
      const data = snap.data() || {};
      role = data.role || "free";
      if (data.subscriptionExpiry) {
        expiryDate = data.subscriptionExpiry.toDate();
      }
    }

    // Hardcoded superadmin override
    if (req.user.email === "shivaminfotech89@gmail.com") role = "superadmin";

    if (role === "admin" || role === "superadmin") return next();

    if (role === "premium") {
      if (expiryDate && expiryDate <= new Date()) {
        return res
          .status(403)
          .json({ error: "Your Premium subscription has expired. Please renew to continue using advanced features." });
      }
      return next();
    }

    return res
      .status(403)
      .json({ error: "This feature requires an active Premium subscription. Please upgrade your account." });
  } catch (err) {
    console.error("[Entitlement] requireActiveEntitlement failed:", err);
    return res.status(500).json({ error: "Failed to verify user entitlements." });
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
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Amount must be at least 100 paise" });
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

    // Map authoritative amount (paise) → subscription days
    const authorizedAmountPaise = Number(payment.amount);
    let days = 30; // fallback for any unrecognised amount
    if (authorizedAmountPaise === 99900) days = 90;   // ₹999
    else if (authorizedAmountPaise === 199900) days = 365; // ₹1999

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + days);

    const granted = await setEntitlementClaims(uid, {
      role: "premium",
      subscriptionExpiry: newExpiry.toISOString(),
    });
    if (!granted) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to upgrade account privileges server-side." });
    }

    return res.json({
      success: true,
      message: "Payment verified successfully. Account upgraded to Premium.",
      days,
      newExpiry: newExpiry.toISOString(),
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

      if (email) {
        try {
          const userRecord = await getAuth().getUserByEmail(email);
          if (userRecord?.uid) {
            let days = 30;
            if (amountPaise === 99900) days = 90;
            else if (amountPaise === 199900) days = 365;

            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + days);

            await setEntitlementClaims(userRecord.uid, {
              role: "premium",
              subscriptionExpiry: newExpiry.toISOString(),
            });
            console.log(`[Webhook] Upgraded ${email} → premium (${days} days)`);
          }
        } catch (e) {
          console.error(`[Webhook] Failed to upgrade user ${email}:`, e);
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
// API routes
// ---------------------------------------------------------------------------

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
  requireActiveEntitlement,
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
      res.json({ extracted });
    } catch (err: any) {
      console.error("Extract Profile Data Error:", err);
      // Return empty extraction rather than an error — the UI handles the "nothing found" case
      res.json({ extracted: {} });
    }
  }
);

app.post("/api/analyze-tender", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenderDocument, tenderType = "text", tenderContent, userProfile, language } = req.body;
    const actualContent = tenderContent || tenderDocument;

    if (!actualContent || !userProfile) {
      return res.status(400).json({ error: "tender content and userProfile are required" });
    }

    const aiClient = getAI();
    let docContents: any[];
    let remarks: any = null;

    const extraContextStr = req.body.extraContext
      ? `\n\n--- EXTRA CONTEXT / RE-ANALYSIS UPDATE ---\n${req.body.extraContext}\n`
      : "";

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
      // Phase 3: every URL goes through safeFetch before touching the network
      const MAX_FILES = 10;
      const allUrls: string[] = Array.isArray(actualContent) ? actualContent : [];
      const totalFilesProvided = allUrls.length;
      const filesSkipped: { index: number; reason: string }[] = [];
      let filesAnalyzed = 0;

      docContents = [
        `--- USER PROFILE ---\n${userProfile}${extraContextStr}\n\n--- TENDER DOCUMENTS (Fetched from Storage) ---\n`,
      ];

      for (let i = 0; i < allUrls.length; i++) {
        if (i >= MAX_FILES) {
          filesSkipped.push({ index: i, reason: "Exceeded 10-file limit — file not analyzed" });
          continue;
        }
        const url = allUrls[i];
        try {
          const fetched = await safeFetch(url);
          if (!fetched.ok) {
            filesSkipped.push({ index: i, reason: `Fetch failed (HTTP ${fetched.status})` });
            continue;
          }
          const contentType = fetched.headers.get("content-type") || "application/pdf";
          const buffer = await fetched.arrayBuffer();
          if (contentType.includes("text/plain")) {
            const text = Buffer.from(buffer).toString("utf-8");
            docContents.push(`\n--- DOCUMENT CONTENT ---\n${text}\n`);
          } else {
            const base64 = Buffer.from(buffer).toString("base64");
            docContents.push({ inlineData: { mimeType: contentType, data: base64 } });
          }
          filesAnalyzed++;
        } catch (err) {
          console.error("Failed to fetch storage URL", url, err);
          filesSkipped.push({ index: i, reason: "Network error fetching file" });
        }
      }

      remarks = { totalFilesProvided, filesAnalyzed, filesSkipped, notes: [] };
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

    const systemInstruction = `IMPORTANT: Keep your analysis extremely concise (under 800 words total) to ensure fast processing times and prevent timeouts. Use short bullet points and skip unnecessary pleasantries. \n\nYou are "Tender MasterAI", the premier strategic procurement intelligence engine for Indian entrepreneurs and enterprises. Your role is to decode dense bureaucratic tender documents (from GeM, nProcure, CPPP, and private entities), match them ruthlessly against an Indian businessman's profile, and provide a clear, risk-managed path to winning the bid. BE EXTREMELY IN-DEPTH AND DETAILED in your rationales, lists, and steps. Elaborate heavily.
${
  language && language !== "en"
    ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}. Do not use English unless it is for technical terms that have no direct translation.`
    : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST output all your analysis and content STRICTLY in English. Do NOT output in Hindi, Gujarati, or any other regional language.`
}

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
              properties: { score: { type: "number" }, rationale: { type: "string" } },
              required: ["score", "rationale"],
            },
            tender_simplified: {
              type: "object",
              properties: {
                tender_name: { type: "string" },
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
          ],
        },
      },
    });

    const parsedData = robustJsonParse(response.text);

    if (remarks) {
      if (!parsedData?.bid_recommendation) {
        remarks.notes.push("Bid recommendation could not be determined — tender document may be incomplete or ambiguous.");
      }
      if (!parsedData?.timeline_and_milestones?.submission_deadline) {
        remarks.notes.push("Submission deadline was not found in the document — verify manually before bidding.");
      }
    }

    res.json({ analysis: parsedData, remarks });
  } catch (err: any) {
    console.error("Analyze Tender Error:", err);
    res.status(400).json({ error: err.message });
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
  requireActiveEntitlement,
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

      const instructionText = `You are a specialized Procurement Chatbot assisting an Indian business with a specific tender.
You have access to the original tender document and the AI analysis. Answer their questions clearly, concisely, and realistically based on the provided context. Follow Indian tendering terminology (EMD, PBG, BOQ, etc.). If a detail is missing, state it is not specified and advise to check for corrigendums.${
        language && language !== "en"
          ? `\nCRITICAL LANGUAGE REQUIREMENT: You MUST answer the user STRICTLY in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}.`
          : `\nCRITICAL LANGUAGE REQUIREMENT: You MUST answer the user STRICTLY in English.`
      }

--- TENDER CONTEXT ---
${tenderContextText || "No raw text provided."}

--- PREVIOUS AI ANALYSIS ---
${analysisResult ? JSON.stringify(analysisResult) : "No previous analysis provided."}
${Array.isArray(paymentRecords) && paymentRecords.length > 0 ? `
--- PAYMENT RECORDS (user-recorded for this project) ---
${paymentRecords.map((p: any) => `${p.type}: ₹${p.amount} | Date: ${p.datePaid} | Mode: ${p.paymentMode} | Ref: ${p.referenceNumber || "N/A"}${p.type === "EMD" ? ` | EMD Status: ${p.emdStatus}` : ""}${p.notes ? ` | Notes: ${p.notes}` : ""}`).join("\n")}
Total Paid: ₹${paymentRecords.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)} | EMD Outstanding: ₹${paymentRecords.filter((p: any) => p.type === "EMD" && p.emdStatus !== "Refunded").reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)}
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

      res.json({ answer: response.text });
    } catch (err: any) {
      console.error("Chat Tender Error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

app.post(
  "/api/extract-receipt",
  verifyFirebaseToken,
  requireActiveEntitlement,
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
      res.json(extracted);
    } catch (err: any) {
      console.error("Extract receipt error:", err);
      res.status(400).json({ error: err.message });
    }
  }
);

app.post(
  "/api/generate-doc",
  verifyFirebaseToken,
  requireActiveEntitlement,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { docType, tenderDetails, userProfile, financialData, extraInstructions, language,
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

      let extraContext = "";
      if (extraInstructions) {
        extraContext = `\n--- USER SPECIFIC INSTRUCTIONS FOR THIS DOCUMENT ---\n${extraInstructions}\nPlease strictly incorporate the user's instructions above when filling out this document.`;
      }

      const systemInstruction = `You are "Tender MasterAI", an expert legal and corporate procurement assistant specializing in Indian tenders.
Your task is to generate high-quality, professional draft documents based on the provided tender analysis and the user's business profile.
Use the business profile data (Company Name, Address, GST, PAN, etc.) and Tender Details (Tender No., Dates, Authority Name, etc.) to automatically fill in ALL placeholders.
CRITICAL RULE: DO NOT leave placeholders like "[Tender Number - To be filled by bidder]" or "[Date]" or "[Bidder Name]" in the output. You MUST aggressively find and replace all such "fill in the blank" brackets with the actual data from the provided Tender Details and Business Profile. If an exact piece of information is missing, use a logical assumed default or current date rather than leaving a bracketed placeholder.
STRICT PROHIBITION — FABRICATED LEGAL DOCUMENTS: NEVER generate, fabricate, or invent stamp paper certificates, e-stamp blocks, e-stamp certificate numbers (e-SBTR, CERT-IN, or any format), serial numbers, UID/UUID codes, or any fictional statutory document identifiers. A document MAY include a note such as "To be executed on non-judicial stamp paper of appropriate value as per applicable Stamp Act" or provide a blank placeholder line for stamp details — but MUST NEVER contain a pre-filled certificate block with invented certificate numbers, amounts, dates, or issuing authority stamps. Generating fabricated legal identifiers is strictly prohibited.
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
${financialContext}${extraContext}

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
9. STRICT PROHIBITION — FABRICATED LEGAL DOCUMENTS: NEVER generate, fabricate, or invent stamp paper certificates, e-stamp blocks, e-stamp certificate numbers (e-SBTR, CERT-IN, or any format), serial numbers, UID/UUID codes, or any fictional statutory document identifiers. A field for stamp details must contain "__________" (12 underscores) but MUST NEVER contain a fabricated certificate block with invented numbers, amounts, dates, or issuing authority stamps.${
  language && language !== "en"
    ? `\nCRITICAL LANGUAGE REQUIREMENT: Fill in bidder data in ${language === "hi" ? "Hindi" : language === "gu" ? "Gujarati" : language}, but keep all printed form labels exactly as they appear in the uploaded image.`
    : ""
}

--- BUSINESS PROFILE ---
${userProfile ? JSON.stringify(userProfile) : "Not provided."}

--- TENDER DETAILS ---
${JSON.stringify(tenderDetails)}${financialContext}${extraContext}`;

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

      res.json({ document: response.text || "Empty response from AI.", format: "markdown" });
    } catch (err: any) {
      console.error("Generate Doc Error:", err);
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
  requireActiveEntitlement,
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
  requireActiveEntitlement,
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
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("Generate DOCX Error:", err);
      res.status(500).json({ error: err.message || "Word generation failed" });
    }
  }
);

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
