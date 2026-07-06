const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /import \{ createServer as createViteServer \} from "vite";\n/,
  ''
);

code = code.replace(
  /const vite = await createViteServer/g,
  'const { createServer: createViteServer } = await import("vite");\n    const vite = await createViteServer'
);

fs.writeFileSync('server.ts', code, 'utf-8');
