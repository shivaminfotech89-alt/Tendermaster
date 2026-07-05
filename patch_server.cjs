const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
    'required: ["conservative", "recommended", "aggressive", "margin_range", "risk_level", "rationale"]',
    'required: ["estimated_value", "conservative", "safe_range", "recommended", "aggressive", "margin_range", "risk_level", "rationale"]'
);

code = code.replace(
    '"margin_range": "8% to 15%",\\n    "estimated_value": "₹10,50,000",\\n    "safe_range": "₹9,20,000 - ₹9,80,000",\\n    "risk_level": "Medium",',
    '"estimated_value": "₹10,50,000",\\n    "safe_range": "₹9,20,000 - ₹9,80,000",\\n    "margin_range": "8% to 15%",\\n    "risk_level": "Medium",'
);

// Add instruction for profit margin to calculate bid value
code = code.replace(
    'Analyze the tender financial requirements and project estimates.',
    'Analyze the tender financial requirements and project estimates. Clearly state the expected profit margin range used to calculate the recommended bid values (e.g. 10%-15% margin on top of expenses). Ensure you output the estimated_value and safe_range.'
);

fs.writeFileSync('server.ts', code, 'utf-8');
