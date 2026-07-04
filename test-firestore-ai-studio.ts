import "dotenv/config";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firebaseConfig: any = {};
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Initialize with the AI Studio project (using ADC)
admin.initializeApp({
  projectId: "ais-asia-east1-10efd97a214441d",
});

const db = getFirestore(getApp(), firebaseConfig.firestoreDatabaseId);

async function run() {
  try {
    const res = await db.collection("users").limit(1).get();
    console.log("Success! Docs:", res.docs.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
