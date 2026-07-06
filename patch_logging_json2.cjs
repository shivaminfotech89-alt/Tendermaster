const fs = require('fs');
let code = fs.readFileSync('src/pages/Settings.tsx', 'utf-8');

code = code.replace(
  /let paymentLink;[\s\S]*?throw new Error\("A server error occurred: " \+ e\.message\);[\s\S]*?\}/,
  `let paymentLink;
      try {
        const text = await response.text();
        try {
          paymentLink = JSON.parse(text);
        } catch (e) {
          throw new Error("Invalid response JSON. Body: " + text.substring(0, 100));
        }
      } catch (e) {
        throw e;
      }`
);

fs.writeFileSync('src/pages/Settings.tsx', code, 'utf-8');
