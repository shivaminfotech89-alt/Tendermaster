import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { FileSearch, Trash2, Search, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot, doc, deleteDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

function fmtDate(ts: any): string {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type SortBy = 'savedAt' | 'name' | 'deadline' | 'score';
type SortDir = 'asc' | 'desc';

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [savedTenders, setSavedTenders] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>('savedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "saved_tenders"), where("userId", "==", user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      setSavedTenders(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[]);
    });
    return () => unsub();
  }, [user]);

  const handleSort = (by: SortBy) => {
    if (sortBy === by) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(by);
      setSortDir(by === 'name' || by === 'deadline' ? 'asc' : 'desc');
    }
  };

  const sortedTenders = useMemo(() => {
    const arr = [...savedTenders];
    arr.sort((a, b) => {
      if (sortBy === 'deadline') {
        const da: string | undefined = a.details?.timeline_and_milestones?.submission_deadline;
        const db_d: string | undefined = b.details?.timeline_and_milestones?.submission_deadline;
        const aIsTbd = !da || da === 'TBD';
        const bIsTbd = !db_d || db_d === 'TBD';
        if (aIsTbd && bIsTbd) return 0;
        if (aIsTbd) return 1;
        if (bIsTbd) return -1;
        const cmp = new Date(da!).getTime() - new Date(db_d!).getTime();
        return sortDir === 'desc' ? -cmp : cmp;
      }
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = (a.projectName || '').localeCompare(b.projectName || '');
          break;
        case 'score':
          cmp = (a.details?.compatibility?.score || 0) - (b.details?.compatibility?.score || 0);
          break;
        default:
          cmp = (a.savedAt?.toMillis() || 0) - (b.savedAt?.toMillis() || 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [savedTenders, sortBy, sortDir]);

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteDoc(doc(db, "saved_tenders", deletingId));
      setDeletingId(null);
    } catch (err: any) {
      console.error(err);
    }
  };

  const filteredTenders = searchQuery.trim()
    ? sortedTenders.filter(t => {
        const q = searchQuery.toLowerCase();
        return (
          (t.projectName || "").toLowerCase().includes(q) ||
          (t.details?.tender_simplified?.tender_name || "").toLowerCase().includes(q) ||
          (t.details?.tender_simplified?.tender_id || "").toLowerCase().includes(q) ||
          (t.details?.tender_simplified?.authority_name || "").toLowerCase().includes(q) ||
          (t.details?.tender_simplified?.is_active ? "active" : "closed").includes(q)
        );
      })
    : sortedTenders;

  const sortPills: { by: SortBy; label: string }[] = [
    { by: 'savedAt', label: 'Newest' },
    { by: 'name', label: 'Name' },
    { by: 'deadline', label: 'Deadline' },
    { by: 'score', label: 'Match' },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your Projects Pipeline</h1>
        <p className="text-slate-500 mt-1">Manage and track your saved tenders and analyses.</p>
      </div>

      {/* Controls: sort pills + search */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Sort:</span>
          {sortPills.map(({ by, label }) => (
            <button
              key={by}
              onClick={() => handleSort(by)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all flex items-center gap-1 ${
                sortBy === by
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:text-indigo-600'
              }`}
            >
              {label}
              {sortBy === by && <span className="text-[10px] leading-none">{sortDir === 'asc' ? '▲' : '▼'}</span>}
            </button>
          ))}
        </div>
        <div className="relative max-w-sm w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, authority, tender ID…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Empty state — no projects at all */}
      {savedTenders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400 p-16 min-h-[24rem]">
          <FileSearch className="w-12 h-12 mb-4 opacity-40" />
          <p className="font-semibold text-slate-700 text-lg mb-1">No projects yet</p>
          <p className="text-sm text-slate-400 mb-6">Analyze your first tender to get started.</p>
          <Link
            to="/dashboard/analyzer"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors shadow-sm"
          >
            Analyze a Tender
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {filteredTenders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-slate-400 p-8 min-h-[16rem]">
              <Search className="w-12 h-12 mb-4 opacity-50" />
              <p className="font-medium text-slate-700">No projects match "{searchQuery}"</p>
              <p className="text-sm mt-1">Try a different keyword or <button onClick={() => setSearchQuery("")} className="text-indigo-600 underline">clear the search</button>.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-4 pl-6 w-10 text-center text-xs">#</th>
                      <th className="p-4">Project Name</th>
                      <th className="p-4">Tender / Authority</th>
                      <th className="p-4">Match</th>
                      <th className="p-4">Deadline</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 pr-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTenders.map((t, index) => {
                      const tenderTitle = t.details?.tender_simplified?.tender_name || t.projectName || "Unnamed Tender";
                      const tenderId = t.details?.tender_simplified?.tender_id;
                      const authorityName = t.details?.tender_simplified?.authority_name || "Unknown Authority";
                      const closingDate = t.details?.timeline_and_milestones?.submission_deadline || "TBD";
                      const score = t.details?.compatibility?.score;
                      const isActive = t.details?.tender_simplified?.is_active ?? true;
                      return (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                          onClick={() => navigate(`/dashboard/projects/${t.id}`)}
                        >
                          <td className="p-4 pl-6 text-center text-slate-400 font-medium text-xs tabular-nums">{index + 1}</td>
                          <td className="p-4 max-w-xs">
                            <div className="line-clamp-1 text-sm text-blue-800 font-bold mb-0.5">{t.projectName || "Unnamed Project"}</div>
                            {t.savedAt && <div className="text-[10px] text-slate-400">Saved {fmtDate(t.savedAt)}</div>}
                          </td>
                          <td className="p-4 max-w-xs">
                            <div className="text-sm font-semibold text-slate-800 line-clamp-1">{authorityName}</div>
                            {tenderId
                              ? <div className="text-xs text-slate-400 mt-0.5">{tenderId}</div>
                              : <div className="text-xs text-slate-400 mt-0.5 line-clamp-1" title={tenderTitle}>{tenderTitle}</div>
                            }
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${score >= 80 ? 'bg-emerald-100 text-emerald-800' : score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'}`}>
                              {score != null ? `${score}/100` : '-'}
                            </span>
                          </td>
                          <td className="p-4 text-sm text-slate-700 whitespace-nowrap">{closingDate}</td>
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
                            <button
                              onClick={e => { e.stopPropagation(); setDeletingId(t.id); }}
                              className="p-2 font-medium rounded transition-colors text-red-600 bg-red-50 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredTenders.map((t, index) => {
                  const tenderId = t.details?.tender_simplified?.tender_id;
                  const authorityName = t.details?.tender_simplified?.authority_name || "Unknown Authority";
                  const closingDate = t.details?.timeline_and_milestones?.submission_deadline || "TBD";
                  const score = t.details?.compatibility?.score;
                  const isActive = t.details?.tender_simplified?.is_active ?? true;
                  return (
                    <div
                      key={t.id}
                      className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/dashboard/projects/${t.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-xs text-slate-400 font-medium pt-0.5 shrink-0 tabular-nums">{index + 1}.</span>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-blue-800 line-clamp-2">{t.projectName || "Unnamed Project"}</div>
                            {t.savedAt && <div className="text-[10px] text-slate-400 mt-0.5">Saved {fmtDate(t.savedAt)}</div>}
                          </div>
                        </div>
                        {score != null && (
                          <span className={`px-2 py-1 rounded text-xs font-bold shrink-0 ${score >= 80 ? 'bg-emerald-100 text-emerald-800' : score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'}`}>
                            {score}/100
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-slate-700 mb-0.5">{authorityName}</div>
                      {tenderId && <div className="text-xs text-slate-400 mb-1">{tenderId}</div>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {isActive && closingDate !== "TBD" ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            Closed / TBD
                          </span>
                        )}
                        <span className="text-xs text-slate-500">Deadline: {closingDate}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setDeletingId(t.id); }}
                          className="ml-auto text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

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
