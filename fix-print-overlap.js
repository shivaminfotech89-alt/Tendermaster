const fs = require('fs');
let content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

content = content.replace(
  /<div class="content" style="padding-bottom: 40px;">/,
  '<div class="content" style="padding-bottom: 80px; margin-bottom: 40px;">'
);

content = content.replace(
  /footerHtml = \`<div style="height: 200px;"><\\/div>\`;/,
  'footerHtml = \`<div style="height: 200px; padding-top: 40px;"><\\/div>\`;'
);

fs.writeFileSync('src/pages/ProjectDetails.tsx', content);
