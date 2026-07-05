import admin from "firebase-admin";
import fs from "fs";
import { getAuth } from "firebase-admin/auth";
const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
admin.initializeApp({ projectId: config.projectId });
async function run() {
  try {
    const list = await getAuth().listUsers();
    console.log(list.users.length);
    const uid = list.users[0].uid;
    await getAuth().setCustomUserClaims(uid, { role: "admin" });
    console.log("Success");
  } catch (e) {
    console.error(e);
  }
}
run();
