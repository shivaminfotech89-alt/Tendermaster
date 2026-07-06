const { getAuth } = require('firebase-admin/auth');

async function test() {
  try {
    console.log("Before");
    const t = await getAuth().verifyIdToken("foo");
    console.log("After");
  } catch(e) {
    console.log("Caught:", e.message);
  }
}
test();
