const fs = require('fs');

const file = 'src/pages/ProjectDetails.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = `                             let headerHtml = '';
                             let footerHtml = '';
                             let bgImageHtml = '';
                             let bodyPadding = '40px';
                             
                             if (useLetterhead && businessProfile) {
                                if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                   bodyPadding = '0 60px 40px 60px'; // Extra padding for header and footer graphics
                                   headerHtml = \`<div style="height: 220px; margin-top: 40px;"></div>\`;
                                   footerHtml = \`<div style="height: 220px; margin-top: 40px;"></div>\`;
                                } else {
                                   headerHtml = businessProfile.letterheadHeader || \`<div style="text-align:center; padding-bottom: 20px; border-bottom: 2px solid #000; margin-bottom: 20px;"><h2>\${businessProfile.companyName || 'Company Name'}</h2><p>\${businessProfile.contactDetails || ''}</p></div>\`;
                                   footerHtml = businessProfile.letterheadFooter || \`<div style="text-align:center; padding-top: 20px; border-top: 1px solid #000; margin-top: 20px; font-size: 12px;"><p>\${businessProfile.website || ''}</p></div>\`;
                                }
                             }
                             
                             printWindow.document.write(\`
                               <html>
                                 <head>
                                   <title>Print Document - \${docType}</title>
                                   <style>
                                     body { font-family: system-ui, -apple-system, sans-serif; padding: \${bodyPadding}; color: #111827; max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; display: flex; flex-direction: column; min-height: 100vh; margin: 0; }
                                     .content { flex: 1; position: relative; z-index: 1; }
                                     table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; page-break-inside: auto; }
                                     tr { page-break-inside: avoid; page-break-after: auto; }
                                     th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; word-wrap: break-word; }
                                     th { background-color: #f3f4f6; }
                                     h1, h2, h3, h4, h5 { margin-top: 20px; margin-bottom: 10px; page-break-after: avoid; }
                                     p { margin-bottom: 10px; line-height: 1.5; }
                                     ul, ol { margin-bottom: 10px; padding-left: 20px; }
                                     @page { size: auto; margin: 0mm; }
                                     @media print {
                                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: \${bodyPadding} !important; }
                                      }
                                   </style>
                                 </head>
                                 <body>
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
                                           <div class="content" style="padding-bottom: 120px; margin-bottom: 60px;">
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
                                 </body>
                               </html>
                             \`);`;

const replacement = `                             let headerHtml = '';
                             let footerHtml = '';
                             let bgImageHtml = '';
                             let bodyPadding = '0';
                             let pageMargin = '20mm'; // Standard A4 margin
                             
                             if (useLetterhead && businessProfile) {
                                if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                   bodyPadding = '0 20mm'; // Emulate side margins because @page margin must be 0 for full-bleed image
                                   pageMargin = '0'; // Full bleed for background image
                                   // A4 height is 297mm. Letterhead top is often ~45mm. Bottom ~30mm.
                                   headerHtml = \`<div style="height: 45mm;"></div>\`;
                                   footerHtml = \`<div style="height: 30mm;"></div>\`;
                                } else {
                                   headerHtml = businessProfile.letterheadHeader || \`<div style="text-align:center; padding-bottom: 5mm; border-bottom: 2px solid #000; margin-bottom: 10mm;"><h2>\${businessProfile.companyName || 'Company Name'}</h2><p>\${businessProfile.contactDetails || ''}</p></div>\`;
                                   footerHtml = businessProfile.letterheadFooter || \`<div style="text-align:center; padding-top: 5mm; border-top: 1px solid #000; margin-top: 10mm; font-size: 12px;"><p>\${businessProfile.website || ''}</p></div>\`;
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
                                       padding: \${bodyPadding}; 
                                       color: #111827; 
                                       max-width: 100%; 
                                       overflow-wrap: break-word; 
                                       word-wrap: break-word; 
                                       margin: 0;
                                       box-sizing: border-box;
                                     }
                                     .content { position: relative; z-index: 1; font-size: 11pt; line-height: 1.6; }
                                     
                                     /* Layout tables (header/footer) */
                                     table.layout-table { width: 100%; border-collapse: collapse; border: none; margin: 0; padding: 0; }
                                     table.layout-table > thead > tr > td, 
                                     table.layout-table > tbody > tr > td, 
                                     table.layout-table > tfoot > tr > td { border: none; padding: 0; }
                                     
                                     /* Content tables inside the document */
                                     table:not(.layout-table) { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; page-break-inside: auto; }
                                     table:not(.layout-table) tr { page-break-inside: avoid; page-break-after: auto; }
                                     table:not(.layout-table) th, table:not(.layout-table) td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; word-wrap: break-word; }
                                     table:not(.layout-table) th { background-color: #f3f4f6; }
                                     
                                     h1, h2, h3, h4, h5 { margin-top: 15px; margin-bottom: 10px; page-break-after: avoid; }
                                     p { margin-bottom: 10px; }
                                     ul, ol { margin-bottom: 10px; padding-left: 20px; }
                                     
                                     @media print {
                                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: \${bodyPadding} !important; }
                                      }
                                   </style>
                                 </head>
                                 <body>
                                   \${bgImageHtml}
                                   <table class="layout-table">
                                     <thead>
                                       <tr>
                                         <td>
                                           \${headerHtml}
                                         </td>
                                       </tr>
                                     </thead>
                                     <tbody>
                                       <tr>
                                         <td>
                                           <div class="content">
                                             \${content}
                                           </div>
                                         </td>
                                       </tr>
                                     </tbody>
                                     <tfoot>
                                       <tr>
                                         <td>
                                           \${footerHtml}
                                         </td>
                                       </tr>
                                     </tfoot>
                                   </table>
                                 </body>
                               </html>
                             \`);`;

if (content.includes(target)) {
  fs.writeFileSync(file, content.replace(target, replacement));
  console.log("Replacement successful!");
} else {
  console.log("Target not found!");
}
