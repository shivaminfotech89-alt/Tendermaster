const Razorpay = require('razorpay');
require('dotenv').config();
const rzp = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

async function run() {
  try {
    const paymentLink = await rzp.paymentLink.create({
      amount: 10000,
      currency: "INR",
      description: "Test",
      customer: {
        email: "test@example.com",
        name: "Test User"
      },
      callback_url: "https://example.com",
      callback_method: "get"
    });
    console.log("Success", paymentLink.id);
  } catch (err) {
    console.error("Error", err);
  }
}
run();
