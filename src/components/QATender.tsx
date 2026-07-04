import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, MessageSquareText } from "lucide-react";
import { fetchWithAuth } from "../lib/api";

export default function QATender({
  tenderDoc,
  setTenderDoc
}: {
  tenderDoc: string;
  setTenderDoc: (doc: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = async () => {
    if (!tenderDoc.trim() || !question.trim()) return;
    
    const userQ = question;
    setQuestion("");
    setChatHistory(prev => [...prev, { role: 'user', content: userQ }]);
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetchWithAuth("/api/qa-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenderDocument: tenderDoc, question: userQ }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get answer");
      
      setChatHistory(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err: any) {
      setError(err.message);
      setChatHistory(prev => [...prev, { role: 'assistant', content: "Error: " + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col mb-12">
      <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm shrink-0">
        <h2 className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase mb-1">Grounded Document Q&A</h2>
        <p className="text-slate-500 text-sm mb-6">
          Paste the tender document below or select one from the Dashboard. You can then ask specific legal or technical questions, 
          and the engine will respond ONLY using facts from the document.
        </p>

        <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">Tender Document Base</label>
        <textarea
          value={tenderDoc}
          onChange={(e) => setTenderDoc(e.target.value)}
          placeholder="Paste full tender text here to ground the answers..."
          className="w-full h-32 p-4 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#002b5b] resize-none font-sans text-sm bg-slate-50"
        />
      </div>

      <div className="bg-white flex-1 rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[400px]">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 bg-slate-50">
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
               <MessageSquareText className="w-8 h-8 opacity-50" />
               <p className="text-sm font-medium">Ask a question about the tender document above.</p>
            </div>
          ) : (
            chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded p-4 shadow-sm border ${
                  msg.role === 'user' 
                    ? 'bg-[#002b5b] text-white border-[#001d3d] rounded-tr-none' 
                    : 'bg-white border-slate-200 text-slate-800 rounded-tl-none'
                }`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-2 opacity-70">
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  {msg.role === 'user' ? (
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <div className="prose prose-sm prose-slate max-w-none">
                      <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
               <div className="bg-white border border-slate-200 text-slate-800 rounded rounded-tl-none p-4 shadow-sm flex items-center space-x-3">
                 <Loader2 className="w-4 h-4 animate-spin text-[#002b5b]" />
                 <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Searching...</span>
               </div>
            </div>
          )}
        </div>
        
        <div className="p-4 bg-white border-t border-slate-200">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              placeholder="e.g. What is the deadline? or Are there penalties for delay?"
              className="flex-1 p-3 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#002b5b] text-sm"
              disabled={!tenderDoc.trim() || loading}
            />
            <button
              onClick={handleAsk}
              disabled={!tenderDoc.trim() || !question.trim() || loading}
              className="h-11 px-6 bg-amber-400 text-[#002b5b] font-black rounded text-xs uppercase hover:bg-amber-300 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <Send className="w-4 h-4 mr-2" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
