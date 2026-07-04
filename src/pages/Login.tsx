import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Building2, Loader2, Mail, Lock, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Login() {
  const { loginWithGoogle, loginWithEmail, signupWithEmail, loading, user } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  
  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);
  
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const timeoutId = setTimeout(() => {
      if (window.self !== window.top) {
        setAuthLoading(false);
        setError("Google Login was blocked by the browser. Please open the app in a new tab.");
      }
    }, 10000);

    try {
      await loginWithGoogle();
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.message && err.message.includes("Popup closed")) {
         setError("Login popup was closed. If you are viewing this in the preview window, please click 'Open in new tab' (top right) to log in.");
      } else if (err.message) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred during login.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError("");
    setAuthLoading(true);
    try {
      if (isLogin) {
        await loginWithEmail(email, password);
      } else {
        await signupWithEmail(email, password, name, phone);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-8 pb-6 border-b border-slate-100 bg-slate-50 text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-white text-3xl mx-auto shadow-md mb-4">
            T
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">TenderMaster <span className="text-blue-600">AI</span></h1>
          <p className="text-slate-500 mt-2 text-sm font-medium">{isLogin ? t("login_title") : t("signup_title")}</p>
        </div>
        
        <div className="p-8 flex flex-col items-center">
          
          <form className="w-full space-y-4 mb-6" onSubmit={handleSubmit}>
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 text-center">{error}</div>}
            
            {!isLogin && (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">{t("name") || "Full Name"}</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      required
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                      placeholder="Your Name"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">{t("phone") || "Mobile Number"}</label>
                  <div className="relative">
                    <input 
                      type="tel" 
                      required
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                      placeholder="Mobile Number"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">{t("email")}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                  placeholder="name@company.com"
                />
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">{t("password")}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || authLoading}
              className="w-full h-11 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 mt-2"
            >
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isLogin ? (authLoading ? t("logging_in") : t("login_button")) : (authLoading ? t("signing_up") : t("signup_button"))}
            </button>
          </form>

          <div className="w-full flex items-center gap-3 mb-6">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-xs font-medium text-slate-400 uppercase">{t("or")}</span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading || authLoading}
            className="w-full h-11 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 hover:border-slate-400 transition-all flex items-center justify-center gap-3 shadow-sm disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t("continue_with_google")}
          </button>
          
          <div className="mt-8 text-center text-sm text-slate-500">
            {isLogin ? t("dont_have_account") : t("already_have_account")}
            <button onClick={() => setIsLogin(!isLogin)} className="ml-1 text-blue-600 font-bold hover:underline">
              {isLogin ? t("signup_button") : t("login_button")}
            </button>
          </div>
        </div>
        
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-slate-500" />
            <select 
               value={i18n.language} 
               onChange={(e) => changeLanguage(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer focus:ring-0"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="gu">ગુજરાતી</option>
            </select>
          </div>
          
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
            <a href="/terms" className="hover:text-slate-900 transition-colors">Terms of Service</a>
            <a href="/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
}
