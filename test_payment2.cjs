const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
async function run() {
  const res = await fetch("http://127.0.0.1:3000/api/create-payment-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 100 })
  });
  console.log("STATUS:", res.status);
  console.log("BODY:", await res.text());
}
run();
