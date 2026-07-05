const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /console\.error\("Generate Doc Error:", err\);/g,
  'console.error("Generate Doc Error:", err); require("fs").writeFileSync("doc-error.txt", err.stack || err.toString());'
);

fs.writeFileSync('server.ts', content);
