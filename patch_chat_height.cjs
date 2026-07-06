const fs = require('fs');
let code = fs.readFileSync('src/pages/TenderChat.tsx', 'utf-8');

code = code.replace(
  /className="h-\[calc\(100vh-64px\)\] flex flex-col bg-slate-50 relative"/g,
  'className="h-full min-h-[calc(100vh-160px)] md:min-h-[calc(100vh-64px)] flex flex-col bg-slate-50 relative"'
);

fs.writeFileSync('src/pages/TenderChat.tsx', code, 'utf-8');
