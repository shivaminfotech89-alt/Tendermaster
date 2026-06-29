import fs from 'fs';

const files = [
  'src/pages/TenderChat.tsx',
  'src/components/QATender.tsx'
];

for (const file of files) {
   let content = fs.readFileSync(file, 'utf8');
   
   if (!content.includes('import remarkGfm')) {
      content = content.replace('import Markdown from "react-markdown";', "import Markdown from \"react-markdown\";\nimport remarkGfm from \"remark-gfm\";");
   }

   content = content.replace(/<Markdown>\{([^\}]+)\}<\/Markdown>/g, "<Markdown remarkPlugins={[remarkGfm]}>{$1}</Markdown>");
   fs.writeFileSync(file, content, 'utf8');
}
