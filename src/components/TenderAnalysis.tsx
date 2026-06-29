import { useState } from "react";
import { TenderAnalysisResult, UserProfile } from "../types";
import { Loader2, ShieldCheck } from "lucide-react";

export default function TenderAnalysis({
  tenderDoc,
  setTenderDoc,
  userProfile
}: {
  tenderDoc: string;
  setTenderDoc: (t: string) => void;
  userProfile: UserProfile;
}) {
  const [analysis, setAnalysis] = useState<TenderAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!tenderDoc.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    
    try {
      const res = await fetch("/api/analyze-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenderDocument: tenderDoc, userProfile: JSON.stringify(userProfile) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze");
      setAnalysis(data.analysis);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm shrink-0">
        <h2 className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase mb-1">Tender Analysis & Risk Profile</h2>
        <p className="text-slate-500 text-sm mb-6">
          Provide the raw tender document and your structured profile JSON to evaluate compatibility and risks.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">Tender Document</label>
            <textarea
              value={tenderDoc}
              onChange={(e) => setTenderDoc(e.target.value)}
              placeholder="Paste tender text here..."
              className="w-full h-40 p-4 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#002b5b] resize-none font-sans text-sm bg-slate-50"
            />
          </div>
          <div className="flex flex-col">
            <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">User Profile</label>
            <div className="flex-1 w-full bg-[#1a1a1a] rounded p-4 font-mono text-[11px] text-emerald-400 shadow-inner overflow-auto leading-relaxed border border-slate-800">
              <pre>{JSON.stringify(userProfile, null, 2)}</pre>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">Edit this in the Business Profile tab.</p>
          </div>
        </div>

        <div className="flex justify-start">
          <button
            onClick={handleAnalyze}
            disabled={loading || !tenderDoc.trim() || Object.keys(userProfile).length === 0}
            className="h-10 px-6 bg-amber-400 text-[#002b5b] font-black rounded text-xs uppercase hover:bg-amber-300 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>Run Compatibility Analysis</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200 shrink-0">
          {error}
        </div>
      )}

      {analysis && (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-6 animate-in fade-in zoom-in-95 duration-300 pb-12">
          <aside className="w-full md:w-1/3 flex flex-col gap-6 overflow-y-auto pr-1">
            <div className="bg-white rounded-lg p-5 border border-slate-200 flex flex-col gap-4 shadow-sm shrink-0">
              <h3 className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase text-center">Match Score</h3>
              <div className="flex flex-col items-center justify-center">
                <div className="text-5xl font-black text-[#002b5b]">
                  {analysis.compatibility.score}
                  <span className="text-sm font-medium text-slate-400">/100</span>
                </div>
                <div className={`text-[10px] font-bold tracking-tighter mt-1 uppercase ${analysis.compatibility.score >= 80 ? 'text-emerald-600' : analysis.compatibility.score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                  {analysis.compatibility.score >= 80 ? 'High Compatibility' : analysis.compatibility.score >= 50 ? 'Moderate Compatibility' : 'Low Compatibility'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col shrink-0">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Timelines & Milestones</h3>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Submission Date</span>
                  <span className="text-lg font-bold">{analysis.timeline_and_milestones.submission_deadline}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Pre-bid Meeting</span>
                  <span className="text-lg font-bold">{analysis.timeline_and_milestones.pre_bid_meeting}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Clarification Deadline</span>
                  <span className="text-lg font-bold">{analysis.timeline_and_milestones.clarification_deadline}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Execution Duration</span>
                  <span className="text-sm font-bold">{analysis.timeline_and_milestones.execution_duration}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-[#002b5b] rounded-lg p-5 flex flex-col gap-2 text-white shadow-lg shadow-blue-900/20 shrink-0">
                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Recommendation</p>
                <p className="text-sm font-bold uppercase mb-2">{analysis.compatibility.score >= 80 ? 'Proceed to bid prep' : analysis.compatibility.score >= 50 ? 'Review critical risks' : 'Not recommended'}</p>
                <p className="text-[11px] leading-snug opacity-90">{analysis.compatibility.rationale}</p>
            </div>
          </aside>

          <section className="w-full md:w-2/3 flex flex-col gap-6 overflow-y-auto pr-1">
            <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm shrink-0">
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                   <h1 className="text-xl font-bold text-slate-900">Scope Summary</h1>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{analysis.tender_simplified.scope_of_work}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Key Advantages (Pros)</p>
                  <ul className="text-[12px] space-y-2 text-slate-700">
                    {analysis.tender_simplified.pros.map((pro, i) => (
                      <li key={i} className="flex">
                         <span className="mr-1.5 font-bold text-emerald-500">•</span>
                         <span>{pro}</span>
                      </li>
                    ))}
                    {analysis.tender_simplified.pros.length === 0 && <li className="italic opacity-50">None identified.</li>}
                  </ul>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-red-600 uppercase">Cons & Risks</p>
                  <ul className="text-[12px] space-y-2 text-slate-700">
                    {analysis.tender_simplified.cons_and_risks.map((con, i) => (
                      <li key={i} className="flex">
                         <span className="mr-1.5 font-bold text-red-500">•</span>
                         <span>{con}</span>
                      </li>
                    ))}
                    {analysis.tender_simplified.cons_and_risks.length === 0 && <li className="italic opacity-50">None identified.</li>}
                  </ul>
                </div>
              </div>
            </div>

            {analysis.required_documents_checklist.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Required Documents Checklist</h3>
                  <span className="text-[10px] text-slate-400 font-medium italic">{analysis.required_documents_checklist.length} Documents</span>
                </div>
                <div className="flex-1 overflow-hidden p-4 space-y-3">
                  {analysis.required_documents_checklist.map((doc, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-slate-50 border border-slate-200">
                         <div className="space-y-1 w-full">
                           <div className="flex justify-between items-center w-full">
                             <p className="text-xs font-bold text-slate-900">
                               {doc.document_name}
                             </p>
                             <span className="text-[9px] font-black px-1 rounded bg-slate-200 text-slate-700 uppercase">
                               {doc.status}
                             </span>
                           </div>
                           <p className="text-[11px] leading-snug text-slate-700">
                             {doc.context}
                           </p>
                         </div>
                      </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden shrink-0">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wide">Application Roadmap</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {analysis.application_roadmap.portal_source}
                </span>
              </div>
              <div className="p-5 space-y-6">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Next Immediate Steps</h4>
                  <div className="space-y-3">
                    {analysis.application_roadmap.next_immediate_steps.map((step, i) => (
                      <div key={i} className="flex gap-3">
                         <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex flex-shrink-0 items-center justify-center shrink-0">
                           {i + 1}
                         </div>
                         <p className="text-xs text-slate-700 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {analysis.application_roadmap.winning_strategy_tips.length > 0 && (
                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1">
                       <ShieldCheck className="w-3 h-3" /> Winning Strategy Tips
                    </h4>
                    <ul className="space-y-2">
                      {analysis.application_roadmap.winning_strategy_tips.map((tip, i) => (
                        <li key={i} className="text-xs text-slate-700 leading-relaxed pl-3 border-l-2 border-emerald-300">
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
