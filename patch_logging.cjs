const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /const rzp = getRazorpay\(\);/,
  `console.log("Creating payment link with body:", req.body);
    const rzp = getRazorpay();`
);

fs.writeFileSync('server.ts', code, 'utf-8');
