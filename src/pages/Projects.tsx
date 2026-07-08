import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { FileSearch, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot, doc, deleteDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

function fmtDate(ts: any): string {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [savedTenders, setSavedTenders] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "saved_tenders"), where("userId", "==", user.uid));
    const unsubscribeTenders = onSnapshot(q, (snapshot) => {
       const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
       // sort descending
       docs.sort((a, b) => b.savedAt?.toMillis() - a.savedAt?.toMillis());
       setSavedTenders(docs);
    });
    return () => unsubscribeTenders();
  }, [user]);

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteDoc(doc(db, "saved_tenders", deletingId));
      setDeletingId(null);
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your Projects Pipeline</h1>
        <p className="text-slate-500 mt-1">Manage and track your saved tenders and analyses.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[24rem]">
        {savedTenders.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
             <FileSearch className="w-12 h-12 mb-4 opacity-50" />
             <p>No projects found. Start by analyzing a new tender.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto p-0">
              <table className="w-full text-left text-sm border-collapse">
               <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                   <th className="p-4 pl-6">Project Name</th>
                   <th className="p-4">Authority & Target</th>
                   <th className="p-4">Tender Value</th>
                   <th className="p-4">Closing Date</th>
                   <th className="p-4">Match</th>
                   <th className="p-4">Win Prob</th>
                   <th className="p-4">Status</th>
                   <th className="p-4 pr-6 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {savedTenders.map(t => {
                     const tenderTitle = t.details?.tender_simplified?.tender_name || t.projectName || "Unnamed Tender";
                     const authorityName = t.details?.tender_simplified?.authority_name || "Unknown Authority";
                     const tenderValue = t.details?.tender_simplified?.tender_value || t.details?.financial_estimate?.total_estimated_cost || "N/A";
                     const closingDate = t.details?.timeline_and_milestones?.submission_deadline || "TBD";
                     const isActive = t.details?.tender_simplified?.is_active ?? true;
                     
                     return (
                    <tr key={t.id} className="hover:bg-slate-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/dashboard/projects/${t.id}`)}>
                       <td className="p-4 pl-6 font-medium text-slate-900 max-w-xs">
                         <div className="line-clamp-2 text-sm text-blue-800 font-bold mb-1">{t.projectName || "Unnamed Project"}</div>
                         <div className="text-xs text-slate-500 line-clamp-1" title={tenderTitle}>{tenderTitle}</div>
                         {t.savedAt && <div className="text-[10px] text-slate-400 mt-0.5">Saved {fmtDate(t.savedAt)}</div>}
                       </td>
                       <td className="p-4 text-slate-700 max-w-xs">
                         <div className="line-clamp-2 text-sm">{authorityName}</div>
                       </td>
                       <td className="p-4 text-slate-800 font-medium">
                          {tenderValue}
                       </td>
                       <td className="p-4 text-slate-700">
                          <div className="text-sm">{closingDate}</div>
                       </td>
                       <td className="p-4">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${t.details?.compatibility?.score >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>
                            {t.details?.compatibility?.score || 0}/100
                          </span>
                       </td>
                       <td className="p-4">
                          <span className="font-bold text-slate-800">
                             {t.details?.winning_probability?.score ? `${t.details.winning_probability.score}%` : '-'}
                          </span>
                       </td>
                       <td className="p-4">
                          {isActive && closingDate !== "TBD" ? (
                            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded w-fit">
                               <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                               Active
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded w-fit">
                               <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                               Closed / TBD
                            </div>
                          )}
                       </td>
                       <td className="p-4 pr-6 text-right">
                         <button onClick={(e) => {
                           e.stopPropagation();
                           setDeletingId(t.id);
                         }} className="p-2 font-medium rounded transition-colors text-red-600 bg-red-50 hover:bg-red-100">
                           Delete
                         </button>
                       </td>
                    </tr>
                  )})}
               </tbody>
             </table>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Delete Project?</h3>
            <p className="text-slate-600 mb-6">
              Are you sure you want to remove this project from your pipeline? All associated data, documents, and chat history will be permanently deleted.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmDelete}
                className="px-4 py-2 font-medium bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
