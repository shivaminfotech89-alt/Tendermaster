import "dotenv/config";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firebaseConfig: any = {};
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Do not specify projectId, let ADC default to ais-asia-east1...
const firestoreApp = admin.initializeApp({}, "firestoreApp");
const db = getFirestore(firestoreApp, firebaseConfig.firestoreDatabaseId);

async function run() {
  try {
    const res = await db.collection("users").limit(1).get();
    console.log("Success! Docs:", res.docs.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
