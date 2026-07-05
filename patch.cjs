const fs = require('fs');

function patchFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf-8');
    for (const [target, replacement] of replacements) {
        if (!content.includes(target)) {
            console.error(`Target not found in ${filePath}:\n${target}`);
            process.exit(1);
        }
        content = content.replace(target, replacement);
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Successfully patched ${filePath}`);
}

const businessProfileReplacements = [
    [
        `    keywords: "",\n    turnover: "",\n    experienceYears: "",`,
        `    keywords: "",\n    turnover: "",\n    turnoverUnit: "Lakhs",\n    experienceYears: "",`
    ],
    [
        `             keywords: data.keywords?.join(", ") || "",\n             certifications: data.certifications?.join(", ") || "",`,
        `             keywords: data.keywords?.join(", ") || "",\n             turnoverUnit: data.turnoverUnit || "Lakhs",\n             certifications: data.certifications?.join(", ") || "",`
    ],
    [
        `        majorClients: profile.majorClients.split(",").map(s => s.trim()).filter(Boolean),\n        turnover: Number(profile.turnover) || 0,\n        experienceYears: Number(profile.experienceYears) || 0,`,
        `        majorClients: profile.majorClients.split(",").map(s => s.trim()).filter(Boolean),\n        turnover: Number(profile.turnover) || 0,\n        turnoverUnit: profile.turnoverUnit || "Lakhs",\n        experienceYears: Number(profile.experienceYears) || 0,`
    ],
    [
        `            <div className="flex flex-col gap-2">\n               <label className="text-sm font-semibold text-slate-700">Annual Turnover (INR in Lakhs)</label>\n               <input name="turnover" type="number" value={profile.turnover} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" min="0" />\n            </div>`,
        `            <div className="flex flex-col gap-2">\n               <label className="text-sm font-semibold text-slate-700">Annual Turnover</label>\n               <div className="flex gap-2">\n                 <input name="turnover" type="number" value={profile.turnover} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none flex-1" min="0" placeholder="Amount" />\n                 <select name="turnoverUnit" value={profile.turnoverUnit} onChange={handleChange} className="border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 outline-none">\n                   <option value="Lakhs">Lakhs</option>\n                   <option value="Crores">Crores</option>\n                 </select>\n               </div>\n            </div>`
    ]
];

patchFile('src/pages/BusinessProfile.tsx', businessProfileReplacements);

const projectDetailsReplacements = [
    [
        `                                     bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;\n                                     // Full bleed for letterhead image\n                                     pageMargin = '0';\n                                     bodyPadding = '0 20mm'; // Add side margins via body padding\n                                     \n                                     // A4 height is 297mm. Add top/bottom space for the graphics.\n                                     headerHtml = \`<div style="height: 35mm; width: 100%;"></div>\`;\n                                     footerHtml = \`<div style="height: 25mm; width: 100%;"></div>\`;`,
        `                                     bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;\n                                     // Full bleed for letterhead image\n                                     pageMargin = '0';\n                                     bodyPadding = '0 20mm'; // Add side margins via body padding\n                                     \n                                     // A4 height is 297mm. Add top/bottom space for the graphics.\n                                     headerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;\n                                     footerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;`
    ],
    [
        `      const opt = {\n        margin:       0.3,\n        filename:`,
        `      const opt = {\n        margin:       [0.3, 0.3, 0.8, 0.3],\n        filename:`
    ]
];
patchFile('src/pages/ProjectDetails.tsx', projectDetailsReplacements);

const tenderAnalyzerReplacements = [
    [
        `                                     bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;\n                                     // Full bleed for letterhead image\n                                     pageMargin = '0';\n                                     bodyPadding = '0 20mm'; // Add side margins via body padding\n                                     \n                                     // A4 height is 297mm. Add top/bottom space for the graphics.\n                                     headerHtml = \`<div style="height: 35mm; width: 100%;"></div>\`;\n                                     footerHtml = \`<div style="height: 25mm; width: 100%;"></div>\`;`,
        `                                     bgImageHtml = \`<img src="\${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />\`;\n                                     // Full bleed for letterhead image\n                                     pageMargin = '0';\n                                     bodyPadding = '0 20mm'; // Add side margins via body padding\n                                     \n                                     // A4 height is 297mm. Add top/bottom space for the graphics.\n                                     headerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;\n                                     footerHtml = \`<div style="height: 45mm; width: 100%;"></div>\`;`
    ],
    [
        `      const opt = {\n        margin:       0.3,\n        filename:`,
        `      const opt = {\n        margin:       [0.3, 0.3, 0.8, 0.3],\n        filename:`
    ]
];
patchFile('src/pages/TenderAnalyzer.tsx', tenderAnalyzerReplacements);

