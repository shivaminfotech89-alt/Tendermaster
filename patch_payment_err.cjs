const fs = require('fs');

function patch(filename) {
  let code = fs.readFileSync(filename, 'utf-8');
  code = code.replace(
    /let paymentLink;\s*try \{\s*paymentLink = await response\.json\(\);\s*\} catch \(e\) \{\s*throw new Error\("A server error occurred or invalid response returned\."\);\s*\}/g,
    `let paymentLink;
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        console.log("Raw payment response:", text);
        try {
          paymentLink = JSON.parse(text);
        } catch(e2) {
          throw new Error("Server returned invalid JSON: " + text.substring(0, 50));
        }
      } catch (e) {
        throw e;
      }`
  );
  fs.writeFileSync(filename, code, 'utf-8');
}

patch('src/pages/Settings.tsx');
patch('src/pages/LandingPage.tsx');
