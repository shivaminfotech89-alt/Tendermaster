import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { db } from "../lib/firebase";
import {
  collection, doc, getDocs, query, orderBy, where,
  updateDoc, addDoc, Timestamp, limit,
} from "firebase/firestore";
import {
  Users, Activity, Search, ChevronDown, ChevronRight,
  FileText, CreditCard, Loader2, CheckCircle2, AlertCircle,
  ArrowLeft, Shield,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { fetchWithAuth } from "../lib/api";

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN");
}

function fmtDate(v: any): string {
  if (!v) return "—";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function creditsLabel(total: number, used: number): string {
  const left = total - used;
  if (total === 0) return "No analyses";
  return `${left} / ${total} left`;
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    superadmin: "bg-purple-100 text-purple-700",
    admin: "bg-blue-100 text-blue-700",
    premium: "bg-amber-100 text-amber-700",
    free: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${styles[role] || styles.free}`}>
      {role}
    </span>
  );
}

// ── types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email?: string;
  name?: string;
  phone?: string;
  role: string;
  creditsTotal?: number;
  creditsUsed?: number;
  creditsExpiry?: any;
  createdAt?: any;
  trialClaimed?: boolean;
}

interface Project { id: string; projectName: string; savedAt: any; analysisRuns: number; }
interface Payment { paymentId: string; credits: number; processedAt: string | null; isAdminGrant: boolean; }

// ── main component ───────────────────────────────────────────────────────────

export default function AdminPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"users" | "activity">("users");

  // ── users list ─────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserRow)));
    } catch (e) { console.error(e); }
    setUsersLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || (u.email || "").toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q);
  });

  // ── per-user drawer ────────────────────────────────────────────────────────
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<"projects" | "payments">("projects");
  const [drawerProjects, setDrawerProjects] = useState<Project[]>([]);
  const [drawerPayments, setDrawerPayments] = useState<Payment[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const openDrawer = async (uid: string) => {
    if (expandedUid === uid) { setExpandedUid(null); return; }
    setExpandedUid(uid);
    setDrawerTab("projects");
    setDrawerLoading(true);
    try {
      const [projSnap, payRes] = await Promise.all([
        getDocs(query(collection(db, "saved_tenders"), where("userId", "==", uid), orderBy("savedAt", "desc"), limit(20))),
        fetchWithAuth(`/api/admin/user-payments?uid=${encodeURIComponent(uid)}`),
      ]);
      setDrawerProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      if (payRes.ok) {
        const data = await payRes.json();
        setDrawerPayments(data.payments || []);
      }
    } catch (e) { console.error(e); }
    setDrawerLoading(false);
  };

  // ── actions ────────────────────────────────────────────────────────────────
  const [grantInputs, setGrantInputs] = useState<Record<string, string>>({});

  const logAction = async (action: string, details: Record<string, any>) => {
    try {
      await addDoc(collection(db, "activity_logs"), {
        action,
        by: user?.email,
        byUid: user?.uid,
        timestamp: Timestamp.now(),
        ...details,
      });
    } catch (e) { console.warn("Failed to log admin action", e); }
  };

  const handleGrant = async (u: UserRow, amount: number) => {
    if (!amount || amount < 1) { toast.error("Enter a valid number of analyses"); return; }
    try {
      const res = await fetchWithAuth("/api/admin/grant-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: u.id, credits: amount }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const newBalance = (u.creditsTotal || 0) + amount - (u.creditsUsed || 0);
      toast.success(`${amount} ${amount === 1 ? "analysis" : "analyses"} added to ${u.email}. New balance: ${newBalance} ${newBalance === 1 ? "analysis" : "analyses"}.`);
      await logAction("GRANT_ANALYSES", { targetUid: u.id, targetEmail: u.email, credits: amount });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, creditsTotal: (x.creditsTotal || 0) + amount } : x));
      setGrantInputs(prev => ({ ...prev, [u.id]: "" }));
    } catch (e: any) { toast.error(e.message); }
  };

  const handleRoleUpdate = async (u: UserRow, newRole: string) => {
    try {
      await updateDoc(doc(db, "users", u.id), { role: newRole });
      await logAction("UPDATE_ROLE", { targetUid: u.id, targetEmail: u.email, newRole });
      toast.success(`Role set to ${newRole}`);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
    } catch (e: any) { toast.error(e.message); }
  };

  // ── activity log ───────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "activity") return;
    setLogsLoading(true);
    getDocs(query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(100)))
      .then(snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(console.error)
      .finally(() => setLogsLoading(false));
  }, [activeTab]);

  // ── stat cards ─────────────────────────────────────────────────────────────
  const totalUsers = users.length;
  const activeUsers = users.filter(u => {
    if (u.role === "admin" || u.role === "superadmin") return true;
    const left = (u.creditsTotal || 0) - (u.creditsUsed || 0);
    const exp = u.creditsExpiry?.toDate ? u.creditsExpiry.toDate() : null;
    return left > 0 && (!exp || exp > new Date());
  }).length;
  const trialUsers = users.filter(u => u.trialClaimed).length;

  const TAB_CLS = (t: string) =>
    `px-4 py-2 rounded-md font-medium text-sm transition-colors whitespace-nowrap ${activeTab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      {/* header */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-600" /> Admin Control Center
          </h1>
          <p className="text-slate-500 mt-1">User management, credit grants, and activity log.</p>
        </div>
        <button onClick={() => window.history.back()} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium text-sm border border-slate-200">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      {/* stat cards */}
      {!usersLoading && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Users", value: totalUsers, color: "text-blue-400" },
            { label: "Active Analyses", value: activeUsers, color: "text-emerald-400" },
            { label: "Trial Used", value: trialUsers, color: "text-amber-400" },
          ].map(c => (
            <div key={c.label} className="bg-slate-900 text-white p-5 rounded-xl border border-slate-800">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{c.label}</p>
              <p className={`text-3xl font-black ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* tabs */}
      <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200 mb-8 w-fit">
        <button onClick={() => setActiveTab("users")} className={TAB_CLS("users")}>
          <Users className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Users
        </button>
        <button onClick={() => setActiveTab("activity")} className={TAB_CLS("activity")}>
          <Activity className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Activity Log
        </button>
      </div>

      {/* ── USERS TAB ── */}
      {activeTab === "users" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by email or name…"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <span className="text-xs text-slate-400">{filtered.length} of {users.length}</span>
          </div>

          {usersLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map(u => {
                const isExpanded = expandedUid === u.id;
                const isAdminUser = u.role === "admin" || u.role === "superadmin";
                const credTotal = u.creditsTotal || 0;
                const credUsed = u.creditsUsed || 0;
                const expiry = u.creditsExpiry?.toDate ? u.creditsExpiry.toDate() : null;
                const expired = expiry && expiry < new Date();

                return (
                  <div key={u.id}>
                    {/* row */}
                    <div
                      className="grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 p-4 hover:bg-slate-50/60 cursor-pointer items-center"
                      onClick={() => openDrawer(u.id)}
                    >
                      {/* identity */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm truncate">{u.name || "—"}</span>
                          <RoleBadge role={u.role} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{u.email}</div>
                      </div>
                      {/* credits */}
                      <div className="hidden md:block text-sm">
                        {isAdminUser ? (
                          <span className="text-blue-600 font-semibold text-xs">Unlimited</span>
                        ) : credTotal === 0 ? (
                          <span className="text-slate-400 text-xs">No plan</span>
                        ) : (
                          <div>
                            <span className={`font-semibold text-sm ${expired ? "text-red-500" : "text-slate-800"}`}>
                              {credTotal - credUsed} / {credTotal}
                            </span>
                            <div className="text-[10px] text-slate-400 mt-0.5">{expiry ? `Exp ${fmtDate(expiry)}` : "No expiry"}</div>
                          </div>
                        )}
                      </div>
                      {/* signup */}
                      <div className="hidden md:block text-xs text-slate-500">{fmtDate(u.createdAt)}</div>
                      {/* actions (stop propagation) */}
                      <div className="hidden md:flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                        {u.role !== "admin" && (
                          <button onClick={() => handleRoleUpdate(u, "admin")} className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold rounded hover:bg-blue-100 whitespace-nowrap">→ Admin</button>
                        )}
                        {u.role !== "free" && u.role !== "superadmin" && (
                          <button onClick={() => handleRoleUpdate(u, "free")} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded hover:bg-slate-200">→ Free</button>
                        )}
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            value={grantInputs[u.id] || ""}
                            onChange={e => setGrantInputs(prev => ({ ...prev, [u.id]: e.target.value }))}
                            placeholder="N"
                            className="w-12 border border-slate-200 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-emerald-400 outline-none"
                          />
                          <button
                            onClick={() => handleGrant(u, parseInt(grantInputs[u.id] || "0"))}
                            className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded hover:bg-emerald-100 whitespace-nowrap"
                          >
                            Grant
                          </button>
                        </div>
                      </div>
                      {/* expand chevron */}
                      <div className="text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </div>

                    {/* ── expandable drawer ── */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-4 pb-4 pt-3">
                        {/* mobile actions */}
                        <div className="flex md:hidden flex-wrap gap-2 mb-3" onClick={e => e.stopPropagation()}>
                          {u.role !== "admin" && (
                            <button onClick={() => handleRoleUpdate(u, "admin")} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded hover:bg-blue-100">→ Admin</button>
                          )}
                          {u.role !== "free" && u.role !== "superadmin" && (
                            <button onClick={() => handleRoleUpdate(u, "free")} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded hover:bg-slate-200">→ Free</button>
                          )}
                          <div className="flex items-center gap-1">
                            <input type="number" min={1} value={grantInputs[u.id] || ""} onChange={e => setGrantInputs(prev => ({ ...prev, [u.id]: e.target.value }))} placeholder="N" className="w-14 border border-slate-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-400 outline-none" />
                            <button onClick={() => handleGrant(u, parseInt(grantInputs[u.id] || "0"))} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded hover:bg-emerald-100">Grant</button>
                          </div>
                        </div>

                        {/* drawer tabs */}
                        <div className="flex gap-4 border-b border-slate-200 mb-3">
                          <button onClick={() => setDrawerTab("projects")} className={`pb-2 text-xs font-semibold border-b-2 transition-colors ${drawerTab === "projects" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
                            <FileText className="w-3.5 h-3.5 inline mr-1" />Projects
                          </button>
                          <button onClick={() => setDrawerTab("payments")} className={`pb-2 text-xs font-semibold border-b-2 transition-colors ${drawerTab === "payments" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>
                            <CreditCard className="w-3.5 h-3.5 inline mr-1" />Payments
                          </button>
                        </div>

                        {drawerLoading ? (
                          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                        ) : drawerTab === "projects" ? (
                          drawerProjects.length === 0 ? (
                            <p className="text-xs text-slate-400 py-4 text-center">No projects yet.</p>
                          ) : (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                              {drawerProjects.map(p => (
                                <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-white rounded border border-slate-200 text-xs">
                                  <span className="font-medium text-slate-700 truncate flex-1 mr-3">{p.projectName || "Untitled"}</span>
                                  <span className="text-slate-400 shrink-0">{fmtDate(p.savedAt)} · {p.analysisRuns} run{p.analysisRuns !== 1 ? "s" : ""}</span>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          drawerPayments.length === 0 ? (
                            <p className="text-xs text-slate-400 py-4 text-center">No payment records.</p>
                          ) : (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                              {drawerPayments.map((p, i) => (
                                <div key={i} className="flex items-center justify-between px-3 py-2 bg-white rounded border border-slate-200 text-xs">
                                  <div>
                                    <span className={`font-bold ${p.isAdminGrant ? "text-purple-600" : "text-emerald-700"}`}>
                                      {p.isAdminGrant ? "Admin grant" : "Payment"}
                                    </span>
                                    <span className="text-slate-500 ml-2">+{p.credits} {p.credits === 1 ? "analysis" : "analyses"}</span>
                                  </div>
                                  <span className="text-slate-400">{fmtDate(p.processedAt)}</span>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {activeTab === "activity" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-500" /> Recent Admin Actions
            </h2>
          </div>
          {logsLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : logs.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">No activity yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {logs.map(log => (
                <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${log.action?.includes("GRANT") ? "bg-emerald-400" : log.action?.includes("ROLE") ? "bg-blue-400" : "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{log.action}</span>
                      {log.targetEmail && <span className="text-xs text-slate-500">→ {log.targetEmail}</span>}
                      {log.credits && <span className="text-xs font-semibold text-emerald-600">+{log.credits} analyses</span>}
                      {log.newRole && <span className="text-xs font-semibold text-blue-600">{log.newRole}</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">by {log.by} · {fmtDate(log.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
