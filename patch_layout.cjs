const fs = require('fs');
let code = fs.readFileSync('src/pages/TenderAnalyzer.tsx', 'utf-8');

code = code.replace(
  /<div className="flex items-center gap-3 w-full md:w-auto">/g,
  '<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">'
);

fs.writeFileSync('src/pages/TenderAnalyzer.tsx', code, 'utf-8');

let code2 = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf-8');
code2 = code2.replace(
  /<div className="flex items-center gap-3 w-full md:w-auto">/g,
  '<div className="flex flex-wrap items-center gap-3 w-full md:w-auto">'
);
fs.writeFileSync('src/pages/ProjectDetails.tsx', code2, 'utf-8');

