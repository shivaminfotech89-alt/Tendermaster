cat << 'INNER_EOF' > /tmp/replace-fallback.js
const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

const oldCode = \`      if (isQuotaError || (isRetryable && i > 1)) {
         isRetryable = true;
         
         if (isQuotaError) throw err;\`;

const newCode = \`      if (isQuotaError || (isRetryable && i > 1)) {
         isRetryable = true;
         
         // Fallback to older model if quota is hit to avoid completely blocking the user
         if (options.model === "gemini-2.5-flash") {
             options.model = "gemini-2.0-flash";
             modelChanged = true;
             console.warn(\\\`[AI Engine] Falling back to gemini-2.0-flash due to quota/rate limit.\\\`);
         } else if (options.model === "gemini-2.0-flash") {
             options.model = "gemini-2.5-pro";
             modelChanged = true;
             console.warn(\\\`[AI Engine] Falling back to gemini-2.5-pro due to quota/rate limit.\\\`);
         } else {
             // Exhausted fallbacks, if it's still a quota error, just throw
             if (isQuotaError) throw err;
         }\`;

fs.writeFileSync('server.ts', content.replace(oldCode, newCode));
INNER_EOF
node /tmp/replace-fallback.js
