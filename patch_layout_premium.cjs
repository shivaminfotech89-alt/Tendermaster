const fs = require('fs');
let code = fs.readFileSync('src/components/Layout.tsx', 'utf-8');

code = code.replace(/role !== "PREMIUM"/g, 'role !== "premium"');

fs.writeFileSync('src/components/Layout.tsx', code, 'utf-8');
