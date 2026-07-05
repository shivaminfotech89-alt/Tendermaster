const admin = require("firebase-admin");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
admin.initializeApp({ projectId: config.projectId });
async function run() {
  try {
    const list = await admin.auth().listUsers();
    console.log(list.users.length);
    const uid = list.users[0].uid;
    await admin.auth().setCustomUserClaims(uid, { role: "admin" });
    console.log("Success");
  } catch (e) {
    console.error(e);
  }
}
run();
