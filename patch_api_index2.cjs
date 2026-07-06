const fs = require('fs');
fs.writeFileSync('api/index.ts', "import app from '../server.ts';\nexport default app;\n");
