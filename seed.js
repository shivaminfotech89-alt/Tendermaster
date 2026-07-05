import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  projectId: "tendermaster-ai",
  appId: "1:948388661079:web:aab521874d403fdb296012",
  apiKey: "AIzaSyDM3T2L7OKgUNDTk2P-g1XCuJxIGpZQEjQ",
  authDomain: "tendermaster-ai.firebaseapp.com",
  storageBucket: "tendermaster-ai.firebasestorage.app",
  messagingSenderId: "948388661079"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "ai-studio-tender2-c4e31b45-0537-4d35-9963-ee2ad83145d3");

async function seed() {
  try {
    await setDoc(doc(db, "system_settings", "payments"), {
      upi_id: "7990878248@ybl",
      whatsapp_number: "7990878248",
      updatedAt: new Date()
    }, { merge: true });
    
    await setDoc(doc(db, "system_settings", "plans"), {
      premiumPrice: "999",
      premiumFeatures: "Unlimited Tender Analysis\nAutomated Document Generation\nDedicated Tender Chat AI\nPDF Exports & Competitor Analysis",
      updatedAt: new Date()
    }, { merge: true });
    
    console.log("Seeding complete.");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding", err);
    process.exit(1);
  }
}

seed();
