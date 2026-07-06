const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  /let cleaned = text\.replace\(\/\^\\`\\`\\`json\\n\?\\|\\\?\\`\\`\\`\$\/g, ''\)\.trim\(\);/,
  "let cleaned = text.replace(/^```json\\\\n?|\\\\n?```$/g, '').trim();"
);

// If the regex replacement didn't work because of escaping, let's just rewrite the whole function.
const parseJsonFunc = `
function robustJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Failed standard JSON.parse, trying to clean markdown...", e.message);
    try {
      let cleaned = text.replace(/^[\s\S]*?\`\`\`json/i, '').replace(/\`\`\`[\s\S]*?$/, '').trim();
      return JSON.parse(cleaned);
    } catch (e2) {
      console.warn("Failed cleaned JSON.parse, trying relaxed parsing...", e2.message);
      throw new Error("AI returned malformed data. Try again. " + e2.message);
    }
  }
}
`;

code = code.replace(/function robustJsonParse[\s\S]*?const app = express\(\);/, parseJsonFunc + '\nconst app = express();');

fs.writeFileSync('server.ts', code, 'utf-8');
