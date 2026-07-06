const fs = require('fs');
let code = fs.readFileSync('src/components/Layout.tsx', 'utf-8');

const mobileHeaderHtml = `
            <div className="flex items-center gap-2">
              {role !== "PREMIUM" && (
                 <Link to="/dashboard/settings?tab=subscription" className="flex items-center justify-center bg-gradient-to-r from-amber-500 to-orange-500 text-white p-1.5 rounded text-xs font-bold shadow-md animate-pulse">
                   <ShieldCheck className="w-4 h-4 mr-1" />
                   UPGRADE
                 </Link>
              )}
              <select 
`;

code = code.replace(
  /<div className="flex items-center gap-2">\s*<select/,
  mobileHeaderHtml
);

fs.writeFileSync('src/components/Layout.tsx', code, 'utf-8');
