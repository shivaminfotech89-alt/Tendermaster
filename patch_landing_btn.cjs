const fs = require('fs');
let code = fs.readFileSync('src/pages/LandingPage.tsx', 'utf-8');

code = code.replace(
  /if \(!user\) \{\n\s*navigate\('\/login'\);\n\s*return;\n\s*\}/,
  `if (!user) {
      toast("Please create an account first to subscribe.");
      navigate('/login');
      return;
    }`
);

fs.writeFileSync('src/pages/LandingPage.tsx', code, 'utf-8');
