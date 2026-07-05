import fetch from "node-fetch";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
const projectId = config.projectId;

async function run() {
  const token = process.argv[2];
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/test-uid`;
  console.log("Fetching URL:", url);
  
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Data:", JSON.stringify(data));
}
run();
