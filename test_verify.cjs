const admin = require("firebase-admin");
const { getAuth } = require("firebase-admin/auth");
admin.initializeApp(); // No projectId!
getAuth().verifyIdToken("foo")
  .then(res => console.log("OK", res))
  .catch(e => console.log("Caught:", e.message));
