const fs = require('fs');
let code = fs.readFileSync('src/pages/Settings.tsx', 'utf-8');

code = code.replace(
  /const \[activeTab, setActiveTab\] = useState\("account"\);/,
  `const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "account";
  });`
);

fs.writeFileSync('src/pages/Settings.tsx', code, 'utf-8');
