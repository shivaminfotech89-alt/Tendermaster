const fs = require('fs');
let code = fs.readFileSync('src/pages/Reports.tsx', 'utf-8');

code = code.replace(/b\.savedAt/g, '(b as any).savedAt');
code = code.replace(/a\.savedAt/g, '(a as any).savedAt');

fs.writeFileSync('src/pages/Reports.tsx', code, 'utf-8');
