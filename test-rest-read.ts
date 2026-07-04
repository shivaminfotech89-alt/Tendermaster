import "dotenv/config";
import fs from "fs";
import path from "path";

let firebaseConfig: any = {};
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

console.log("REST read would work if we have the ID token!");
