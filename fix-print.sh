cat << 'INNER_EOF' > /tmp/replace-print.js
const fs = require('fs');
const content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

const oldHtml = `                                 <body>
                                   \${bgImageHtml}
                                   \${headerHtml}
                                   <div class="content">
                                     \${content}
                                   </div>
                                   \${footerHtml}
                                 </body>`;

const newHtml = `                                 <body>
                                   \${bgImageHtml}
                                   <table style="width: 100%; border: none;">
                                     <thead>
                                       <tr>
                                         <td style="border: none; padding: 0;">
                                           \${headerHtml}
                                         </td>
                                       </tr>
                                     </thead>
                                     <tbody>
                                       <tr>
                                         <td style="border: none; padding: 0;">
                                           <div class="content">
                                             \${content}
                                           </div>
                                         </td>
                                       </tr>
                                     </tbody>
                                     <tfoot>
                                       <tr>
                                         <td style="border: none; padding: 0;">
                                           \${footerHtml}
                                         </td>
                                       </tr>
                                     </tfoot>
                                   </table>
                                 </body>`;

fs.writeFileSync('src/pages/ProjectDetails.tsx', content.replace(oldHtml, newHtml));
INNER_EOF
node /tmp/replace-print.js
