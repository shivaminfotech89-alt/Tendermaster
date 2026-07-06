const admin = require("firebase-admin");
try {
  admin.initializeApp({ projectId: undefined });
  console.log("Init OK");
} catch(e) {
  console.log("Init Error:", e);
}
