const admin = require("firebase-admin");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
admin.initializeApp({
  projectId: config.projectId,
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
// Use the exact database ID from config
db.settings({ databaseId: config.firestoreDatabaseId });

async function seed() {
  try {
    await db.collection("system_settings").doc("payments").set({
      upi_id: "7990878248@ybl",
      whatsapp_number: "7990878248",
      updatedAt: new Date()
    }, { merge: true });
    
    await db.collection("system_settings").doc("plans").set({
      premiumPrice: "999",
      premiumFeatures: "Unlimited Tender Analysis\nAutomated Document Generation\nDedicated Tender Chat AI\nPDF Exports & Competitor Analysis",
      updatedAt: new Date()
    }, { merge: true });
    
    console.log("Seeding complete via Admin SDK.");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding", err);
    process.exit(1);
  }
}
seed();
