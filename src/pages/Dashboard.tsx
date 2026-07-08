import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  FileSearch, TrendingUp, CheckCircle, FileText,
  Calendar, Target, ArrowRight,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useDeadlineReminders } from "../hooks/useDeadlineReminders";

// ── Helpers ─────────────────────────────────────────────────

function parseDeadline(str: string | undefined): Date | null {
  if (!str || typeof str !== "string") return null;
  const t = str.trim().toLowerCase();
  if (!t || t.includes("not") || t.includes("tbd") || t.includes("n/a")) return null;
  const d = new Date(str.trim());
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Stat card sub-component ──────────────────────────────────

type StatColor = "blue" | "emerald" | "indigo" | "rose" | "slate";

const COLOR_MAP: Record<StatColor, { bg: string; icon: string; hover: string; value: string }> = {
  blue:    { bg: "bg-blue-50",    icon: "text-blue-600",    hover: "hover:border-blue-300",    value: "text-blue-700" },
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", hover: "hover:border-emerald-300", value: "text-emerald-700" },
  indigo:  { bg: "bg-indigo-50",  icon: "text-indigo-600",  hover: "hover:border-indigo-300",  value: "text-indigo-700" },
  rose:    { bg: "bg-rose-50",    icon: "text-rose-600",    hover: "hover:border-rose-300",    value: "text-rose-700" },
  slate:   { bg: "bg-slate-50",   icon: "text-slate-500",   hover: "hover:border-slate-300",   value: "text-slate-700" },
};

function StatCard({
  label, value, icon, color, onClick, sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: StatColor;
  onClick: () => void;
  sub: string;
}) {
  const c = COLOR_MAP[color];
  return (
    <div
      onClick={onClick}
      className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm cursor-pointer ${c.hover} hover:shadow-md transition-all`}
    >
      <div className={`w-10 h-10 rounded-lg ${c.bg} ${c.icon} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-black mt-1 leading-none ${c.value}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-2">{sub}</p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm text-center px-6">
      {message}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [savedTenders, setSavedTenders] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;

    const unsubTenders = onSnapshot(
      query(collection(db, "saved_tenders"), where("userId", "==", user.uid)),
      snap => setSavedTenders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, "notifications"), where("userId", "==", user.uid)),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        docs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setNotifications(docs);
      },
    );

    return () => { unsubTenders(); unsubNotifs(); };
  }, [user]);

  useDeadlineReminders(user?.uid, savedTenders, notifications);

  // ── Derived values ─────────────────────────────────────────

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7Days = new Date(today);
  in7Days.setDate(in7Days.getDate() + 7);

  const total = savedTenders.length;

  const active = savedTenders.filter(t => {
    const d = parseDeadline(t.details?.timeline_and_milestones?.submission_deadline);
    return d !== null && d >= today;
  }).length;

  const highMatch = savedTenders.filter(
    t => (t.details?.compatibility?.score ?? 0) >= 80,
  ).length;

  const dueThisWeek = savedTenders.filter(t => {
    const d = parseDeadline(t.details?.timeline_and_milestones?.submission_deadline);
    return d !== null && d >= today && d <= in7Days;
  }).length;

  // Donut — match score breakdown
  let scoreHigh = 0, scoreMed = 0, scoreLow = 0;
  savedTenders.forEach(t => {
    const s = t.details?.compatibility?.score ?? 0;
    if (s >= 80) scoreHigh++;
    else if (s >= 50) scoreMed++;
    else scoreLow++;
  });
  const donutData = [
    { name: "High (≥80)",   value: scoreHigh, color: "#10b981" },
    { name: "Medium (50–79)", value: scoreMed,  color: "#f59e0b" },
    { name: "Low (<50)",    value: scoreLow,  color: "#ef4444" },
  ].filter(d => d.value > 0);

  // Bar — tenders saved over the last 6 months
  const barData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
    const label = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    const count = savedTenders.filter(t => {
      const saved = t.savedAt?.toDate?.();
      return saved && saved.getFullYear() === d.getFullYear() && saved.getMonth() === d.getMonth();
    }).length;
    return { label, count };
  });

  // Upcoming deadlines list — next 5 by nearest future deadline
  const upcomingList = savedTenders
    .map(t => ({ ...t, _dl: parseDeadline(t.details?.timeline_and_milestones?.submission_deadline) }))
    .filter(t => t._dl !== null && t._dl >= today)
    .sort((a, b) => a._dl!.getTime() - b._dl!.getTime())
    .slice(0, 5);

  const daysUntil = (d: Date) => Math.ceil((d.getTime() - today.getTime()) / 86_400_000);

  // Recent tenders — last 5 saved
  const recentTenders = [...savedTenders]
    .sort((a, b) => (b.savedAt?.toMillis?.() ?? 0) - (a.savedAt?.toMillis?.() ?? 0))
    .slice(0, 5);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 md:p-8 w-full max-w-7xl mx-auto pb-24 md:pb-8">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Your tender intelligence at a glance.</p>
        </div>
        <Link
          to="/dashboard/analyzer"
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold shadow-sm flex items-center gap-2 transition-colors"
        >
          <FileSearch className="w-5 h-5" />
          New Analysis
        </Link>
      </div>

      {/* ── Stat cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Tenders"
          value={total}
          icon={<FileText className="w-5 h-5" />}
          color="blue"
          onClick={() => navigate("/dashboard/projects")}
          sub="in your pipeline"
        />
        <StatCard
          label="Active Tenders"
          value={active}
          icon={<TrendingUp className="w-5 h-5" />}
          color="emerald"
          onClick={() => navigate("/dashboard/projects")}
          sub="deadline not yet passed"
        />
        <StatCard
          label="High Match"
          value={highMatch}
          icon={<CheckCircle className="w-5 h-5" />}
          color="indigo"
          onClick={() => navigate("/dashboard/projects")}
          sub="compatibility ≥ 80"
        />
        <StatCard
          label="Due This Week"
          value={dueThisWeek}
          icon={<Calendar className="w-5 h-5" />}
          color={dueThisWeek > 0 ? "rose" : "slate"}
          onClick={() => navigate("/dashboard/projects")}
          sub="deadlines in next 7 days"
        />
      </div>

      {/* ── Charts ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* Donut: match score breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="font-semibold text-slate-800 mb-0.5">Match Score Breakdown</h2>
          <p className="text-xs text-slate-400 mb-4">Distribution across your full pipeline</p>
          {total === 0 ? (
            <EmptyChart message="No tenders yet — analyze your first tender to see score distribution." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [`${value} tender${value !== 1 ? "s" : ""}`, name]}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Bar: tenders saved by month */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="font-semibold text-slate-800 mb-0.5">Tenders Saved by Month</h2>
          <p className="text-xs text-slate-400 mb-4">Activity trend over the last 6 months</p>
          {total === 0 ? (
            <EmptyChart message="No tenders saved yet — your monthly trend will appear here." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} barSize={28} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(value: number) => [`${value}`, "Tenders saved"]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Upcoming deadlines + Recent tenders ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Upcoming deadlines */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-rose-500" />
              Upcoming Deadlines
            </h2>
            <Link
              to="/dashboard/projects"
              className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
            >
              All projects <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {upcomingList.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              No upcoming deadlines found.
            </div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {upcomingList.map(t => {
                const days = daysUntil(t._dl!);
                const urgent = days <= 3;
                return (
                  <li
                    key={t.id}
                    onClick={() => navigate(`/dashboard/projects/${t.id}`)}
                    className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {t.projectName || t.details?.tender_simplified?.tender_name || "Unnamed Tender"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{fmtDate(t._dl!)}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${urgent ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                      {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent tenders */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-500" />
              Recent Tenders
            </h2>
            <Link
              to="/dashboard/projects"
              className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
            >
              All projects <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentTenders.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              No tenders yet.{" "}
              <Link to="/dashboard/analyzer" className="text-blue-600 underline">
                Analyze your first tender.
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {recentTenders.map(t => {
                const score = t.details?.compatibility?.score ?? 0;
                const scoreStyle =
                  score >= 80
                    ? "bg-emerald-50 text-emerald-700"
                    : score >= 50
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-500";
                const savedDate = t.savedAt?.toDate?.();
                return (
                  <li
                    key={t.id}
                    onClick={() => navigate(`/dashboard/projects/${t.id}`)}
                    className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {t.projectName || t.details?.tender_simplified?.tender_name || "Unnamed Tender"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {savedDate ? fmtDate(savedDate) : "—"}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${scoreStyle}`}>
                      {score}/100
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
}
