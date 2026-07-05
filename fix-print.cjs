const fs = require('fs');
const file = 'src/pages/ProjectDetails.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /let headerHtml = '';[\s\S]*?<\/html>\s*`\);/m;
const match = content.match(regex);

if (match) {
const replacement = `let headerHtml = '';
                             let footerHtml = '';
                             let bgImageHtml = '';
                             let bodyPadding = '0';
                             let pageMargin = '20mm'; // Standard A4 margin
                             
                             if (useLetterhead && businessProfile) {
                                if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                   // Keep standard margin, it's the most reliable way to avoid print bugs. 
                                   // The image will fit inside the printable area.
                                   pageMargin = '20mm';
                                   headerHtml = \`<div style="height: 35mm;"></div>\`;
                                   footerHtml = \`<div style="height: 25mm;"></div>\`;
                                } else {
                                   headerHtml = businessProfile.letterheadHeader || \`<div style="text-align:center; padding-bottom: 5mm; border-bottom: 2px solid #000; margin-bottom: 5mm;"><h2>\${businessProfile.companyName || 'Company Name'}</h2><p>\${businessProfile.contactDetails || ''}</p></div>\`;
                                   footerHtml = businessProfile.letterheadFooter || \`<div style="text-align:center; padding-top: 5mm; border-top: 1px solid #000; margin-top: 5mm; font-size: 12px;"><p>\${businessProfile.website || ''}</p></div>\`;
                                }
                             }
                             
                             printWindow.document.write(\`
                               <html>
                                 <head>
                                   <title>Print Document - \${docType}</title>
                                   <style>
                                     /* Standard A4 */
                                     @page { size: A4; margin: \${pageMargin}; }
                                     body { 
                                       font-family: system-ui, -apple-system, sans-serif; 
                                       color: #111827; 
                                       margin: 0;
                                       padding: 0;
                                       box-sizing: border-box;
                                     }
                                     .content { font-size: 11pt; line-height: 1.6; }
                                     
                                     /* Content tables inside the document */
                                     table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; page-break-inside: auto; }
                                     tr { page-break-inside: avoid; page-break-after: auto; }
                                     th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; word-wrap: break-word; }
                                     th { background-color: #f3f4f6; }
                                     
                                     h1, h2, h3, h4, h5 { margin-top: 15px; margin-bottom: 10px; page-break-after: avoid; }
                                     p { margin-bottom: 10px; }
                                     ul, ol { margin-bottom: 10px; padding-left: 20px; }
                                     
                                     /* Header & Footer classes */
                                     .print-header { position: fixed; top: 0; left: 0; right: 0; }
                                     .print-footer { position: fixed; bottom: 0; left: 0; right: 0; }
                                     
                                     @media print {
                                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                      }
                                   </style>
                                 </head>
                                 <body>
                                   \${bgImageHtml}
                                   
                                   <!-- Using layout table is buggy in WebKit when nested tables are used. 
                                        We will just use standard flow, and if a letterhead is used, 
                                        we can use fixed positioning for header and footer to repeat them, 
                                        and add margin to the body or top element. -->
                                   
                                   <div class="print-header">
                                     \${headerHtml}
                                   </div>
                                   
                                   <div class="content" style="margin-top: \${headerHtml ? (businessProfile?.letterheadBackgroundImage ? '35mm' : '25mm') : '0'}; margin-bottom: \${footerHtml ? (businessProfile?.letterheadBackgroundImage ? '25mm' : '15mm') : '0'};">
                                     \${content}
                                   </div>
                                   
                                   <div class="print-footer">
                                     \${footerHtml}
                                   </div>
                                 </body>
                               </html>
                             \`);`;
  fs.writeFileSync(file, content.replace(regex, replacement));
  console.log("Replacement successful!");
} else {
  console.log("Regex not found!");
}
