import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { FileSearch, TrendingUp, AlertTriangle, CheckCircle, FileText, Bell, MessageSquare } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [savedTenders, setSavedTenders] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  
  const [stats, setStats] = useState({
     total: 0,
     highMatch: 0,
     totalValue: 0
  });

  useEffect(() => {
    if (!user) return;
    
    // Fetch Saved Tenders
    const q = query(collection(db, "saved_tenders"), where("userId", "==", user.uid));
    const unsubscribeTenders = onSnapshot(q, (snapshot) => {
       const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       setSavedTenders(docs);
       
       let highMatch = 0;
       
       docs.forEach((doc: any) => {
          if (doc.details?.compatibility?.score >= 80) highMatch++;
       });
       
       setStats({
          total: docs.length,
          highMatch,
          totalValue: 0 // Mocked for now, as we'd need to parse actual currency
       });
    });

    // Fetch Notifications
    const qNotif = query(collection(db, "notifications"), where("userId", "==", user.uid));
    const unsubscribeNotifs = onSnapshot(qNotif, (snapshot) => {
       const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       // sort by date descending
       docs.sort((a: any, b: any) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
       setNotifications(docs);
    });

    return () => {
       unsubscribeTenders();
       unsubscribeNotifs();
    };
  }, [user]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Welcome back!</h1>
          <p className="text-slate-500 mt-1">Here's your strategic tender intelligence overview.</p>
        </div>
        <Link 
          to="/analyzer" 
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold shadow-sm flex items-center gap-2 transition-colors"
        >
          <FileSearch className="w-5 h-5" />
          New Analysis
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div 
          onClick={() => navigate('/projects')}
          className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-blue-600 mb-4 transition-colors">
            <FileText className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Tenders in Pipeline</p>
          <h3 className="text-3xl font-bold mt-1 text-slate-900">{stats.total}</h3>
          <p className="text-xs text-blue-600 mt-4 font-medium flex items-center gap-1">
             View all projects <TrendingUp className="w-3 h-3" />
          </p>
        </div>
        
        <div 
          onClick={() => navigate('/projects')}
          className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-emerald-300 hover:shadow-md transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4 transition-colors">
            <CheckCircle className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">High Match Tenders</p>
          <h3 className="text-3xl font-bold mt-1 text-slate-900">{stats.highMatch}</h3>
          <p className="text-xs text-emerald-600 mt-4 font-medium flex items-center gap-1">
             Action recommended <TrendingUp className="w-3 h-3" />
          </p>
        </div>
        
        <div 
           onClick={() => navigate('/notifications')}
           className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-amber-300 hover:shadow-md transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center text-amber-600 mb-4 transition-colors relative">
            <Bell className="w-6 h-6" />
            {notifications.filter(n => !n.read).length > 0 && (
              <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">New Notifications</p>
          <h3 className="text-3xl font-bold mt-1 text-slate-900">{notifications.filter(n => !n.read).length}</h3>
          <p className="text-xs text-amber-600 mt-4 font-medium flex items-center gap-1">
             View alerts <TrendingUp className="w-3 h-3" />
          </p>
        </div>
      </div>

    </div>
  );
}
