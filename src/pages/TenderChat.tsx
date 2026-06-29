import { useState, useEffect, useRef } from "react";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../auth/AuthProvider";
import { MessageSquare, Search, Send, Loader2, ArrowLeft, FolderOpen } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function TenderChat() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadProjects() {
      if (!user) return;
      try {
        const q = query(collection(db, "saved_tenders"), where("userId", "==", user.uid));
        const snap = await getDocs(q);
        const projs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setProjects(projs);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, [user]);

  useEffect(() => {
     chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  const filteredProjects = projects.filter(p => 
     (p.projectName || p.tenderName || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading || !selectedProject) return;
    
    const newMsg = { role: 'user' as const, text: chatInput };
    setMessages(prev => [...prev, newMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderDocument: JSON.stringify(selectedProject.details),
          analysisResult: selectedProject.details,
          messages: [...messages, newMsg]
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessages(prev => [...prev, { role: 'model', text: data.reply }]);
    } catch(err: any) {
       console.error("Chat Error:", err);
       setMessages(prev => [...prev, { role: 'model', text: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  if (!selectedProject) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
           <MessageSquare className="w-6 h-6 text-blue-600" />
           Global Tender Chat
        </h1>
        <p className="text-slate-500 mb-6">Select a project to start chatting with its dedicated AI assistant.</p>
        
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col items-center">
           <div className="w-full p-4 border-b border-slate-100">
             <div className="relative">
               <Search className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
               <input 
                 type="text" 
                 placeholder="Search projects..." 
                 className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                 value={search}
                 onChange={e => setSearch(e.target.value)}
               />
             </div>
           </div>
           
           <div className="w-full divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
             {filteredProjects.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No projects found.</div>
             ) : (
                filteredProjects.map(p => (
                   <div 
                     key={p.id} 
                     onClick={() => { setSelectedProject(p); setMessages([]); }}
                     className="p-4 hover:bg-blue-50 cursor-pointer flex items-center justify-between group transition-colors"
                   >
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                         <FolderOpen className="w-5 h-5" />
                       </div>
                       <div>
                         <h3 className="font-bold text-slate-800 group-hover:text-blue-700 transition-colors">
                           {p.projectName || p.tenderName || "Unnamed Project"}
                         </h3>
                         <p className="text-sm text-slate-500">{p.details?.executive_summary?.substring(0, 80)}...</p>
                       </div>
                     </div>
                     <MessageSquare className="w-5 h-5 text-slate-300 group-hover:text-blue-500" />
                   </div>
                ))
             )}
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-slate-50 relative">
      <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-4 sticky top-0 z-10 shadow-sm">
         <button onClick={() => setSelectedProject(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
           <ArrowLeft className="w-5 h-5" />
         </button>
         <div>
            <h2 className="font-bold text-slate-800 truncate">{selectedProject.projectName || selectedProject.tenderName || "Project Chat"}</h2>
            <p className="text-xs text-blue-600 font-medium">Tender AI Assistant</p>
         </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
         {messages.length === 0 ? (
           <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
              <MessageSquare className="w-12 h-12 mb-3 opacity-30 text-blue-500" />
              <p className="text-sm">Ask anything about this specific project.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-sm">
                <button onClick={() => setChatInput("What is the exact EMD amount and deadline?")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">EMD & Deadlines?</button>
                <button onClick={() => setChatInput("Summarize the specific technical eligibility criteria.")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">Technical Eligibility?</button>
              </div>
           </div>
         ) : (
           messages.map((msg, i) => (
             <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
               <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-4 text-sm shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                  <div className={msg.role === 'user' ? "prose prose-sm prose-invert max-w-none" : "prose prose-sm max-w-none prose-blue"}>
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                  </div>
               </div>
             </div>
           ))
         )}
         {chatLoading && (
           <div className="flex justify-start">
              <div className="bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-bl-sm p-4 text-sm shadow-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing project knowledge base...
              </div>
           </div>
         )}
         <div ref={chatBottomRef} />
      </div>
      
      <div className="p-4 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end gap-2 max-w-5xl mx-auto border border-slate-300 rounded-2xl px-2 py-2 bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all shadow-sm">
            <textarea 
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              className="flex-1 bg-transparent px-3 py-2 outline-none text-sm resize-none"
              placeholder="Message AI about this project..."
              rows={2}
            />
            <button 
              onClick={handleSendMessage}
              disabled={!chatInput.trim() || chatLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 transition-colors shadow-sm mb-0.5"
            >
              <Send className="w-4 h-4 -ml-0.5" />
            </button>
          </div>
      </div>
    </div>
  );
}
