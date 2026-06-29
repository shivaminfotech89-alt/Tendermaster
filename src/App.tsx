import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AnalyzerProvider } from "./context/AnalyzerContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import TenderAnalyzer from "./pages/TenderAnalyzer";
import BusinessProfile from "./pages/BusinessProfile";
import AdminPanel from "./pages/AdminPanel";
import SuperAdminPanel from "./pages/SuperAdminPanel";
import Login from "./pages/Login";
import ProjectDetails from "./pages/ProjectDetails";
import TenderChat from "./pages/TenderChat";

import Projects from "./pages/Projects";
import Notifications from "./pages/Notifications";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("React Error:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-50 text-red-900 h-screen font-mono z-50 fixed inset-0 flex flex-col items-center justify-center">
          <h1 className="text-2xl font-bold mb-4">UI Crashed (White screen prevented)</h1>
          <pre className="text-sm border p-4 bg-white rounded shadow max-w-[90vw] overflow-auto max-h-[50vh] whitespace-pre-wrap">{this.state.error?.toString()}\n{this.state.error?.stack}</pre>
          <button className="mt-6 px-4 py-2 bg-slate-900 text-white rounded font-bold" onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }
    return this.props.children; 
  }
}

function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }: { children: React.ReactNode, adminOnly?: boolean, superAdminOnly?: boolean }) {

  const { user, role, loading } = useAuth();
  
  if (loading) return <div className="h-screen w-screen flex items-center justify-center bg-slate-50"><div className="animate-spin w-8 h-8 border-4 border-[#002b5b] border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (superAdminOnly && role !== "superadmin") return <Navigate to="/" />;
  if (adminOnly && role !== "admin" && role !== "superadmin") return <Navigate to="/" />;

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-right" />
      <AuthProvider>
        <AnalyzerProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              
              <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="analyzer" element={<TenderAnalyzer />} />
                <Route path="chat" element={<TenderChat />} />
                <Route path="documents" element={<div className="p-8 text-center text-slate-500">Global Documents View (Coming Soon)</div>} />
                <Route path="reports" element={<Reports />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="profile" element={<BusinessProfile />} />
                <Route path="settings" element={<Settings />} />
                <Route path="projects/:projectId" element={<ProjectDetails />} />
              </Route>
              
              {/* Separate Admin Routes outside of Layout */}
              <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPanel /></ProtectedRoute>} />
              <Route path="/superadmin" element={<ProtectedRoute superAdminOnly><SuperAdminPanel /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </BrowserRouter>
        </AnalyzerProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
