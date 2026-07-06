const fs = require('fs');
let code = fs.readFileSync('src/pages/LandingPage.tsx', 'utf-8');

code = code.replace(/const navigate = useNavigate\(\);\\n  const handleRazorpayClick = \(\) => {\\n    if \(user\) {\\n      navigate\('\/dashboard\/settings'\);\\n    } else {\\n      navigate\('\/login'\);\\n    }\\n  };/, 
  "const navigate = useNavigate();\n  const handleRazorpayClick = () => {\n    if (user) {\n      navigate('/dashboard/settings');\n    } else {\n      navigate('/login');\n    }\n  };"
);

fs.writeFileSync('src/pages/LandingPage.tsx', code, 'utf-8');
