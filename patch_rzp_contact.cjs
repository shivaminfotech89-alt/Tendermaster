const fs = require('fs');
let settings = fs.readFileSync('src/pages/Settings.tsx', 'utf-8');
settings = settings.replace(
  /contact: "9999999999" \/\/ Fallback contact/g,
  `name: user.displayName || "User"`
);
fs.writeFileSync('src/pages/Settings.tsx', settings, 'utf-8');

let landing = fs.readFileSync('src/pages/LandingPage.tsx', 'utf-8');
landing = landing.replace(
  /contact: "9999999999"/g,
  `name: user?.displayName || "User"`
);
fs.writeFileSync('src/pages/LandingPage.tsx', landing, 'utf-8');
