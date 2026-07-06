const fs = require('fs');
let code = fs.readFileSync('src/pages/Settings.tsx', 'utf-8');

code = code.replace(
  /throw new Error\("A server error occurred or invalid response returned\."\);/,
  `throw new Error("A server error occurred: " + e.message);`
);

fs.writeFileSync('src/pages/Settings.tsx', code, 'utf-8');
