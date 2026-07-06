const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(/res\.status\(500\)/g, 'res.status(400)');
fs.writeFileSync('server.ts', code, 'utf-8');
