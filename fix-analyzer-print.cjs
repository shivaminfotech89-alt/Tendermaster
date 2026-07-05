const fs = require('fs');
let content = fs.readFileSync('src/pages/TenderAnalyzer.tsx', 'utf8');

// 1. Add useLetterhead state
content = content.replace(
  /const \[docType, setDocType\] = useState\("Cover Letter"\);/,
  'const [docType, setDocType] = useState("Cover Letter");\n  const [useLetterhead, setUseLetterhead] = useState(false);'
);

// 2. Add checkbox
const checkboxHtml = `                           <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={useLetterhead} 
                                onChange={(e) => setUseLetterhead(e.target.checked)} 
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Use Letterhead
                           </label>
                           <button onClick={() => {`;

content = content.replace(
  /                             <button onClick=\{\(\) => \{\n                               const printWindow = window\.open\('', '', 'width=800,height=900'\);/g,
  checkboxHtml + "\n                               const printWindow = window.open('', '', 'width=800,height=900');"
);

// 3. Replace print logic
const oldPrintLogicRegex = /const content = document\.getElementById\('generated-doc-content-analyzer'\)\?\.innerHTML \|\| '';[\s\S]*?printWindow\.document\.write\(\`([\s\S]*?)\`\);/;

const newPrintLogic = `const content = document.getElementById('generated-doc-content-analyzer')?.innerHTML || '';

                               let headerHtml = '';
                               let footerHtml = '';
                               let bgImageHtml = '';
                               let pageMargin = '20mm'; // Standard A4 margin
                               let bodyPadding = '0';
                               
                               if (useLetterhead && businessProfile) {
                                  if (businessProfile.letterheadBackgroundImage) {
                                     bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;
                                     // Full bleed for letterhead image
                                     pageMargin = '0';
                                     bodyPadding = '0 20mm'; // Add side margins via body padding
                                     
                                     // A4 height is 297mm. Add top/bottom space for the graphics.
                                     headerHtml = \`<div style="height: 35mm; width: 100%;"></div>\`;
                                     footerHtml = \`<div style="height: 25mm; width: 100%;"></div>\`;
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
                                       @page { size: A4; margin: \${pageMargin}; }
                                       body { 
                                         font-family: system-ui, -apple-system, sans-serif; 
                                         color: #111827; 
                                         margin: 0;
                                         padding: \${bodyPadding};
                                         box-sizing: border-box;
                                       }
                                       .content { font-size: 11pt; line-height: 1.6; }
                                       
                                       /* Layout tables (header/footer) */
                                       table.layout-table { width: 100%; border-collapse: collapse; border: none; margin: 0; padding: 0; table-layout: fixed; }
                                       table.layout-table > thead { display: table-header-group; }
                                       table.layout-table > tfoot { display: table-footer-group; }
                                       table.layout-table > tbody > tr > td { border: none; padding: 0; }
                                       table.layout-table > thead > tr > td { border: none; padding: 0; }
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
                                          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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

content = content.replace(oldPrintLogicRegex, newPrintLogic);
fs.writeFileSync('src/pages/TenderAnalyzer.tsx', content);
