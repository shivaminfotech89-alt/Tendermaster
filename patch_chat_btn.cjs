const fs = require('fs');
let code = fs.readFileSync('src/components/Layout.tsx', 'utf-8');

code = code.replace(
  /className="fixed top-4 right-4 md:top-6 md:right-6/g,
  'className="fixed bottom-20 right-4 md:top-6 md:right-6 md:bottom-auto'
);

fs.writeFileSync('src/components/Layout.tsx', code, 'utf-8');
