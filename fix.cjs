const fs = require('fs');

let content = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf8');

// The replacement for uploadedCount
const replacement = 'const uploadedCount = project.details?.required_documents_checklist?.filter((d: any) => uploadedFiles.some(f => (f.name || "").toLowerCase().includes((d.document_name || "").toLowerCase()) || (f.type || "").toLowerCase().includes((d.document_name || "").toLowerCase())) || checkedItems.includes(d.document_name)).length || 0;';

const oldStr = 'const uploadedCount = project.details?.required_documents_checklist?.filter((d: any) => uploadedFiles.some(f => (f.name || "").toLowerCase().includes((d.document_name || "").toLowerCase()) || (f.type || "").toLowerCase().includes((d.document_name || "").toLowerCase()))).length || 0;';

content = content.replaceAll(oldStr, replacement);

fs.writeFileSync('src/pages/ProjectDetails.tsx', content, 'utf8');
