cat << 'INNER_EOF' > /tmp/replace-print2.js
const fs = require('fs');
const content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

const oldCode = `                                if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                   bodyPadding = '140px 60px 100px 60px'; // Extra padding for header and footer graphics
                                } else {`;

const newCode = `                                if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                   bodyPadding = '0 60px'; // Extra padding for header and footer graphics
                                   headerHtml = \`<div style="height: 140px;"></div>\`;
                                   footerHtml = \`<div style="height: 100px;"></div>\`;
                                } else {`;

fs.writeFileSync('src/pages/ProjectDetails.tsx', content.replace(oldCode, newCode));
INNER_EOF
node /tmp/replace-print2.js
