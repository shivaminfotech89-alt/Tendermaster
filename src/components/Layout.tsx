import React, { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, FileSearch, Building2, ShieldCheck, LogOut, Settings, FileText, MessageSquare, TrendingUp, Bell, Loader2, Globe, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { useTranslation } from "react-i18next";

export default function Layout() {
  const { user, role, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { analyzing, progress, analysisResult, reanalyzing, reanalyzeProgress, clearAnalysis } = useAnalyzerStore();
  const [hidePopup, setHidePopup] = useState(false);
  useEffect(() => { if (analyzing || reanalyzing) setHidePopup(false); }, [analyzing, reanalyzing]);
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
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

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar for Desktop */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-slate-100 flex-shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white mr-3">T</div>
          <span className="text-xl font-bold tracking-tight text-slate-800">TenderMaster <span className="text-blue-600">AI</span></span>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-blue-700" : "text-slate-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
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

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center">
              <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center font-bold text-white text-xs mr-2">T</div>
              <span className="text-lg font-bold tracking-tight text-slate-800">TenderMaster</span>
            </div>
            <div className="flex items-center gap-2">
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

        {/* Dynamic Route Content */}
        <div className="flex-1 overflow-auto bg-slate-50 relative pb-16 md:pb-0">
           <Outlet />
        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex items-center justify-around px-2 pb-safe z-50">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`flex flex-col items-center justify-center w-16 h-full gap-1 ${isActive ? "text-blue-600" : "text-slate-500"}`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </main>

      {/* Global Analysis Progress Indicator (Only visible outside of analyzer page or when processing) */}
      {!hidePopup && (isGlobalAnalyzing || (analysisResult && location.pathname !== '/analyzer' && !location.pathname.startsWith('/projects/'))) && (
        <div 
          onClick={() => {
            if (reanalyzing) return; // Stay on project page if reanalyzing
            navigate('/analyzer');
          }}
          className="fixed top-4 right-4 md:top-6 md:right-6 bg-white border border-blue-200 shadow-xl rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:shadow-2xl transition-all z-50 group hover:border-blue-400"
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
