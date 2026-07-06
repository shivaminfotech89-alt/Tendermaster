const fs = require('fs');

function patchFile(filename) {
  let code = fs.readFileSync(filename, 'utf-8');
  
  // Replace: const paymentLink = await response.json();
  // With: 
  /*
  let paymentLink;
  try {
    paymentLink = await response.json();
  } catch (e) {
    const text = await response.text();
    throw new Error(response.ok ? "Invalid response" : text.slice(0, 100));
  }
  */
  
  code = code.replace(
    /const paymentLink = await response\.json\(\);/g,
    `let paymentLink;
      try {
        paymentLink = await response.json();
      } catch (e) {
        throw new Error("A server error occurred or invalid response returned.");
      }`
  );
  
  fs.writeFileSync(filename, code, 'utf-8');
}

patchFile('src/pages/Settings.tsx');
patchFile('src/pages/LandingPage.tsx');

