const fs = require('fs');

function patch(file) {
  let code = fs.readFileSync(file, 'utf-8');
  
  // Replace: const errData = await res.json();
  code = code.replace(/const errData = await res\.json\(\);/g, `
        let errData;
        try { errData = await res.json(); } catch(e) { errData = { error: "A server error occurred." }; }
  `);
  
  // Replace: const data = await res.json();
  code = code.replace(/const data = await res\.json\(\);/g, `
        let data;
        try { data = await res.json(); } catch(e) { throw new Error("A server error occurred. Please try again."); }
  `);
  
  // Replace: const data = await response.json();
  code = code.replace(/const data = await response\.json\(\);/g, `
        let data;
        try { data = await response.json(); } catch(e) { throw new Error("A server error occurred. Please try again."); }
  `);

  fs.writeFileSync(file, code, 'utf-8');
}

patch('src/pages/Settings.tsx');
patch('src/pages/BusinessProfile.tsx');
patch('src/components/ProfileParsing.tsx');
patch('src/components/QATender.tsx');
patch('src/components/TenderAnalysis.tsx');
patch('src/pages/TenderChat.tsx');

