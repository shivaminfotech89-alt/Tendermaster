// READ-ONLY dry run. No writes. Deleted after use.
const admin = require("firebase-admin");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
admin.initializeApp({
  projectId: config.projectId,
  credential: fs.existsSync("serviceAccountKey.json")
    ? admin.credential.cert(JSON.parse(fs.readFileSync("serviceAccountKey.json", "utf-8")))
    : admin.credential.applicationDefault(),
});
const db = admin.firestore();
db.settings({ databaseId: config.firestoreDatabaseId });

const TARGET_EMAILS = ["d804nilesh@gmail.com", "avnishmishra1211@gmail.com"];

async function main() {
  const usersSnap = await db.collection("users").get();
  for (const email of TARGET_EMAILS) {
    const match = usersSnap.docs.find(d => d.data().email === email);
    if (!match) {
      console.log(`${email}: NOT FOUND`);
      continue;
    }
    const data = match.data();
    console.log(`${email}`);
    console.log(`  uid: ${match.id}`);
    console.log(`  role (current): ${data.role}`);
    console.log(`  creditsTotal: ${data.creditsTotal}`);
    console.log(`  creditsUsed: ${data.creditsUsed}`);
    console.log(`  trialClaimed: ${data.trialClaimed}`);
    console.log(`  creditsExpiry: ${data.creditsExpiry ? data.creditsExpiry.toDate().toISOString() : "(none)"}`);
    console.log("");
  }
}
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
