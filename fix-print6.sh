cat << 'INNER_EOF' > /tmp/replace-print6.js
const fs = require('fs');
let content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

content = content.replace(/bodyPadding = '0 60px'; \/\/ Extra padding for header and footer graphics/, "bodyPadding = '0 60px 40px 60px'; // Extra padding for header and footer graphics");
content = content.replace(/footerHtml = \`<div style="height: 180px;"><\\/div>\`;/, "footerHtml = \`<div style=\"height: 180px; margin-bottom: 40px;\"><\/div>\`;");

fs.writeFileSync('src/pages/ProjectDetails.tsx', content);
INNER_EOF
node /tmp/replace-print6.js
