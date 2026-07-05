cat << 'INNER_EOF' > /tmp/replace-server.js
const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const oldFallback = `         // Fallback to older model if quota is hit to avoid completely blocking the user
         if (options.model === "gemini-2.5-flash") {
             options.model = "gemini-1.5-flash";
             modelChanged = true;
             console.warn(\`[AI Engine] Falling back to gemini-1.5-flash due to quota/rate limit.\`);
         } else if (options.model === "gemini-1.5-flash") {
             options.model = "gemini-1.5-flash-8b";
             modelChanged = true;
             console.warn(\`[AI Engine] Falling back to gemini-1.5-flash-8b due to quota/rate limit.\`);
         } else if (options.model === "gemini-1.5-flash-8b") {
             options.model = "gemini-1.0-pro";
             modelChanged = true;
             console.warn(\`[AI Engine] Falling back to gemini-1.0-pro due to quota/rate limit.\`);
         } else {
             // Exhausted fallbacks, if it's still a quota error, just throw to avoid looping 8 times
             if (isQuotaError) throw err;
         }`;

const newFallback = `         if (isQuotaError) throw err;`;

fs.writeFileSync('server.ts', content.replace(oldFallback, newFallback));
INNER_EOF
node /tmp/replace-server.js
