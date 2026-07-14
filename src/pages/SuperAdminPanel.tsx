import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { db } from "../lib/firebase";
import {
  collection, doc, getDocs, query, orderBy, limit, setDoc, getDoc,
  Timestamp, addDoc, updateDoc,
} from "firebase/firestore";
import {
  Shield, Users, BarChart2, DollarSign, TrendingUp,
  Activity, Settings, Loader2, ArrowLeft, AlertTriangle,
  CheckCircle2, Search, ChevronDown, ChevronRight,
  FileText, CreditCard, Info,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { fetchWithAuth } from "../lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(paise: number) {
  return "₹" + (paise / 100).toLocaleString("en-IN");
}

function fmtDate(v: any): string {
  if (!v) return "—";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function GapNotice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-slate-900 text-white p-5 rounded-xl border border-slate-800">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-black ${accent || "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
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

// ── types ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string; email?: string; name?: string; role: string;
  creditsTotal?: number; creditsUsed?: number; creditsExpiry?: any;
  createdAt?: any; trialClaimed?: boolean;
}

interface RevStats {
  allTime: {
    totalRevenuePaise: number;
    payingUsersCount: number;
    avgRevenuePaise: number;
    byPlan: Record<string, { count: number; revenuePaise: number }>;
  };
  thisMonth: { totalRevenuePaise: number; count: number };
  recentPayments: Array<{ uid: string; email?: string; paymentId: string; credits: number; processedAt: string | null; isAdminGrant: boolean }>;
}

interface UsageStats {
  daily: Array<{ date: string; totals: Record<string, number> }>;
  totals: Record<string, number>;
  topConsumers: Array<{ uid: string; email?: string; count: number }>;
  health: {
    failedEvents: Array<{ uid?: string; type: string; failureReason?: string; timestamp: any }>;
    paymentErrors: Array<{ email?: string; amountPaise?: number; timestamp: any }>;
    failedCount: number;
    lowConfidenceCount: number;
  };
}

type Tab = "users" | "revenue" | "usage" | "cost" | "funnel" | "health" | "settings";

// ── main component ────────────────────────────────────────────────────────────

export default function SuperAdminPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("users");

  // ── users ─────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<"projects" | "payments">("projects");
  const [drawerProjects, setDrawerProjects] = useState<any[]>([]);
  const [drawerPayments, setDrawerPayments] = useState<any[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [grantInputs, setGrantInputs] = useState<Record<string, string>>({});

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

  const logAction = async (action: string, details: Record<string, any>) => {
    try {
      await addDoc(collection(db, "activity_logs"), {
        action, by: user?.email, byUid: user?.uid, timestamp: Timestamp.now(), ...details,
      });
    } catch (e) { console.warn("Failed to log action", e); }
  };

  const handleGrant = async (u: UserRow, amount: number) => {
    if (!amount || amount < 1) { toast.error("Enter a valid number"); return; }
    try {
      const res = await fetchWithAuth("/api/admin/grant-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: u.id, credits: amount }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(`Granted ${amount} analyses to ${u.email}`);
      await logAction("GRANT_ANALYSES", { targetUid: u.id, targetEmail: u.email, credits: amount });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, creditsTotal: (x.creditsTotal || 0) + amount } : x));
      setGrantInputs(prev => ({ ...prev, [u.id]: "" }));
    } catch (e: any) { toast.error(e.message); }
  };

  const handleRoleUpdate = async (u: UserRow, newRole: string) => {
    try {
      await updateDoc(doc(db, "users", u.id), { role: newRole });
      await logAction("UPDATE_ROLE", { targetUid: u.id, targetEmail: u.email, newRole });
      toast.success(`Role → ${newRole}`);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
    } catch (e: any) { toast.error(e.message); }
  };

  const openDrawer = async (uid: string) => {
    if (expandedUid === uid) { setExpandedUid(null); return; }
    setExpandedUid(uid);
    setDrawerTab("projects");
    setDrawerLoading(true);
    try {
      const [projSnap, payRes] = await Promise.all([
        getDocs(query(collection(db, "saved_tenders"), orderBy("savedAt", "desc"), limit(200))),
        fetchWithAuth(`/api/admin/user-payments?uid=${encodeURIComponent(uid)}`),
      ]);
      const allProj = projSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setDrawerProjects(allProj.filter((p: any) => p.userId === uid).slice(0, 20));
      if (payRes.ok) { const data = await payRes.json(); setDrawerPayments(data.payments || []); }
    } catch (e) { console.error(e); }
    setDrawerLoading(false);
  };

  // ── revenue ────────────────────────────────────────────────────────────────
  const [rev, setRev] = useState<RevStats | null>(null);
  const [revLoading, setRevLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "revenue" || rev) return;
    setRevLoading(true);
    fetchWithAuth("/api/admin/revenue-stats")
      .then(r => r.json())
      .then(setRev)
      .catch(console.error)
      .finally(() => setRevLoading(false));
  }, [activeTab, rev]);

  // ── usage ──────────────────────────────────────────────────────────────────
  const [usageDays, setUsageDays] = useState(14);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const fetchUsage = useCallback(() => {
    setUsageLoading(true);
    setUsage(null);
    fetchWithAuth(`/api/admin/usage-stats?days=${usageDays}`)
      .then(r => r.json())
      .then(setUsage)
      .catch(console.error)
      .finally(() => setUsageLoading(false));
  }, [usageDays]);

  useEffect(() => {
    if (activeTab !== "usage" && activeTab !== "health") return;
    fetchUsage();
  }, [activeTab, fetchUsage]);

  // ── cost & margin ─────────────────────────────────────────────────────────
  const [costPerAnalysis, setCostPerAnalysis] = useState("");
  const [actualBillRs, setActualBillRs] = useState("");
  const [costSaving, setCostSaving] = useState(false);

  useEffect(() => {
    if (activeTab !== "cost") return;
    getDoc(doc(db, "system_settings", "billing"))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.costPerAnalysisRs) setCostPerAnalysis(String(d.costPerAnalysisRs));
          if (d.actualMonthlyBillRs) setActualBillRs(String(d.actualMonthlyBillRs));
        }
      })
      .catch(console.error);
  }, [activeTab]);

  const saveBillingSettings = async () => {
    setCostSaving(true);
    try {
      await setDoc(doc(db, "system_settings", "billing"), {
        costPerAnalysisRs: parseFloat(costPerAnalysis) || null,
        actualMonthlyBillRs: parseFloat(actualBillRs) || null,
        updatedAt: Timestamp.now(),
        updatedBy: user?.email,
      }, { merge: true });
      toast.success("Billing settings saved");
    } catch (e: any) { toast.error(e.message); }
    setCostSaving(false);
  };

  // ── settings ───────────────────────────────────────────────────────────────
  const [sysSettings, setSysSettings] = useState<any>(null);
  const [settSaving, setSettSaving] = useState(false);

  useEffect(() => {
    if (activeTab !== "settings") return;
    getDoc(doc(db, "system_settings", "config"))
      .then(snap => { if (snap.exists()) setSysSettings(snap.data()); else setSysSettings({}); })
      .catch(console.error);
  }, [activeTab]);

  const saveSysSettings = async () => {
    if (!sysSettings) return;
    setSettSaving(true);
    try {
      await setDoc(doc(db, "system_settings", "config"), { ...sysSettings, updatedAt: Timestamp.now() }, { merge: true });
      toast.success("Settings saved");
    } catch (e: any) { toast.error(e.message); }
    setSettSaving(false);
  };

  // ── funnel ─────────────────────────────────────────────────────────────────
  const totalUsers = users.length;
  const trialUsers = users.filter(u => u.trialClaimed).length;
  const payingUsers = rev?.allTime.payingUsersCount ?? null;
  const pct = (n: number | null, d: number) => (!n || !d) ? "—" : `${((n / d) * 100).toFixed(1)}%`;

  // ── tab config ────────────────────────────────────────────────────────────
  const TABS: Array<{ id: Tab; label: string; Icon: any }> = [
    { id: "users", label: "Users", Icon: Users },
    { id: "revenue", label: "Revenue", Icon: DollarSign },
    { id: "usage", label: "Usage", Icon: BarChart2 },
    { id: "cost", label: "Cost & Margin", Icon: TrendingUp },
    { id: "funnel", label: "Funnel", Icon: Activity },
    { id: "health", label: "Health", Icon: AlertTriangle },
    { id: "settings", label: "Settings", Icon: Settings },
  ];

  const TAB_CLS = (id: Tab) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-md font-medium text-sm transition-colors whitespace-nowrap ${activeTab === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      {/* header */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-purple-600" /> Super Admin Dashboard
          </h1>
          <p className="text-slate-500 mt-1">Revenue, usage, cost, funnel, and health.</p>
        </div>
        <button onClick={() => window.history.back()} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium text-sm border border-slate-200">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      {/* tabs */}
      <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200 mb-8 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={TAB_CLS(t.id)}>
            <t.Icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeTab === "users" && (
        <div className="space-y-6">
          {!usersLoading && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total Users" value={String(totalUsers)} accent="text-blue-400" />
              <StatCard label="Trial Used" value={String(trialUsers)} accent="text-amber-400" />
              <StatCard label="Active Plans" value={String(users.filter(u => (u.creditsTotal || 0) > (u.creditsUsed || 0)).length)} accent="text-emerald-400" />
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email or name…" className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
              </div>
              <span className="text-xs text-slate-400">{filtered.length} of {users.length}</span>
            </div>

            {usersLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-purple-600" /></div>
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
                      <div className="grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 p-4 hover:bg-slate-50/60 cursor-pointer items-center" onClick={() => openDrawer(u.id)}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800 text-sm truncate">{u.name || "—"}</span>
                            <RoleBadge role={u.role} />
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">{u.email}</div>
                        </div>
                        <div className="hidden md:block text-sm">
                          {isAdminUser ? <span className="text-blue-600 font-semibold text-xs">Unlimited</span> : credTotal === 0 ? <span className="text-slate-400 text-xs">No plan</span> : (
                            <div>
                              <span className={`font-semibold text-sm ${expired ? "text-red-500" : "text-slate-800"}`}>{credTotal - credUsed} / {credTotal}</span>
                              <div className="text-[10px] text-slate-400 mt-0.5">{expiry ? `Exp ${fmtDate(expiry)}` : "No expiry"}</div>
                            </div>
                          )}
                        </div>
                        <div className="hidden md:block text-xs text-slate-500">{fmtDate(u.createdAt)}</div>
                        <div className="hidden md:flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                          {u.role !== "superadmin" && <button onClick={() => handleRoleUpdate(u, "superadmin")} className="px-2 py-1 bg-purple-50 text-purple-700 text-[10px] font-bold rounded hover:bg-purple-100 whitespace-nowrap">→ SA</button>}
                          {u.role !== "admin" && <button onClick={() => handleRoleUpdate(u, "admin")} className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold rounded hover:bg-blue-100 whitespace-nowrap">→ Admin</button>}
                          {u.role !== "free" && u.role !== "superadmin" && <button onClick={() => handleRoleUpdate(u, "free")} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded hover:bg-slate-200">→ Free</button>}
                          <div className="flex items-center gap-1">
                            <input type="number" min={1} value={grantInputs[u.id] || ""} onChange={e => setGrantInputs(prev => ({ ...prev, [u.id]: e.target.value }))} placeholder="N" className="w-12 border border-slate-200 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-emerald-400 outline-none" />
                            <button onClick={() => handleGrant(u, parseInt(grantInputs[u.id] || "0"))} className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded hover:bg-emerald-100 whitespace-nowrap">Grant</button>
                          </div>
                        </div>
                        <div className="text-slate-400">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                      </div>

                      {isExpanded && (
                        <div className="bg-slate-50 border-t border-slate-100 px-4 pb-4 pt-3">
                          {/* mobile actions */}
                          <div className="flex md:hidden flex-wrap gap-2 mb-3" onClick={e => e.stopPropagation()}>
                            {u.role !== "superadmin" && <button onClick={() => handleRoleUpdate(u, "superadmin")} className="px-3 py-1.5 bg-purple-50 text-purple-700 text-xs font-bold rounded hover:bg-purple-100">→ SA</button>}
                            {u.role !== "admin" && <button onClick={() => handleRoleUpdate(u, "admin")} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded hover:bg-blue-100">→ Admin</button>}
                            {u.role !== "free" && u.role !== "superadmin" && <button onClick={() => handleRoleUpdate(u, "free")} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded hover:bg-slate-200">→ Free</button>}
                            <div className="flex items-center gap-1">
                              <input type="number" min={1} value={grantInputs[u.id] || ""} onChange={e => setGrantInputs(prev => ({ ...prev, [u.id]: e.target.value }))} placeholder="N" className="w-14 border border-slate-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-400 outline-none" />
                              <button onClick={() => handleGrant(u, parseInt(grantInputs[u.id] || "0"))} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded hover:bg-emerald-100">Grant</button>
                            </div>
                          </div>

                          <div className="flex gap-4 border-b border-slate-200 mb-3">
                            <button onClick={() => setDrawerTab("projects")} className={`pb-2 text-xs font-semibold border-b-2 transition-colors ${drawerTab === "projects" ? "border-purple-600 text-purple-700" : "border-transparent text-slate-500"}`}><FileText className="w-3.5 h-3.5 inline mr-1" />Projects</button>
                            <button onClick={() => setDrawerTab("payments")} className={`pb-2 text-xs font-semibold border-b-2 transition-colors ${drawerTab === "payments" ? "border-purple-600 text-purple-700" : "border-transparent text-slate-500"}`}><CreditCard className="w-3.5 h-3.5 inline mr-1" />Payments</button>
                          </div>
                          {drawerLoading ? (
                            <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                          ) : drawerTab === "projects" ? (
                            drawerProjects.length === 0 ? <p className="text-xs text-slate-400 py-4 text-center">No projects.</p> : (
                              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                {drawerProjects.map((p: any) => (
                                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-white rounded border border-slate-200 text-xs">
                                    <span className="font-medium text-slate-700 truncate flex-1 mr-3">{p.projectName || "Untitled"}</span>
                                    <span className="text-slate-400 shrink-0">{fmtDate(p.savedAt)} · {p.analysisRuns} run{p.analysisRuns !== 1 ? "s" : ""}</span>
                                  </div>
                                ))}
                              </div>
                            )
                          ) : (
                            drawerPayments.length === 0 ? <p className="text-xs text-slate-400 py-4 text-center">No payment records.</p> : (
                              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                {drawerPayments.map((p: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-white rounded border border-slate-200 text-xs">
                                    <div>
                                      <span className={`font-bold ${p.isAdminGrant ? "text-purple-600" : "text-emerald-700"}`}>{p.isAdminGrant ? "Admin grant" : "Payment"}</span>
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
        </div>
      )}

      {/* ═══ REVENUE TAB ═══ */}
      {activeTab === "revenue" && (
        <div className="space-y-6">
          {revLoading && <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-purple-600" /></div>}
          {!revLoading && !rev && (
            <p className="text-sm text-slate-400 text-center py-10">No revenue data yet — this will populate as payments are processed.</p>
          )}
          {rev && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Revenue" value={fmt(rev.allTime?.totalRevenuePaise ?? 0)} accent="text-emerald-400" />
                <StatCard label="This Month" value={fmt(rev.thisMonth?.totalRevenuePaise ?? 0)} sub={`${rev.thisMonth?.count ?? 0} payments`} accent="text-blue-400" />
                <StatCard label="Paying Customers" value={String(rev.allTime?.payingUsersCount ?? 0)} accent="text-amber-400" />
                <StatCard label="Avg / Customer" value={(rev.allTime?.payingUsersCount ?? 0) > 0 ? fmt(rev.allTime.avgRevenuePaise) : "—"} accent="text-purple-400" />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100"><h3 className="font-bold text-slate-800">Revenue by Plan</h3></div>
                <div className="divide-y divide-slate-100">
                  {Object.entries(rev.allTime?.byPlan ?? {}).map(([plan, data]) => (
                    <div key={plan} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <span className="font-semibold text-slate-700 capitalize">{plan.replace(/_/g, " ")}</span>
                        <span className="text-xs text-slate-400 ml-2">{data.count} payment{data.count !== 1 ? "s" : ""}</span>
                      </div>
                      <span className="font-bold text-emerald-700">{fmt(data.revenuePaise)}</span>
                    </div>
                  ))}
                  {Object.keys(rev.allTime?.byPlan ?? {}).length === 0 && <p className="text-sm text-slate-400 p-4 text-center">No payments yet — this will populate as plans are purchased.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100"><h3 className="font-bold text-slate-800">Recent Payments</h3></div>
                <div className="divide-y divide-slate-100">
                  {(rev.recentPayments ?? []).slice(0, 20).map((p, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="min-w-0 mr-4">
                        <div className="text-slate-700 font-medium truncate">{p.email || p.uid}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{p.isAdminGrant ? "Admin grant" : `+${p.credits} analyses`}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-bold ${p.isAdminGrant ? "text-purple-600" : "text-emerald-700"}`}>{p.isAdminGrant ? "—" : `+${p.credits} analyses`}</div>
                        <div className="text-xs text-slate-400">{fmtDate(p.processedAt)}</div>
                      </div>
                    </div>
                  ))}
                  {(rev.recentPayments ?? []).length === 0 && <p className="text-sm text-slate-400 p-4 text-center">No payments yet — this will populate as plans are purchased.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ USAGE TAB ═══ */}
      {activeTab === "usage" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Last</span>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setUsageDays(d)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${usageDays === d ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{d}d</button>
            ))}
            {usageLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {!usageLoading && !usage && (
            <p className="text-sm text-slate-400 text-center py-10">No usage data yet — this will populate as analyses and documents are generated.</p>
          )}
          {usage && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Analyses" value={String((usage.totals?.analysis ?? 0) + (usage.totals?.reanalysis ?? 0))} accent="text-blue-400" />
                <StatCard label="Documents Generated" value={String((usage.totals?.document ?? 0) + (usage.totals?.extraction ?? 0))} accent="text-purple-400" />
                <StatCard label="Chat Messages" value={String(usage.totals?.chat ?? 0)} accent="text-emerald-400" />
                <StatCard label="Failed Events" value={String(usage.health?.failedCount ?? 0)} accent={(usage.health?.failedCount ?? 0) > 0 ? "text-red-400" : "text-slate-400"} />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100"><h3 className="font-bold text-slate-800">Daily Breakdown — last {usageDays} days</h3></div>
                {(usage.daily ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400 p-6 text-center">No usage events in this period — this will populate as analyses and documents are generated.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left px-4 py-2 text-slate-500 font-semibold">Date</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Analyses</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Re-analyses</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Documents</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Chat</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Extractions</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-semibold">Failed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(usage.daily ?? []).map(day => {
                          const t = day.totals ?? {};
                          const failed = t.failed ?? 0;
                          return (
                            <tr key={day.date} className="hover:bg-slate-50">
                              <td className="px-4 py-2 font-medium text-slate-700">{day.date}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{t.analysis ?? 0}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{t.reanalysis ?? 0}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{t.document ?? 0}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{t.chat ?? 0}</td>
                              <td className="px-4 py-2 text-right text-slate-600">{t.extraction ?? 0}</td>
                              <td className={`px-4 py-2 text-right font-semibold ${failed > 0 ? "text-red-500" : "text-slate-300"}`}>{failed}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800">Top Consumers</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Ranked by total events. Flag users running disproportionately many analyses.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {(usage.topConsumers ?? []).slice(0, 10).map((c, i) => {
                    const totalAll = (usage.totals?.analysis ?? 0) + (usage.totals?.reanalysis ?? 0);
                    const isHighUsage = totalAll > 0 && c.count / totalAll > 0.3;
                    return (
                      <div key={c.uid} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-300 w-5 text-center">{i + 1}</span>
                          <span className="text-sm text-slate-700 truncate">{c.email || c.uid}</span>
                          {isHighUsage && <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">High usage</span>}
                        </div>
                        <span className="font-bold text-slate-800 shrink-0 ml-4">{c.count} events</span>
                      </div>
                    );
                  })}
                  {(usage.topConsumers ?? []).length === 0 && <p className="text-sm text-slate-400 p-4 text-center">No usage data yet — this will populate as analyses and documents are generated.</p>}
                </div>
              </div>

              <GapNotice text="Documents-per-day trend before app launch is unavailable — usage_events only records events from when they were wired up." />
            </>
          )}
        </div>
      )}

      {/* ═══ COST & MARGIN TAB ═══ */}
      {activeTab === "cost" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-slate-800">Billing Inputs</h3>
            <p className="text-xs text-slate-500">Enter your actual Google Cloud bill and per-analysis cost estimate. Saved to Firestore and used to compute real margin.</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Cost per analysis (₹, estimate)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                  <input type="number" step="0.01" value={costPerAnalysis} onChange={e => setCostPerAnalysis(e.target.value)} placeholder="e.g. 2.50" className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Actual monthly Google Cloud bill (₹)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                  <input type="number" step="1" value={actualBillRs} onChange={e => setActualBillRs(e.target.value)} placeholder="e.g. 1500" className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                </div>
              </div>
            </div>
            <button onClick={saveBillingSettings} disabled={costSaving} className="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white rounded-lg font-semibold text-sm hover:bg-slate-800 disabled:opacity-50">
              {costSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save
            </button>
          </div>

          {rev && usage ? (
            (() => {
              const totalAnalyses = (usage.totals?.analysis ?? 0) + (usage.totals?.reanalysis ?? 0);
              const cpa = parseFloat(costPerAnalysis);
              const bill = parseFloat(actualBillRs);
              const revRs = rev.thisMonth.totalRevenuePaise / 100;
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label={`Analyses (${usageDays}d)`} value={String(totalAnalyses)} accent="text-blue-400" />
                    <StatCard label="Est. Gemini Spend" value={!isNaN(cpa) && cpa > 0 ? `₹${(totalAnalyses * cpa).toLocaleString("en-IN")}` : "—"} sub={!isNaN(cpa) && cpa > 0 ? `@ ₹${cpa}/analysis` : "Enter cost above"} accent="text-amber-400" />
                    <StatCard label="This Month Revenue" value={fmt(rev.thisMonth.totalRevenuePaise)} accent="text-emerald-400" />
                    <StatCard label="Real Margin" value={!isNaN(bill) && bill > 0 ? `₹${(revRs - bill).toLocaleString("en-IN")}` : "—"} sub={!isNaN(bill) && bill > 0 ? "Revenue − actual bill" : "Enter bill above"} accent={!isNaN(bill) && bill > 0 ? (revRs - bill >= 0 ? "text-emerald-400" : "text-red-400") : "text-slate-400"} />
                  </div>
                  <GapNotice text="Estimated Gemini spend uses the cost-per-analysis figure you entered above — it is an estimate, not a measured cost. Use your actual Google Cloud bill for real margin." />
                  <GapNotice text="Cost-per-analysis trend over time is not available — usage_events does not record token counts. Consider adding inputChars to usage_events if trend analysis is needed later." />
                </div>
              );
            })()
          ) : (
            <div className="py-8 flex justify-center">
              <div className="text-slate-400 text-sm text-center">
                <p>Load the Revenue and Usage tabs first to compute margin.</p>
                <button onClick={() => setActiveTab("revenue")} className="mt-3 px-4 py-2 bg-slate-100 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200">Go to Revenue →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ FUNNEL TAB ═══ */}
      {activeTab === "funnel" && (
        <div className="space-y-6">
          {usersLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-purple-600" /></div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800">Conversion Funnel</h3>
                  <p className="text-xs text-slate-400 mt-0.5">All-time. Load the Revenue tab to see the Paid step.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {[
                    { label: "Signed up", count: totalUsers as number | null, prev: null as number | null },
                    { label: "Used free trial analysis", count: trialUsers as number | null, prev: totalUsers as number | null },
                    { label: "Purchased a plan", count: payingUsers, prev: trialUsers as number | null },
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-4">
                      <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-800">{step.label}</div>
                        {step.prev !== null && step.count !== null && (
                          <div className="text-xs text-slate-400 mt-0.5">{pct(step.count, step.prev)} from previous step</div>
                        )}
                      </div>
                      <div className="text-2xl font-black text-slate-900">
                        {step.count !== null ? step.count : <span className="text-slate-300 text-sm font-normal">Load Revenue tab</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {!rev && <GapNotice text="Load the Revenue tab to populate the Paid step count." />}
              <GapNotice text="'Used free trial analysis' counts users where trialClaimed === true. Admin users who analysed without claiming a trial are excluded." />
            </>
          )}
        </div>
      )}

      {/* ═══ HEALTH TAB ═══ */}
      {activeTab === "health" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">Period</span>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setUsageDays(d)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${usageDays === d ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{d}d</button>
            ))}
            {usageLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>

          {!usageLoading && !usage && (
            <p className="text-sm text-slate-400 text-center py-10">No usage data yet — this will populate as analyses and documents are generated.</p>
          )}
          {usage && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="Failed Events" value={String(usage.health?.failedCount ?? 0)} accent={(usage.health?.failedCount ?? 0) > 0 ? "text-red-400" : "text-emerald-400"} />
                <StatCard label="Low-Confidence Results" value={String(usage.health?.lowConfidenceCount ?? 0)} accent={(usage.health?.lowConfidenceCount ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"} />
                <StatCard label="Payment Errors" value={String((usage.health?.paymentErrors ?? []).length)} accent={(usage.health?.paymentErrors ?? []).length > 0 ? "text-red-400" : "text-emerald-400"} sub={(usage.health?.paymentErrors ?? []).length === 0 ? "Zero unrecognised amounts — good" : undefined} />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100"><h3 className="font-bold text-slate-800">Failed Events <span className="text-slate-400 font-normal text-sm">— last {usageDays} days</span></h3></div>
                {(usage.health?.failedEvents ?? []).length === 0 ? (
                  <div className="p-6 flex items-center gap-2 text-emerald-600"><CheckCircle2 className="w-5 h-5" /><span className="text-sm font-medium">No failures in this period.</span></div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {(usage.health?.failedEvents ?? []).slice(0, 50).map((e, i) => (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-700 uppercase">{e.type}</span>
                            {e.failureReason && <span className="text-xs text-red-600 truncate">{e.failureReason}</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{e.uid || "—"} · {fmtDate(e.timestamp)}</div>
                        </div>
                      </div>
                    ))}
                    {(usage.health?.failedEvents ?? []).length > 50 && <p className="text-xs text-slate-400 p-3 text-center">Showing 50 of {usage.health.failedEvents.length}</p>}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    Payment Errors
                    {(usage.health?.paymentErrors ?? []).length === 0 && <span className="text-xs font-normal text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> All clear</span>}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Unrecognised payment amounts — any entry here signals a pricing bug.</p>
                </div>
                {(usage.health?.paymentErrors ?? []).length === 0 ? (
                  <p className="text-sm text-emerald-600 p-4 font-medium">No unrecognised amounts.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {(usage.health?.paymentErrors ?? []).map((e, i) => (
                      <div key={i} className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-bold text-red-600">{e.amountPaise != null ? fmt(e.amountPaise) : "unknown amount"}</span>
                          <span className="text-xs text-slate-400 ml-2">{e.email || "no email"}</span>
                        </div>
                        <span className="text-xs text-slate-400">{fmtDate(e.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <GapNotice text="Rate-limit hits are not recorded in usage_events. To add this metric, wire a 'rate_limit' event type into logUsageEvent() in server.ts." />
            </>
          )}
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-slate-800">System Settings</h3>
            {sysSettings === null ? (
              <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">UPI ID</label>
                    <input value={sysSettings.upiId || ""} onChange={e => setSysSettings((p: any) => ({ ...p, upiId: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">WhatsApp Number</label>
                    <input value={sysSettings.whatsappNumber || ""} onChange={e => setSysSettings((p: any) => ({ ...p, whatsappNumber: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Support Email</label>
                    <input type="email" value={sysSettings.supportEmail || ""} onChange={e => setSysSettings((p: any) => ({ ...p, supportEmail: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Razorpay Key ID</label>
                    <input value={sysSettings.razorpayKeyId || ""} onChange={e => setSysSettings((p: any) => ({ ...p, razorpayKeyId: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2">Plan Features (JSON)</label>
                  <textarea
                    rows={6}
                    value={typeof sysSettings.planFeatures === "object" ? JSON.stringify(sysSettings.planFeatures, null, 2) : (sysSettings.planFeatures || "")}
                    onChange={e => {
                      try { setSysSettings((p: any) => ({ ...p, planFeatures: JSON.parse(e.target.value) })); }
                      catch { /* let user finish typing */ }
                    }}
                    className="w-full font-mono text-xs border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none resize-y"
                  />
                </div>
                <button onClick={saveSysSettings} disabled={settSaving} className="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white rounded-lg font-semibold text-sm hover:bg-slate-800 disabled:opacity-50">
                  {settSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Settings
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
