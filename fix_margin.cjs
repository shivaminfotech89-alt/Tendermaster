const fs = require('fs');
let code = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf-8');

// Fix 4 column grid
code = code.replace(
    '<div className="grid grid-cols-1 md:grid-cols-3 gap-4">',
    '<div className="grid grid-cols-1 md:grid-cols-4 gap-4">'
);
fs.writeFileSync('src/pages/ProjectDetails.tsx', code, 'utf-8');
