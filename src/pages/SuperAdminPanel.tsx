import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { db } from "../lib/firebase";
import { collection, query, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { Shield, Key, FileText, UserPlus, Trash2, Edit2, Loader2, IndianRupee } from "lucide-react";
import { toast } from "react-hot-toast";
import { fetchWithAuth } from "../lib/api";

export default function SuperAdminPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("admins");
  
  // Settings Tab State
  const [upiId, setUpiId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Plans State
  const [premiumPrice, setPremiumPrice] = useState("999");
  const [premiumFeatures, setPremiumFeatures] = useState("Unlimited Tender Analysis\nAutomated Document Generation\nDedicated Tender Chat AI\nPDF Exports & Competitor Analysis");
  const [savingPlan, setSavingPlan] = useState(false);

  // Admin Accounts State
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchSettings = async () => {
    try {
      const docRef = doc(db, "system_settings", "payments");
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setUpiId(snap.data().upi_id || "");
      } else {
        setUpiId("7990878248@ybl"); // default
      }

      const planRef = doc(db, "system_settings", "plans");
      const pSnap = await getDoc(planRef);
      if (pSnap.exists()) {
         setPremiumPrice(pSnap.data().premiumPrice || "999");
         setPremiumFeatures(pSnap.data().premiumFeatures || "Unlimited Tender Analysis\nAutomated Document Generation\nDedicated Tender Chat AI\nPDF Exports & Competitor Analysis");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, "system_settings", "payments"), { upi_id: upiId }, { merge: true });
      toast.success("Settings saved successfully!");
      // write log
      await setDoc(doc(collection(db, "activity_logs")), {
        action: "UPDATE_SETTING",
        target: "upi_id",
        by: user?.email,
        timestamp: new Date()
      });
    } catch (e: any) {
      toast.error("Error saving: " + e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const savePlans = async () => {
    setSavingPlan(true);
    try {
      await setDoc(doc(db, "system_settings", "plans"), { 
         premiumPrice, 
         premiumFeatures 
      }, { merge: true });
      toast.success("Plan details saved!");
      await setDoc(doc(collection(db, "activity_logs")), {
        action: "UPDATE_PLANS",
        by: user?.email,
        timestamp: new Date()
      });
    } catch (e: any) {
      toast.error("Error saving: " + e.message);
    } finally {
      setSavingPlan(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const q = query(collection(db, "users"));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsersList(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const updateRole = async (userId: string, newRole: string, days?: number) => {
    try {
      if (newRole === 'premium' && days) {
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + days);
        await updateDoc(doc(db, "users", userId), { role: newRole, subscriptionExpiry: newExpiry });
      } else if (newRole === 'free') {
        await updateDoc(doc(db, "users", userId), { role: newRole, subscriptionExpiry: null });
      } else {
        await updateDoc(doc(db, "users", userId), { role: newRole });
      }
      toast.success("Role updated!");
      fetchUsers();
      // write log
      await setDoc(doc(collection(db, "activity_logs")), {
        action: "UPDATE_ROLE",
        targetUserId: userId,
        newRole,
        days: days || 0,
        by: user?.email,
        timestamp: new Date()
      });
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Super Admin Center</h1>
          <p className="text-slate-500 mt-1">Master control for billing, plans, and system accounts.</p>
        </div>
        <button 
          onClick={() => window.location.href = "/dashboard"}
          className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium transition-colors border border-slate-200"
        >
          Back to Dashboard
        </button>
      </div>

      <div className="flex bg-white rounded-lg p-1 border border-slate-200 mb-8 inline-flex">
        <button onClick={() => setActiveTab("admins")} className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'admins' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Users & Roles</button>
        <button onClick={() => setActiveTab("plans")} className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'plans' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Plans & Pricing</button>
        <button onClick={() => setActiveTab("logs")} className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'logs' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Activity Logs</button>
      </div>

      {activeTab === "settings" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><IndianRupee className="w-5 h-5 text-blue-600"/> Payment Configuration</h2>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Payments are configured via Razorpay integration.</p>
            <button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Save Settings
            </button>
          </div>
        </div>
      )}

      {activeTab === "admins" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-bold text-slate-800">Manage User Accounts & Roles</h2>
          </div>
          <div className="p-0">
             {loadingUsers ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
             ) : (
                <table className="w-full text-left text-sm">
                   <thead className="bg-slate-50 border-b border-slate-100">
                     <tr>
                       <th className="p-4 font-semibold text-slate-600">Email</th>
                       <th className="p-4 font-semibold text-slate-600">Current Role</th>
                       <th className="p-4 font-semibold text-slate-600">Action</th>
                     </tr>
                   </thead>
                   <tbody>
                     {usersList.map(u => (
                       <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                         <td className="p-4">{u.email}</td>
                         <td className="p-4"><span className="uppercase tracking-wider font-bold text-xs bg-slate-100 px-2 py-1 rounded">{u.role}</span></td>
                         <td className="p-4 flex gap-2">
                           {u.role !== 'admin' && <button onClick={() => updateRole(u.id, 'admin')} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium hover:bg-blue-200">Make Admin</button>}
                           {u.role !== 'free' && <button onClick={() => updateRole(u.id, 'free')} className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded font-medium hover:bg-slate-300">Make Free</button>}
                           {u.role !== 'premium' && (
                             <>
                               <button onClick={() => updateRole(u.id, 'premium', 90)} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-medium hover:bg-emerald-200">3 Months</button>
                               <button onClick={() => updateRole(u.id, 'premium', 365)} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium hover:bg-indigo-200">1 Year</button>
                             </>
                           )}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                </table>
             )}
          </div>
        </div>
      )}
      
      {activeTab === "plans" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><FileText className="w-5 h-5 text-purple-600"/> Edit Premium Plan Features</h2>
          <div className="space-y-4">
             <div className="bg-slate-50 p-3 rounded text-sm text-slate-600 mb-4">
                <strong>Current Active Plans (Razorpay Integration):</strong>
                <ul className="list-disc pl-5 mt-1">
                   <li>3 Months Plan (₹999)</li>
                   <li>1 Year Plan (₹1999)</li>
                </ul>
             </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Features (One per line)</label>
                <textarea 
                   rows={5}
                   value={premiumFeatures}
                   onChange={e => setPremiumFeatures(e.target.value)}
                   className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-purple-500 text-sm"
                />
             </div>
             <button onClick={savePlans} disabled={savingPlan} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
               {savingPlan ? <Loader2 className="w-4 h-4 animate-spin"/> : null} Save Plan Configuration
             </button>
          </div>
        </div>
      )}

      {activeTab === "logs" && (
         <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500">
             Activity logs display module goes here.
         </div>
      )}
    </div>
  );
}
