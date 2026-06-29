import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Bell } from "lucide-react";

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    const qNotif = query(collection(db, "notifications"), where("userId", "==", user.uid));
    const unsubscribeNotifs = onSnapshot(qNotif, (snapshot) => {
       const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       // sort by date descending
       docs.sort((a: any, b: any) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
       setNotifications(docs);
    });
    return () => unsubscribeNotifs();
  }, [user]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Notifications</h1>
        <p className="text-slate-500 mt-1">Updates and alerts for your tender pipeline.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[24rem]">
        {notifications.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
             <Bell className="w-12 h-12 mb-4 opacity-50" />
             <p className="text-lg">No new notifications.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto w-full">
             <div className="divide-y divide-slate-100">
               {notifications.map(n => (
                 <div key={n.id} className={`p-4 flex gap-3 items-start ${n.read ? 'opacity-60' : 'bg-blue-50/30'} hover:bg-slate-50 transition-colors`}>
                    <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${n.read ? 'bg-slate-300' : 'bg-blue-500'}`} />
                    <div>
                      <p className="text-sm text-slate-800 font-medium">{n.message}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {n.createdAt?.toMillis ? new Date(n.createdAt.toMillis()).toLocaleString() : 'Just now'}
                      </p>
                    </div>
                 </div>
               ))}
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
