cat << 'INNER_EOF' > /tmp/replace.js
const fs = require('fs');
const content = fs.readFileSync('src/pages/TenderAnalyzer.tsx', 'utf8');

const oldFunc = `  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 30 * 1024 * 1024) {
      setError("PDF size must be less than 30MB");
      return;
    }
    
    setPdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setTenderPdfBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };`;

const newFunc = `  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    let totalSize = 0;
    const base64Files: string[] = [];
    
    for (const file of files) {
      totalSize += file.size;
    }
    
    if (totalSize > 30 * 1024 * 1024) {
      setError("Total size must be less than 30MB");
      return;
    }
    
    setPdfFileName(files.length === 1 ? files[0].name : \`\${files.length} PDFs selected\`);
    
    for (const file of files) {
       const base64 = await new Promise<string>((resolve) => {
         const reader = new FileReader();
         reader.onload = () => resolve(reader.result as string);
         reader.readAsDataURL(file);
       });
       base64Files.push(base64);
    }
    setTenderPdfBase64(base64Files as any);
  };`;

fs.writeFileSync('src/pages/TenderAnalyzer.tsx', content.replace(oldFunc, newFunc));
INNER_EOF
node /tmp/replace.js
