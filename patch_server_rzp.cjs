const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /res\.status\(500\)\.json\(\{ error: error\.message \|\| "Failed to create payment link" \}\);/g,
  'res.status(500).json({ error: error?.error?.description || error?.message || "Failed to create payment link" });'
);

fs.writeFileSync('server.ts', code, 'utf-8');
