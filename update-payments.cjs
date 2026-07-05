const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const setClaimsHelper = `// Phase 1: Custom Claims Helper
const setEntitlementClaims = async (uid: string, claims: { role: string; subscriptionExpiry?: string }) => {
  try {
    await getAuth().setCustomUserClaims(uid, claims);
    return true;
  } catch (error) {
    console.error(\`Failed to set custom claims for user \${uid}:\`, error);
    return false;
  }
};`;

content = content.replace('// Phase 1: Firebase Auth ID Token Verification Middleware', setClaimsHelper + '\n\n// Phase 1: Firebase Auth ID Token Verification Middleware');

// Update verify-payment
const verifyPaymentTarget = `    if (isVerified) {
        let days = 30; // default fallback
        const parsedAmount = Number(amount);
        // amount can be in paise (e.g. 99900) or rupees (e.g. 999) depending on link setup
        if (parsedAmount === 999 || parsedAmount === 99900) days = 90; // 3 months
        if (parsedAmount === 1999 || parsedAmount === 199900) days = 365; // 1 year

        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + days);
        
        return res.json({ 
          success: true, 
          message: "Payment verified successfully. Account upgraded to Premium.",
          days,
          newExpiry: newExpiry.toISOString(),
          paymentId: razorpay_payment_id
        });
    } else {`;

const verifyPaymentReplacement = `    if (isVerified) {
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
    } else {`;

content = content.replace(verifyPaymentTarget, verifyPaymentReplacement);

// Update activate-code
const activateCodeTarget = `    // Support hardcoded test code TENDERMASTERPRO
    if (code.trim().toUpperCase() === "TENDERMASTERPRO") {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      
      return res.json({ 
        success: true, 
        message: "Premium activated for 30 days! Please refresh.",
        newExpiry: expiry.toISOString()
      });
    }
    
    // Cannot securely verify other codes without Admin SDK access to Firestore
    return res.status(400).json({ error: "Invalid activation code" });`;

const activateCodeReplacement = `    // Phase 3: Validate code against environment variables (secure server-side list)
    const validCodesRaw = process.env.VALID_ACTIVATION_CODES || "";
    const validCodes = validCodesRaw.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
    
    if (validCodes.includes(code.trim().toUpperCase())) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      
      const claimsSet = await setEntitlementClaims(uid, { role: "premium", subscriptionExpiry: expiry.toISOString() });
      if (!claimsSet) {
         return res.status(500).json({ success: false, error: "Failed to upgrade account privileges server-side." });
      }
      
      return res.json({ 
        success: true, 
        message: "Premium activated for 30 days! Please refresh.",
        newExpiry: expiry.toISOString()
      });
    }
    
    return res.status(400).json({ error: "Invalid activation code" });`;

content = content.replace(activateCodeTarget, activateCodeReplacement);

// Update razorpay-webhook
const webhookTarget = `    if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
       const email = event.payload?.payment?.entity?.email;
       const amount = event.payload?.payment?.entity?.amount; // in paise
       
       if (email) {
          console.log(\`[Webhook Verified] Webhook received for \${email} but server-side Firestore Admin SDK is disabled in this environment. Relying on frontend /api/verify-payment sync.\`);
       }
    }`;

const webhookReplacement = `    if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
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
              console.log(\`[Webhook Verified] Upgraded \${email} to premium via custom claims.\`);
            }
          } catch (e) {
            console.error(\`[Webhook Error] Failed to resolve or upgrade user by email \${email}:\`, e);
          }
       }
    }`;

content = content.replace(webhookTarget, webhookReplacement);

// Add /api/admin/set-role endpoint
const adminEndpoint = `// Phase 4: Admin role management
app.post("/api/admin/set-role", verifyFirebaseToken, requireActiveEntitlement, async (req: AuthenticatedRequest, res) => {
  try {
    const { targetUid, role, subscriptionExpiry } = req.body;
    
    if (!targetUid || !role) {
      return res.status(400).json({ error: "targetUid and role are required" });
    }

    const callerRole = req.user?.decodedToken?.role;
    if (callerRole !== "superadmin") {
      return res.status(403).json({ error: "Only superadmins can manage user roles." });
    }

    const claims: any = { role };
    if (role === "premium" && subscriptionExpiry) {
      claims.subscriptionExpiry = subscriptionExpiry;
    }

    const success = await setEntitlementClaims(targetUid, claims);
    if (!success) {
      return res.status(500).json({ error: "Failed to set user claims" });
    }

    return res.json({ success: true, message: \`User \${targetUid} role set to \${role}\` });
  } catch (error: any) {
    console.error("Set role error:", error);
    res.status(500).json({ error: error.message || "Failed to set role" });
  }
});
`;

content = content.replace('// Phase 5: SSRF protection helper', adminEndpoint + '\n// Phase 5: SSRF protection helper');

fs.writeFileSync('server.ts', content);
