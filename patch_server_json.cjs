const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const parseJsonFunc = `
function robustJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Failed standard JSON.parse, trying to clean markdown...", e.message);
    try {
      let cleaned = text.replace(/^\\\`\\\`\\\`json\\n?|\\\n?\\\`\\\`\\\`$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e2) {
      console.warn("Failed cleaned JSON.parse, trying relaxed parsing...", e2.message);
      throw new Error("AI returned malformed data. Try again. " + e2.message);
    }
  }
}
`;

if (!code.includes("robustJsonParse")) {
  code = code.replace(/const app = express\(\);/, parseJsonFunc + '\nconst app = express();');
  
  code = code.replace(/const parsedData = response\.text \? JSON\.parse\(response\.text\) : \{\};/g, 'const parsedData = robustJsonParse(response.text);');
  code = code.replace(/res\.json\(\{ comparison: JSON\.parse\(response\.text\) \}\);/g, 'res.json({ comparison: robustJsonParse(response.text) });');
  
  fs.writeFileSync('server.ts', code, 'utf-8');
}
