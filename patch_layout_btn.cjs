const fs = require('fs');
let code = fs.readFileSync('src/components/Layout.tsx', 'utf-8');

const btnHtml = `
           {role !== "PREMIUM" && (
             <Link to="/dashboard/settings?tab=subscription" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white py-2 rounded-lg text-sm font-bold shadow-md transition-all mb-2 animate-pulse hover:animate-none">
               <ShieldCheck className="w-4 h-4" />
               Subscribe Now
             </Link>
           )}
           <div className="flex items-center gap-2 px-2 pb-2 border-b border-slate-100">
`;

code = code.replace(
  /<div className="flex items-center gap-2 px-2 pb-2 border-b border-slate-100">/,
  btnHtml
);

fs.writeFileSync('src/components/Layout.tsx', code, 'utf-8');
