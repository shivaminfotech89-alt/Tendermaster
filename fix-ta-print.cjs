const fs = require('fs');
const file = 'src/pages/TenderAnalyzer.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /printWindow.document.write\(\`[\s\S]*?<\/html>\s*`\);/m;
const match = content.match(regex);

if (match) {
const replacement = `printWindow.document.write(\`
                                 <html>
                                   <head>
                                     <title>Print Document - \${docType}</title>
                                     <style>
                                       @page { size: A4; margin: 20mm; }
                                       body { 
                                         font-family: system-ui, -apple-system, sans-serif; 
                                         color: #111827; 
                                         max-width: 100%; 
                                         overflow-wrap: break-word; 
                                         word-wrap: break-word; 
                                         padding: 0;
                                         margin: 0;
                                       }
                                       .content { font-size: 11pt; line-height: 1.6; }
                                       table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; page-break-inside: auto; }
                                       tr { page-break-inside: avoid; page-break-after: auto; }
                                       th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; word-wrap: break-word; }
                                       th { background-color: #f3f4f6; }
                                       h1, h2, h3, h4, h5 { margin-top: 20px; margin-bottom: 10px; page-break-after: avoid; }
                                       p { margin-bottom: 10px; }
                                       ul, ol { margin-bottom: 10px; padding-left: 20px; }
                                       @media print { 
                                         body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                       }
                                     </style>
                                   </head>
                                   <body>
                                     <div class="content">
                                       \${content}
                                     </div>
                                   </body>
                                 </html>
                               \`);`;
  fs.writeFileSync(file, content.replace(regex, replacement));
  console.log("Replacement successful in TA!");
} else {
  console.log("Regex not found in TA!");
}
