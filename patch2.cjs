const fs = require('fs');

function patchFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf-8');
    for (const [target, replacement] of replacements) {
        content = content.replace(target, replacement);
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Successfully patched ${filePath}`);
}

const projectDetailsReplacements = [
    [
        `headerHtml = \`<div style="height: 35mm; width: 100%;"></div>\`;`,
        `headerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;`
    ],
    [
        `footerHtml = \`<div style="height: 25mm; width: 100%;"></div>\`;`,
        `footerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;`
    ],
    [
        `      const opt = {\n        margin:       0.3,\n        filename:`,
        `      const opt = {\n        margin:       [0.3, 0.3, 0.8, 0.3],\n        filename:`
    ]
];
patchFile('src/pages/ProjectDetails.tsx', projectDetailsReplacements);
