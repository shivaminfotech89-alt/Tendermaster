const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
    '"margin_range": "8% to 15%",\\n    "risk_level": "Medium",',
    '"margin_range": "8% to 15%",\\n    "estimated_value": "₹10,50,000",\\n    "safe_range": "₹9,20,000 - ₹9,80,000",\\n    "risk_level": "Medium",'
);

fs.writeFileSync('server.ts', code, 'utf-8');
