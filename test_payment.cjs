const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run() {
  const res = await fetch("http://127.0.0.1:3000/api/create-payment-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: 10000,
      description: "Test",
      customer: {
        email: "test@example.com",
        name: "Test User"
      },
      callback_url: "https://example.com"
    })
  });
  
  console.log("STATUS:", res.status);
  const text = await res.text();
  console.log("BODY:", text);
}
run();
