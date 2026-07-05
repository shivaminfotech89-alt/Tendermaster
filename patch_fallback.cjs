const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
    'if (options.model === "gemini-3.5-flash") {\\n             options.model = "gemini-3.5-flash";',
    'if (options.model === "gemini-3.5-flash") {\\n             options.model = "gemini-3.1-flash-lite";'
);
code = code.replace(
    'Falling back to gemini-3.5-flash due to quota/rate limit.',
    'Falling back to gemini-3.1-flash-lite due to quota/rate limit.'
);
fs.writeFileSync('server.ts', code, 'utf-8');
