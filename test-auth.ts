import "dotenv/config";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

let firebaseConfig: any = {};
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

async function run() {
  try {
    const user = await getAuth().getUserByEmail("shivaminfotech89@gmail.com");
    console.log("Success! User UID:", user.uid);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
