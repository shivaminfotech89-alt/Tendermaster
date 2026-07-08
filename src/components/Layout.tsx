import React, { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, FileSearch, Building2, ShieldCheck, LogOut, Settings, FileText, MessageSquare, TrendingUp, Bell, Loader2, Globe, X, MoreHorizontal } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  hi: "हिंदी",
  gu: "ગુજરાતી",
};

export default function Layout() {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { analyzing, progress, analysisResult, reanalyzing, reanalyzeProgress, clearAnalysis } = useAnalyzerStore();
  const [hidePopup, setHidePopup] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (analyzing || reanalyzing) setHidePopup(false); }, [analyzing, reanalyzing]);
  // Close the More drawer whenever the route changes
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  const { t, i18n } = useTranslation();

  // True when the user can see analysis results — either a fresh analysis in
  // TenderAnalyzer (context) or a saved project open in ProjectDetails (URL).
  const hasActiveAnalysis =
    !!analysisResult || /^\/dashboard\/projects\/.+/.test(location.pathname);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    const name = LANG_NAMES[lng] ?? lng;
    toast(`Language changed to ${name}. Existing tender analyses need to be re-analyzed to appear in ${name}.`, {
      icon: "🌐",
      duration: 5000,
    });
  };

  const isGlobalAnalyzing = analyzing || reanalyzing;
  const globalProgress = reanalyzing ? reanalyzeProgress : progress;
  const analyzingText = reanalyzing ? 'Re-Analyzing Project' : 'Analysis In Progress';

  const navItems = [
    { path: "/dashboard", id: "dashboard", label: t("dashboard"), icon: LayoutDashboard },
    { path: "/dashboard/projects", id: "projects", label: t("projects"), icon: FileText },
    { path: "/dashboard/analyzer", id: "analyzer", label: t("analyzer"), icon: FileSearch },
    { path: "/dashboard/chat", id: "chat", label: t("chat"), icon: MessageSquare },
    { path: "/dashboard/documents", id: "documents", label: t("documents"), icon: FileText },
    { path: "/dashboard/reports", id: "reports", label: t("reports"), icon: TrendingUp },
    { path: "/dashboard/notifications", id: "notifications", label: t("notifications"), icon: Bell },
    { path: "/dashboard/profile", id: "profile", label: t("profile"), icon: Building2 },
    { path: "/dashboard/settings", id: "settings", label: t("settings"), icon: Settings },
  ];

  if (role === "admin" || role === "superadmin") {
    navItems.push({ path: "/admin", id: "admin", label: t("admin_panel"), icon: ShieldCheck });
  }
  if (role === "superadmin") {
    navItems.push({ path: "/superadmin", id: "superadmin", label: t("super_admin"), icon: Settings });
  }

  const isActive = (item: (typeof navItems)[number]) =>
    location.pathname === item.path ||
    (item.path !== "/" && location.pathname.startsWith(item.path));

  // Mobile bottom bar: 4 primary items + "More" drawer for the rest
  const PRIMARY_IDS = new Set(["dashboard", "analyzer", "documents", "profile"]);
  const primaryNavItems = navItems.filter(item => PRIMARY_IDS.has(item.id));
  const secondaryNavItems = navItems.filter(item => !PRIMARY_IDS.has(item.id));
  const anySecondaryActive = secondaryNavItems.some(isActive);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar — desktop only */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-slate-100 flex-shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white mr-3">T</div>
          <span className="text-xl font-bold tracking-tight text-slate-800">TenderMaster <span className="text-blue-600">AI</span></span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(item) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive(item) ? "text-blue-700" : "text-slate-400"}`} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
          {role !== "premium" && (
            <Link to="/dashboard/settings?tab=subscription" className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white py-2 rounded-lg text-sm font-bold shadow-md transition-all mb-2 animate-pulse hover:animate-none">
              <ShieldCheck className="w-4 h-4" />
              Subscribe Now
            </Link>
          )}
          <div className="flex items-center gap-2 px-2 pb-2 border-b border-slate-100">
            <Globe className="w-4 h-4 text-slate-400" />
            <select
              value={i18n.language}
              onChange={(e) => changeLanguage(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-600 outline-none cursor-pointer flex-1"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="gu">ગુજરાતી</option>
            </select>
          </div>
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0">
              {user?.email?.[0].toUpperCase() || "U"}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-900 truncate">{user?.email}</span>
              <span className="text-[10px] uppercase text-emerald-600 font-bold tracking-wider">{role || "FREE"} PLAN</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full"
          >
            <LogOut className="w-4 h-4" /> {t("logout")}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center font-bold text-white text-xs mr-2">T</div>
            <span className="text-lg font-bold tracking-tight text-slate-800">TenderMaster</span>
          </div>
          <div className="flex items-center gap-2">
            {role !== "premium" && (
              <Link to="/dashboard/settings?tab=subscription" className="flex items-center justify-center bg-gradient-to-r from-amber-500 to-orange-500 text-white p-1.5 rounded text-xs font-bold shadow-md animate-pulse">
                <ShieldCheck className="w-4 h-4 mr-1" />
                UPGRADE
              </Link>
            )}
            <select
              value={i18n.language}
              onChange={(e) => changeLanguage(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-600 outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="hi">HI</option>
              <option value="gu">GU</option>
            </select>
            <button onClick={logout} className="p-2 text-slate-500 hover:text-red-600"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>

        {/* Page content — overflow-x-hidden prevents card shadows from creating a horizontal scrollbar */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 relative pb-[4.5rem] md:pb-0">
          <Outlet />
        </div>
      </main>

      {/* ── Mobile bottom navigation bar (4 primary + More) ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-stretch z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryNavItems.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`flex flex-col items-center justify-center flex-1 py-2 min-w-0 gap-0.5 ${
              isActive(item) ? "text-blue-600" : "text-slate-400"
            }`}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span className="text-[9px] font-medium leading-tight w-full text-center px-0.5 truncate">
              {item.label}
            </span>
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-col items-center justify-center flex-1 py-2 min-w-0 gap-0.5 ${
            anySecondaryActive ? "text-blue-600" : "text-slate-400"
          }`}
        >
          <MoreHorizontal className="w-5 h-5 shrink-0" />
          <span className="text-[9px] font-medium leading-tight">More</span>
        </button>
      </nav>

      {/* ── "More" bottom sheet (mobile only) ── */}
      {moreOpen && (
        <>
          {/* Scrim */}
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-[60]"
            onClick={() => setMoreOpen(false)}
          />
          {/* Sheet */}
          <div
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-[70]"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <span className="font-semibold text-slate-800">More</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3">
              {secondaryNavItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive(item) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <item.icon className={`w-5 h-5 shrink-0 ${isActive(item) ? "text-blue-600" : "text-slate-400"}`} />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Global Analysis Progress indicator */}
      {!hidePopup && (isGlobalAnalyzing || (analysisResult && location.pathname !== '/analyzer' && !location.pathname.startsWith('/dashboard/projects/'))) && (
        <div
          onClick={() => {
            if (reanalyzing) return;
            navigate('/dashboard/analyzer');
          }}
          className="fixed bottom-20 right-4 md:top-6 md:right-6 md:bottom-auto bg-white border border-blue-200 shadow-xl rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:shadow-2xl transition-all z-50 group hover:border-blue-400"
        >
          <button
            onClick={(e) => { e.stopPropagation(); setHidePopup(true); }}
            className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-md border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>

          {isGlobalAnalyzing ? (
            <div className="relative flex items-center justify-center w-12 h-12">
              <Loader2 className="w-12 h-12 text-blue-100 animate-spin" />
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin absolute top-0 left-0" style={{ clipPath: `inset(${100 - globalProgress}% 0 0 0)` }} />
              <span className="absolute text-[10px] font-bold text-blue-800">{Math.round(globalProgress)}%</span>
            </div>
          ) : (
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
              <span className="text-xs font-bold">100%</span>
            </div>
          )}
          <div className="flex flex-col shrink-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{isGlobalAnalyzing ? analyzingText : 'Analysis Complete'}</span>
            <span className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              {isGlobalAnalyzing ? 'Processing tender data...' : 'Click to view results'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
