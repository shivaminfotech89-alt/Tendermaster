const fs = require('fs');
let code = fs.readFileSync('src/pages/ProjectDetails.tsx', 'utf-8');

// Fix 4 column grid
code = code.replace(
    '<div className="grid grid-cols-1 md:grid-cols-3 gap-4">',
    '<div className="grid grid-cols-1 md:grid-cols-4 gap-4">'
);

// Add target margin div
code = code.replace(
    '₹{totalExpense.toLocaleString()}\\n                     </div>\\n                  </div>',
    '₹{totalExpense.toLocaleString()}\\n                     </div>\\n                  </div>\\n                  <div className="bg-white p-4 rounded-xl border border-slate-200">\\n                     <p className="text-xs font-bold text-slate-500 uppercase">Target Margin (%) -> Auto Bid</p>\\n                     <div className="flex items-center mt-2">\\n                       <input \\n                         type="number"\\n                         placeholder="e.g. 15"\\n                         onChange={e => {\\n                            const margin = Number(e.target.value);\\n                            if (margin && margin < 100) {\\n                               setRevenue(Math.round(totalExpense / (1 - margin / 100)));\\n                            }\\n                         }}\\n                         className="bg-transparent border-0 font-bold text-2xl text-slate-900 w-full p-0 focus:ring-0 outline-none"\\n                       />\\n                       <span className="text-slate-400 ml-1 text-lg font-bold">%</span>\\n                     </div>\\n                  </div>'
);

fs.writeFileSync('src/pages/ProjectDetails.tsx', code, 'utf-8');
