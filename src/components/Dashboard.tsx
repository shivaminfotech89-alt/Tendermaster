import { Building2, MapPin, Calendar, IndianRupee, Bot, ChevronRight, CheckCircle2 } from 'lucide-react';
import { UserProfile } from '../types';
import { useState } from 'react';
import { mockTenders } from '../data/tenders';
import TenderDetailsModal from './TenderDetailsModal';

function calculateMatchScore(tender: typeof mockTenders[0], userProfile: UserProfile): number {
  if (userProfile.keywords.length === 0 && userProfile.states.length === 0 && !userProfile.min_capacity_inr) {
    return 0; // No profile set
  }

  let score = 0;
  let maxScore = 0;

  if (userProfile.keywords.length > 0) {
    maxScore += 50;
    const documentText = tender.document.toLowerCase() + " " + tender.tags.join(" ");
    const matchedKeywords = userProfile.keywords.filter(k => documentText.includes(k.toLowerCase()));
    if (matchedKeywords.length > 0) {
      score += (matchedKeywords.length / userProfile.keywords.length) * 50;
    }
  }

  if (userProfile.states.length > 0) {
    maxScore += 30;
    const isStateMatch = userProfile.states.some(s => 
      tender.location.toLowerCase().includes(s.toLowerCase()) || 
      tender.location.toLowerCase() === "pan-india" || 
      s.toLowerCase() === "pan-india"
    );
    if (isStateMatch) score += 30;
  }

  if (userProfile.min_capacity_inr) {
    maxScore += 20;
    if (tender.value_inr >= userProfile.min_capacity_inr) {
      score += 20;
    }
  }

  // Normalize out of 100
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 100);
}

export default function Dashboard({
  userProfile,
  onAnalyze,
  onQA
}: {
  userProfile: UserProfile;
  onAnalyze: (doc: string) => void;
  onQA: (doc: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'matched'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTender, setSelectedTender] = useState<any>(null);

  const tendersWithScores = mockTenders.map(t => ({
    ...t,
    matchScore: calculateMatchScore(t, userProfile)
  }));

  const hasProfile = userProfile.keywords.length > 0 || userProfile.states.length > 0 || userProfile.min_capacity_inr;
  
  let displayedTenders = filter === 'matched' 
    ? tendersWithScores.filter(t => t.matchScore >= 40).sort((a, b) => b.matchScore - a.matchScore)
    : tendersWithScores;

  if (searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase();
    displayedTenders = displayedTenders.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.authority.toLowerCase().includes(q) || 
      t.location.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {selectedTender && (
        <TenderDetailsModal 
          tender={selectedTender}
          onClose={() => setSelectedTender(null)}
          onAnalyze={() => onAnalyze(selectedTender.document)}
          onQA={() => onQA(selectedTender.document)}
        />
      )}
      <div className="bg-white rounded-lg px-6 py-4 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase mb-1">Live Feed</h2>
          <h1 className="text-xl font-bold text-slate-900">All India Tenders</h1>
          <p className="text-xs text-slate-500 mt-1">Select a tender to view details, download PDF, or orchestrate AI analysis.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <input 
            type="text"
            placeholder="Search tenders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded min-w-[200px] focus:outline-none focus:border-[#002b5b]"
          />
          {hasProfile && (
            <div className="flex bg-slate-100 p-1 rounded-md">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-1.5 text-xs font-bold rounded ${filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                All Tenders
              </button>
              <button
                onClick={() => setFilter('matched')}
                className={`px-4 py-1.5 text-xs font-bold rounded flex items-center gap-1 ${filter === 'matched' ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-200' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> For You
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {displayedTenders.length === 0 && filter === 'matched' && (
           <div className="col-span-full py-12 text-center text-slate-500">
              <p>No robust matches found for your current profile.</p>
              <button 
                onClick={() => setFilter('all')}
                className="mt-2 text-[#002b5b] font-bold text-sm underline"
              >
                View all tenders
              </button>
           </div>
        )}

        {displayedTenders.map(tender => (
           <div key={tender.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col items-start gap-4 h-full relative overflow-hidden">
              {hasProfile && tender.matchScore >= 40 && (
                <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                  {tender.matchScore}% Match
                </div>
              )}
              
              <div className="flex justify-between items-start w-full pr-16">
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded uppercase tracking-wider">
                  {tender.id}
                </span>
                <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-400">
                  <Building2 className="w-3 h-3" />
                  {tender.authority}
                </span>
              </div>
              
              <h3 className="font-bold text-slate-900 leading-snug flex-1">
                {tender.title}
              </h3>

              <div className="grid grid-cols-2 gap-3 w-full bg-slate-50 p-3 rounded border border-slate-100 mt-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                     <IndianRupee className="w-3 h-3" /> Value
                  </div>
                  <span className="text-sm font-bold text-slate-700">{tender.estimated_value}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                     <MapPin className="w-3 h-3" /> Location
                  </div>
                  <span className="text-sm font-bold text-slate-700 truncate" title={tender.location}>{tender.location}</span>
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                     <Calendar className="w-3 h-3" /> Deadline
                  </div>
                  <span className="text-sm font-bold text-slate-700">{tender.deadline}</span>
                </div>
              </div>

              <div className="flex w-full gap-2 mt-auto pt-2">
                <button
                  onClick={() => setSelectedTender(tender)}
                  className="flex-1 h-9 bg-[#002b5b] text-white rounded text-[11px] font-bold uppercase tracking-wider hover:bg-[#003d82] transition-colors flex items-center justify-center gap-1"
                >
                  View Details & Analyse
                </button>
              </div>
           </div>
        ))}
      </div>
    </div>
  );
}
