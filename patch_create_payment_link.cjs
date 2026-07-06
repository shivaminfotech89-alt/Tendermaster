const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /res\.status\(error\?\.statusCode \|\| 400\)\.json\(\{ error: error\?\.error\?\.description \|\| error\?\.message \|\| "Failed to create payment link" \}\);/,
  `const status = Number(error?.statusCode) || 400;
    res.status(status >= 100 && status < 600 ? status : 400).json({ error: error?.error?.description || error?.message || "Failed to create payment link" });`
);

fs.writeFileSync('server.ts', code, 'utf-8');
