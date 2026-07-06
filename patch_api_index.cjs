const fs = require('fs');
fs.writeFileSync('api/index.ts', "import app from '../server.js';\nexport default app;\n");
