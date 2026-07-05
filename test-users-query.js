import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query } from "firebase/firestore";
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

async function test() {
  try {
    await signInWithEmailAndPassword(auth, "shivaminfotech89@gmail.com", "Test1234");
    const snap = await getDocs(query(collection(db, "users")));
    console.log("Docs found:", snap.docs.length);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
