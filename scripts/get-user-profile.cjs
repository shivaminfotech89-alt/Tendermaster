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
    const doc = await db.collection("users").doc("LTYdwnz0YcM7ZxMH5R1whMiwf113").get();
    if (doc.exists) {
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log("No user profile found.");
    }
    process.exit(0);
  } catch (err) {
    console.error("Error", err);
    process.exit(1);
  }
}

check();
