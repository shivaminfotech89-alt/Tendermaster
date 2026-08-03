const admin = require("firebase-admin");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));

if (fs.existsSync("serviceAccountKey.json")) {
  admin.initializeApp({
    projectId: config.projectId,
    credential: admin.credential.cert(JSON.parse(fs.readFileSync("serviceAccountKey.json", "utf-8")))
  });
} else {
  admin.initializeApp({
    projectId: config.projectId,
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();
db.settings({ databaseId: config.firestoreDatabaseId });

async function check() {
  try {
    const snap = await db.collection("saved_tenders").limit(10).get();
    console.log(`Found ${snap.size} saved tenders.`);
    snap.forEach((doc) => {
      console.log(`Document ID: ${doc.id}`);
      console.log(`  User ID: ${doc.data().userId}`);
      console.log(`  Title: ${doc.data().title || doc.data().details?.tender_info?.authority_name}`);
    });
    process.exit(0);
  } catch (err) {
    console.error("Error connecting or reading", err);
    process.exit(1);
  }
}

check();
