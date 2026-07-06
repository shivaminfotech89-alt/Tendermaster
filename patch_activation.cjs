const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
    /if \(code\.trim\(\)\.toUpperCase\(\) === "TENDERMASTERPRO"\) {/,
    `const validCodesEnv = (process.env.VALID_ACTIVATION_CODES || "TENDERMASTERPRO").split(",").map(c => c.trim().toUpperCase());\n    if (validCodesEnv.includes(code.trim().toUpperCase())) {`
);

fs.writeFileSync('server.ts', code, 'utf-8');
