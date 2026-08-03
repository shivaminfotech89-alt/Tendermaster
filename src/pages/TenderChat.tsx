import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { collection, query, where, getDocs, addDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../auth/AuthProvider";
import { MessageSquare, Search, Send, Loader2, ArrowLeft, FolderOpen, Trash2, IndianRupee, Calendar, Clock } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "../lib/api";

interface ChatMsg {
  role: 'user' | 'model';
  text: string;
  createdAt?: Date;
}

function fmtTs(d?: Date): string {
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDate(ts: any): string {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function TenderChat() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  // Most-recent chat_messages timestamp per projectId (ms since epoch) —
  // read-only, derived from the existing chat_messages collection (no new
  // field, no write-path change to handleSendMessage/the chat endpoint).
  // Covers historical conversations retroactively, not just ones sent after
  // this feature shipped. Powers PART 1's "recently-chatted bubbles to the
  // top" ordering below.
  const [lastChatMap, setLastChatMap] = useState<Map<string, number>>(new Map());

  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
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
    async function loadLastChatActivity() {
      if (!user) return;
      try {
        const q = query(collection(db, "chat_messages"), where("userId", "==", user.uid));
        const snap = await getDocs(q);
        const map = new Map<string, number>();
        for (const d of snap.docs) {
          const data = d.data() as any;
          const pid = data.projectId as string | undefined;
          const ms = data.createdAt?.toMillis?.() ?? 0;
          if (!pid || !ms) continue;
          const existing = map.get(pid) ?? 0;
          if (ms > existing) map.set(pid, ms);
        }
        setLastChatMap(map);
      } catch (err) {
        console.error("Failed to load chat activity for ordering:", err);
      }
    }
    loadLastChatActivity();
  }, [user]);

  // "Ask AI about this" from the expanded Tender Overview (ProjectDetails.tsx)
  // navigates here with { projectId, starterPrompt } in router state. Once
  // `projects` has loaded, auto-select the matching project and pre-fill
  // the input (never auto-sent — the user reviews/edits first, same as the
  // existing prompt-chip pattern below). The state is cleared immediately
  // after use via a replace-navigation so a later manual back/forward nav
  // can't re-trigger it.
  useEffect(() => {
    const navState = location.state as { projectId?: string; starterPrompt?: string } | null;
    if (!navState?.projectId || loading) return;
    const match = projects.find(p => p.id === navState.projectId);
    if (match) {
      setSelectedProject(match);
      loadChatHistory(match.id);
      if (navState.starterPrompt) setChatInput(navState.starterPrompt);
    }
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, loading]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // PART 1 ordering: recently-chatted projects first (most recent chat
  // activity at the top, derived from lastChatMap), then everything else
  // by newest-created (savedAt) — same field/direction Projects.tsx uses
  // as its own "Newest" default, for consistency across the app.
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aChat = lastChatMap.get(a.id);
      const bChat = lastChatMap.get(b.id);
      if (aChat != null && bChat != null) return bChat - aChat;
      if (aChat != null) return -1;
      if (bChat != null) return 1;
      return (b.savedAt?.toMillis?.() ?? 0) - (a.savedAt?.toMillis?.() ?? 0);
    });
  }, [projects, lastChatMap]);

  const filteredProjects = useMemo(() => {
    const q = search.toLowerCase();
    return sortedProjects.filter(p =>
      (p.projectName || p.tenderName || "").toLowerCase().includes(q)
    );
  }, [sortedProjects, search]);

  const loadChatHistory = async (pid: string) => {
    if (!user) return;
    setMessages([]);
    try {
      const q = query(collection(db, "chat_messages"), where("userId", "==", user.uid), where("projectId", "==", pid));
      const snap = await getDocs(q);
      const msgs: ChatMsg[] = snap.docs
        .map(d => d.data() as any)
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
        .map(d => ({
          role: d.role as 'user' | 'model',
          text: d.text as string,
          createdAt: d.createdAt?.toDate?.() as Date | undefined,
        }));
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load chat history:", e);
    }
  };

  const handleClearChat = async () => {
    if (!selectedProject || !user) return;
    try {
      const q = query(collection(db, "chat_messages"), where("userId", "==", user.uid), where("projectId", "==", selectedProject.id));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setMessages([]);
      setShowClearModal(false);
    } catch (e) {
      console.error("Failed to clear chat:", e);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading || !selectedProject) return;

    const userText = chatInput;
    const userMsg: ChatMsg = { role: 'user', text: userText, createdAt: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    if (user) {
      addDoc(collection(db, "chat_messages"), {
        userId: user.uid,
        projectId: selectedProject.id,
        role: 'user',
        text: userText,
        createdAt: serverTimestamp(),
      }).catch(e => console.error("Failed to save user message:", e));
    }

    try {
      const res = await fetchWithAuth("/api/chat-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderDocument: JSON.stringify(selectedProject.details),
          analysisResult: selectedProject.details,
          messages: newMessages.map(m => ({ role: m.role, text: m.text })),
          language: i18n.language
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("Server returned an invalid response. This is usually caused by the file being too large (max 4.5MB) or taking too long to process (Vercel 60s timeout). Please try a smaller document.");
      }
      if (!res.ok) throw new Error(data.error);

      const aiText = data.answer || data.reply;
      const aiMsg: ChatMsg = { role: 'model', text: aiText, createdAt: new Date() };
      setMessages([...newMessages, aiMsg]);

      if (user) {
        addDoc(collection(db, "chat_messages"), {
          userId: user.uid,
          projectId: selectedProject.id,
          role: 'model',
          text: aiText,
          createdAt: serverTimestamp(),
        }).catch(e => console.error("Failed to save AI message:", e));
      }
    } catch(err: any) {
      console.error("Chat Error:", err);
      setMessages([...newMessages, { role: 'model', text: `Error: ${err.message}`, createdAt: new Date() }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  if (role === 'free') {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 flex items-center justify-center min-h-[60vh]">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md text-center">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">{t("locked_feature")}</h2>
          <p className="text-slate-600 mb-6">{t("premium_required")}</p>
          <button
            onClick={() => window.location.href = '/dashboard/profile'}
            className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-lg font-bold shadow-sm transition-colors w-full"
          >
            {t("upgrade_to_premium")}
          </button>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-indigo-600" />
          {t('chat_select_project_title')}
        </h1>
        <p className="text-slate-500 mb-6">{t('chat_select_project_subtitle')}</p>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col items-center">
          <div className="w-full p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder={t('chat_search_placeholder')}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="w-full divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <div className="p-8 text-center text-slate-500">{t('chat_no_projects_found')}</div>
            ) : (
              filteredProjects.map(p => {
                const recentlyChatted = lastChatMap.has(p.id);
                const score = p.details?.compatibility?.score;
                const tenderValue = p.details?.tender_simplified?.tender_value;
                return (
                  <div
                    key={p.id}
                    onClick={() => { setSelectedProject(p); loadChatHistory(p.id); }}
                    className="p-4 hover:bg-indigo-50/60 cursor-pointer flex items-center justify-between gap-3 group transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${recentlyChatted ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                        <FolderOpen className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="font-bold text-slate-800 group-hover:text-indigo-700 transition-colors truncate min-w-0">
                            {p.projectName || p.tenderName || t('chat_unnamed_project')}
                          </h3>
                          {recentlyChatted && (
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 whitespace-nowrap">
                              <Clock className="w-2.5 h-2.5" /> {t('chat_recently_chatted')}
                            </span>
                          )}
                          {score != null && (
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${score >= 80 ? 'bg-emerald-100 text-emerald-800' : score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                              {t('match_score')}: {score}/100
                            </span>
                          )}
                        </div>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400">
                          {tenderValue && (
                            <span className="flex items-center gap-1 min-w-0">
                              <IndianRupee className="w-3 h-3 shrink-0" />
                              <span className="truncate">{tenderValue}</span>
                            </span>
                          )}
                          {p.savedAt && (
                            <span className="flex items-center gap-1 shrink-0">
                              <Calendar className="w-3 h-3" /> {t('saved')} {fmtDate(p.savedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <MessageSquare className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 shrink-0" />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full min-h-[calc(100vh-160px)] md:min-h-[calc(100vh-64px)] flex flex-col bg-slate-50 relative">
        <div className="bg-white border-b border-slate-200 p-4 flex items-center gap-4 sticky top-0 z-10 shadow-sm">
          <button onClick={() => setSelectedProject(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-800 truncate">{selectedProject.projectName || selectedProject.tenderName || "Project Chat"}</h2>
            <p className="text-xs text-blue-600 font-medium">Tender AI Assistant</p>
          </div>
          <button
            onClick={() => { if (messages.length > 0) setShowClearModal(true); }}
            className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 border border-slate-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
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
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-4 text-sm shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                  <div className={msg.role === 'user' ? "prose prose-sm prose-invert max-w-none" : "prose prose-sm max-w-none prose-blue"}>
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                  </div>
                </div>
                {msg.createdAt && (
                  <span className="text-[10px] text-slate-400 mt-0.5 px-1">{fmtTs(msg.createdAt)}</span>
                )}
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

      {showClearModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Clear Chat History?</h3>
            <p className="text-slate-600 mb-6">All messages for this project will be permanently deleted.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowClearModal(false)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleClearChat} className="px-4 py-2 font-medium bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-sm flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Clear Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
