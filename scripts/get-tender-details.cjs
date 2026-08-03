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
    const snap = await db.collection("saved_tenders").where("userId", "==", "LTYdwnz0YcM7ZxMH5R1whMiwf113").limit(1).get();
    snap.forEach((doc) => {
      console.log(`Document ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2).slice(0, 1000));
    });
    process.exit(0);
  } catch (err) {
    console.error("Error", err);
    process.exit(1);
  }
}

check();
