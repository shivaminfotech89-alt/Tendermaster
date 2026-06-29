import { useState } from 'react';
import { Bot, MapPin, Calendar, IndianRupee, FileText, Download, MessageSquareText, FileDown, Bell, CheckCircle2, Building2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function TenderDetailsModal({
  tender,
  onClose,
  onAnalyze,
  onQA
}: {
  tender: any;
  onClose: () => void;
  onAnalyze: () => void;
  onQA: () => void;
}) {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [showWhatsappForm, setShowWhatsappForm] = useState(false);

  const handleWhatsappSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length >= 10) {
      setWhatsappEnabled(true);
      setShowWhatsappForm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-start p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col gap-2 relative pr-8">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded uppercase tracking-wider">
                {tender.id}
              </span>
              <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-400">
                <Building2 className="w-3 h-3" />
                {tender.authority}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 leading-tight bg-white">
              {tender.title}
            </h2>
            <div className="flex gap-2 mt-1 flex-wrap">
               {tender.tags.map((tag: string) => (
                 <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded uppercase">
                   {tag}
                 </span>
               ))}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 rounded-full hover:bg-slate-200 hover:text-slate-900 transition-colors absolute top-6 right-6"
          >
            ✕
          </button>
        </div>

        {/* Action Bar */}
        <div className="bg-[#002b5b] p-4 flex flex-wrap gap-3 shrink-0">
          <button 
            onClick={onAnalyze}
            className="flex-1 sm:flex-none h-10 px-5 bg-amber-400 text-[#002b5b] rounded text-xs font-black uppercase tracking-wider hover:bg-amber-300 transition-colors flex items-center justify-center gap-2"
          >
            <Bot className="w-4 h-4" /> AI Risk Profile
          </button>
          
          <button 
            onClick={onQA}
            className="flex-1 sm:flex-none h-10 px-5 bg-white/10 text-white rounded text-xs font-bold hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
          >
            <MessageSquareText className="w-4 h-4" /> Legal Q&A
          </button>
          
          <button 
            className="flex-1 sm:flex-none h-10 px-5 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
            onClick={() => setShowWhatsappForm(!showWhatsappForm)}
          >
            {whatsappEnabled ? <CheckCircle2 className="w-4 h-4" /> : <Bell className="w-4 h-4" />} 
            {whatsappEnabled ? 'WhatsApp Active' : 'WhatsApp Alerts'}
          </button>

          <button 
            className="flex-1 sm:flex-none h-10 px-5 bg-white/10 text-white rounded text-xs font-bold hover:bg-white/20 transition-colors flex items-center justify-center gap-2 sm:ml-auto"
            onClick={() => toast.success("Downloading Original PDF Source...")}
          >
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>

        {showWhatsappForm && !whatsappEnabled && (
          <div className="bg-emerald-50 p-4 border-b border-emerald-100 flex flex-col sm:flex-row items-center gap-4">
             <div className="flex-1 text-sm text-emerald-800">
               <strong>Get Instant Corrigendum & Deadline Alerts</strong> straight to your phone.
             </div>
             <form onSubmit={handleWhatsappSubmit} className="flex gap-2 w-full sm:w-auto">
               <input 
                 type="tel" 
                 placeholder="+91 Mobile Number" 
                 required
                 value={phone}
                 onChange={(e) => setPhone(e.target.value)}
                 className="flex-1 sm:w-48 h-9 px-3 text-sm border border-emerald-200 rounded focus:outline-none focus:border-emerald-500"
               />
               <button type="submit" className="h-9 px-4 bg-emerald-600 text-white font-bold text-xs rounded hover:bg-emerald-700 uppercase">
                 Subscribe
               </button>
             </form>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-6 bg-[#f8fafc]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Document display */}
            <div className="md:col-span-2 space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <FileText className="w-4 h-4" /> Original Tender Synopsis
              </h3>
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm whitespace-pre-wrap font-mono text-[11px] md:text-xs text-slate-700 leading-relaxed max-w-full overflow-x-auto">
                {tender.document}
              </div>
            </div>

            {/* Quick Stats sidebar */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Key Metdata</h3>
              
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                     <IndianRupee className="w-3 h-3" /> Contract Value
                  </div>
                  <span className="text-lg font-black text-slate-800">{tender.estimated_value}</span>
                </div>
                
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                     <MapPin className="w-3 h-3" /> Location
                  </div>
                  <span className="text-sm font-bold text-slate-700">{tender.location}</span>
                </div>
                
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#002b5b] uppercase tracking-wide">
                     <Calendar className="w-3 h-3" /> Submission Deadline
                  </div>
                  <span className="text-sm font-bold text-slate-700">{tender.deadline}</span>
                </div>
              </div>

            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
