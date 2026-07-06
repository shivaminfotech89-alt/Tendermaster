const fs = require('fs');
let code = fs.readFileSync('src/pages/Settings.tsx', 'utf-8');

if (!code.includes('useLocation')) {
  code = code.replace(
    /import React, \{ useState, useEffect \} from 'react';/,
    "import React, { useState, useEffect } from 'react';\nimport { useLocation } from 'react-router-dom';"
  );
}

code = code.replace(
  /const \[activeTab, setActiveTab\] = useState\(\(\) => \{[\s\S]*?\}\);/,
  `const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("tab") || "account";
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [location.search]);`
);

fs.writeFileSync('src/pages/Settings.tsx', code, 'utf-8');
