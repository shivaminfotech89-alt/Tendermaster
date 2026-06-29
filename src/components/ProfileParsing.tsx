import { useState } from "react";
import { UserProfile } from "../types";
import { Loader2, Zap, Save } from "lucide-react";

export default function ProfileParsing({
  userProfile,
  setUserProfile,
  onSave
}: {
  userProfile: UserProfile;
  setUserProfile: (p: UserProfile) => void;
  onSave: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // local editable state
  const [localProfile, setLocalProfile] = useState<UserProfile>(userProfile);

  const handleParse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch("/api/parse-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse");
      
      setLocalProfile({
        keywords: data.profile.keywords || [],
        states: data.profile.states || [],
        min_capacity_inr: data.profile.min_capacity_inr || null
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setUserProfile(localProfile);
    onSave();
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex-1 bg-white rounded-lg p-6 border border-slate-200 flex flex-col gap-4 shadow-sm shrink-0">
        <div>
          <h2 className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase mb-1">AI Profile Extraction</h2>
          <p className="text-slate-500 text-sm">
            Enter a description of your business capabilities, locations, and financial capacity. We will automatically structure the data.
          </p>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We are an infrastructure company based in Karnataka, looking for road/flyover contracts over 50 Crores. We do not do IT projects..."
          className="w-full flex-1 min-h-[150px] p-4 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#002b5b] resize-none font-sans text-sm bg-slate-50"
        />

        <div className="flex justify-start">
          <button
            onClick={handleParse}
            disabled={loading || !text.trim()}
            className="h-10 px-6 bg-amber-400 text-[#002b5b] font-black rounded text-xs uppercase hover:bg-amber-300 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span>Extract with AI</span>
          </button>
        </div>
        
        {error && (
          <div className="p-3 mt-2 bg-red-50 text-red-700 rounded text-sm border border-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="flex-[1.2] bg-white rounded-lg p-6 border border-slate-200 shadow-sm flex flex-col">
        <div>
          <h2 className="text-[10px] font-bold text-[#002b5b] tracking-[0.2em] uppercase mb-1">Your Structured Profile</h2>
          <p className="text-slate-500 text-sm mb-6">
            Review and manually edit your business profile. This data is used to match and filter relevant tenders.
          </p>
        </div>

        <div className="space-y-5 flex-1 overflow-y-auto pr-2">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Industry Keywords</label>
            <input 
              type="text"
              value={localProfile.keywords.join(', ')}
              onChange={(e) => setLocalProfile({...localProfile, keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
              placeholder="solar, flyover, IT services"
              className="w-full p-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-[#002b5b] focus:ring-1 focus:ring-[#002b5b]"
            />
            <p className="text-[10px] text-slate-400">Comma separated. Used for semantic matching.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Preferred States</label>
            <input 
              type="text"
              value={localProfile.states.join(', ')}
              onChange={(e) => setLocalProfile({...localProfile, states: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
              placeholder="Karnataka, Uttar Pradesh, Pan-India"
              className="w-full p-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-[#002b5b] focus:ring-1 focus:ring-[#002b5b]"
            />
            <p className="text-[10px] text-slate-400">Comma separated. Geographic preferences.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Minimum Contract Value Capacity (INR)</label>
            <input 
              type="number"
              value={localProfile.min_capacity_inr || ''}
              onChange={(e) => setLocalProfile({...localProfile, min_capacity_inr: e.target.value ? Number(e.target.value) : null})}
              placeholder="e.g. 5000000"
              className="w-full p-2.5 text-sm border border-slate-200 rounded focus:outline-none focus:border-[#002b5b] focus:ring-1 focus:ring-[#002b5b]"
            />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
          <button
            onClick={handleSave}
            className="h-10 px-6 bg-[#002b5b] text-white font-bold rounded text-xs uppercase hover:bg-[#003d82] transition-colors flex items-center justify-center space-x-2"
          >
            <Save className="w-4 h-4" />
            <span>Save Profile & View Tenders</span>
          </button>
        </div>
      </div>
    </div>
  );
}
