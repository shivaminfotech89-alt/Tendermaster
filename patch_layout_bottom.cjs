const fs = require('fs');
let code = fs.readFileSync('src/components/Layout.tsx', 'utf-8');

code = code.replace(/pb-safe/g, 'pb-[env(safe-area-inset-bottom)]');
code = code.replace(/pb-16 md:pb-0/g, 'pb-24 md:pb-0'); // add more bottom padding on mobile for main content

fs.writeFileSync('src/components/Layout.tsx', code, 'utf-8');
