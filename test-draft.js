import fetch from "node-fetch";

// We need a firebase ID token for the test user
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
const app = initializeApp(config);
const auth = getAuth(app);

async function run() {
  try {
    const cred = await signInWithEmailAndPassword(auth, "shivaminfotech89@gmail.com", "Test1234");
    const idToken = await cred.user.getIdToken();

    const res = await fetch("http://localhost:3000/api/generate-doc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        docType: "Covering Letter",
        tenderDetails: { title: "Test Tender" },
        userProfile: { name: "Test Co" }
      })
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
  } catch (err) {
    console.error(err);
  }
}
run();
