import "dotenv/config";
import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, limit, query } from "firebase/firestore";

let firebaseConfig: any = {};
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  try {
    const q = query(collection(db, "users"), limit(1));
    const snapshot = await getDocs(q);
    console.log("Success! Docs:", snapshot.docs.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
