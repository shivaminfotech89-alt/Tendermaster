const fs = require('fs');
const content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

const regex = /if \(useLetterhead && businessProfile\) \{[\s\S]*?<\/html>\s*`\);/m;
const match = content.match(regex);
if (match) {
  console.log("Found match block!");
} else {
  console.log("Could not find match block.");
}
