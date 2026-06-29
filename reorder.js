const fs = require('fs');

const content = fs.readFileSync('src/pages/TenderAnalyzer.tsx', 'utf8');

const p3 = content.substring(content.indexOf('            {/* Part 3: Match with Profile */}'), content.indexOf('            {/* Part 1: Tender Information */}'));
const p1GridOpen = content.substring(content.indexOf('            {/* Part 1: Tender Information */}'), content.indexOf('            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">') + 69);
const p1Content = content.substring(content.indexOf('              {/* Simplified Scope */}'), content.indexOf('              {/* Part 4: Timeline & Steps */}'));
const p4Content = content.substring(content.indexOf('              {/* Part 4: Timeline & Steps */}'), content.indexOf('            {/* Part 2: Requirements */}'));
const p2Content = content.substring(content.indexOf('            {/* Part 2: Requirements */}'), content.indexOf('             {/* Integrated Chatbot for active tender */}'));

console.log("p3 length:", p3.length);
console.log("p1GridOpen length:", p1GridOpen.length);
console.log("p1Content length:", p1Content.length);
console.log("p4Content length:", p4Content.length);
console.log("p2Content length:", p2Content.length);

const beforeP3 = content.substring(0, content.indexOf('            {/* Part 3: Match with Profile */}'));
const afterP2 = content.substring(content.indexOf('             {/* Integrated Chatbot for active tender */}'));

// Combine!
const newContent = beforeP3 + 
    `            {/* Part 1: Tender Information */}
            <div className="space-y-4 pt-6">
              <h2 className="text-sm font-black tracking-widest text-indigo-500 uppercase border-b border-indigo-100 pb-2">Part 1: Tender Information & Scope</h2>
              {/* Simplified Scope */}
` + p1Content.replace('              {/* Simplified Scope */}', '').replace(/^ +/, '') + 
    `            </div>

` + 
    p2Content + 
    p3 + 
    p4Content + 
    afterP2;

// Wait, p1Content and p4Content were inside a grid grid-cols-1 lg:grid-cols-2 gap-6!
// Part 1 is the Scope block. Part 4 is the Milestones block. If I separate them, they don't need a grid together, or maybe they do?
// Let's just output their block variables so we can write a script to re-arrange string properly.
