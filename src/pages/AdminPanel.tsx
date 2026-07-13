import { ShieldCheck, Users, Settings, Activity, Plus, Key, Gift, Bell, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, doc, setDoc, query, getDocs, updateDoc, getCountFromServer } from "firebase/firestore";
import { toast } from "react-hot-toast";
import { fetchWithAuth } from "../lib/api";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [upiId, setUpiId] = useState("7990878248@ybl"); // Default
  const [whatsappNumber, setWhatsappNumber] = useState("7990878248");
  const [savingSettings, setSavingSettings] = useState(false);

  // Fetch settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDocs(query(collection(db, "system_settings")));
        snap.forEach(d => {
          if (d.id === "payments") {
            setUpiId(d.data().upi_id || "7990878248@ybl");
            setWhatsappNumber(d.data().whatsapp_number || "7990878248");
          }
        });
      } catch (e) {}
    }
    fetchSettings();
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, "system_settings", "payments"), {
        upi_id: upiId,
        whatsapp_number: whatsappNumber,
        updatedAt: new Date()
      }, { merge: true });
      toast.success("Settings saved successfully!");
    } catch (e: any) {
      toast.error("Failed to save settings: " + e.message);
    }
    setSavingSettings(false);
  };

  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      setUsersLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "users")));
        const userList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        setUsers(userList);
      } catch (e) {
        console.error(e);
      }
      setUsersLoading(false);
    };
    fetchUsers();
  }, []);

  const updateRole = async (userId: string, newRole: string) => {
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast.success(`User role set to ${newRole}`);
    } catch (error: any) {
      toast.error("Failed to update user: " + error.message);
    }
  };

  const grantCreditsToUser = async (userId: string, credits: number) => {
    try {
      const res = await fetchWithAuth("/api/admin/grant-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: userId, credits }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      setUsers(users.map(u => u.id === userId ? { ...u, creditsTotal: (u.creditsTotal || 0) + credits } : u));
      toast.success(`Granted ${credits} credit${credits !== 1 ? "s" : ""}`);
    } catch (error: any) {
      toast.error("Failed to grant credits: " + error.message);
    }
  };

  const [activationCode, setActivationCode] = useState("");
  const [activationDays, setActivationDays] = useState(30);
  const [recentCodes, setRecentCodes] = useState<any[]>([]);

  // Fetch recent codes
  useEffect(() => {
    if (activeTab === "activation") {
      const fetchCodes = async () => {
        try {
          const snap = await getDocs(query(collection(db, "activation_codes")));
          const codes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a: any, b: any) => b.createdAt?.toMillis() - a.createdAt?.toMillis())
            .slice(0, 10);
          setRecentCodes(codes);
        } catch (e) {
          console.error(e);
        }
      };
      fetchCodes();
    }
  }, [activeTab]);

  const generateActivationCode = async () => {
    const code = "ACT-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await setDoc(doc(db, "activation_codes", code), {
        code,
        durationDays: activationDays,
        status: "active",
        used: false,
        createdAt: new Date(),
      });
      setActivationCode(code);
      toast.success(`Activation code generated successfully for ${activationDays} days!`);
      // Refresh list
      setRecentCodes(prev => [{
        id: code,
        code,
        durationDays: activationDays,
        status: "active",
        used: false,
        createdAt: new Date()
      }, ...prev].slice(0, 10));
    } catch (e: any) {
      toast.error("Error: " + e.message);
    }
  };

  const [couponCode, setCouponCode] = useState("");
  const generateCouponCode = async () => {
    const code = "DISC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await setDoc(doc(db, "coupons", code), {
        code,
        discountPercent: 20, // default 20%
        status: "active",
        createdAt: new Date(),
      });
      setCouponCode(code);
      toast.success("Coupon code generated successfully!");
    } catch (e: any) {
      toast.error("Error: " + e.message);
    }
  };

  const [totalProjects, setTotalProjects] = useState<number | null>(null);
  useEffect(() => {
    getCountFromServer(collection(db, "saved_tenders"))
      .then(snap => setTotalProjects(snap.data().count))
      .catch(() => {});
  }, []);

  const activeSubscriptions = users.filter(u => {
    if (u.role === 'admin' || u.role === 'superadmin') return true;
    const total = u.creditsTotal || 0;
    const used = u.creditsUsed || 0;
    const expiry = u.creditsExpiry?.toDate ? u.creditsExpiry.toDate() : null;
    return total > used && (!expiry || expiry > new Date());
  }).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Admin Control Center</h1>
          <p className="text-slate-500 mt-1">Platform management and daily operations.</p>
        </div>
        <button 
          onClick={() => window.location.href = "/dashboard"}
          className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium transition-colors border border-slate-200"
        >
          Back to Dashboard
        </button>
      </div>

      <div className="flex bg-white rounded-lg p-1 border border-slate-200 mb-8 inline-flex overflow-x-auto max-w-full">
        <button onClick={() => setActiveTab("dashboard")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'dashboard' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Dashboard</button>
        <button onClick={() => setActiveTab("users")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'users' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Users List</button>
        <button onClick={() => setActiveTab("coupons")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'coupons' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Coupons</button>
        <button onClick={() => setActiveTab("customers")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'customers' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Add Customer</button>
        <button onClick={() => setActiveTab("notifications")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'notifications' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Send Notifications</button>
      </div>

      {activeTab === "dashboard" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                   <Users className="w-5 h-5 text-blue-400" />
                </div>
             </div>
             <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Total Users</p>
             <h3 className="text-3xl font-black mt-1">{users.length}</h3>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                   <FileText className="w-5 h-5 text-emerald-400" />
                </div>
             </div>
             <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Total Analyses</p>
             <h3 className="text-3xl font-black mt-1">{totalProjects === null ? '…' : totalProjects}</h3>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                   <ShieldCheck className="w-5 h-5 text-purple-400" />
                </div>
             </div>
             <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Active Subscriptions</p>
             <h3 className="text-3xl font-black mt-1">{usersLoading ? '…' : activeSubscriptions}</h3>
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-slate-600"/> Platform Settings</h2>
          
          <div className="space-y-4">
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment UPI ID</label>
                <input 
                  type="text" 
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500" 
                  placeholder="e.g. 7990878248@ybl" 
                />
             </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp Verification Number</label>
                <input 
                  type="text" 
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500" 
                  placeholder="e.g. +917990878248" 
                />
                <p className="text-xs text-slate-500 mt-1">Users will be directed to this number to send their payment screenshot.</p>
             </div>
             <button 
               onClick={saveSettings} 
               disabled={savingSettings}
               className="w-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-3 rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
             >
               {savingSettings ? "Saving..." : "Save Settings"}
             </button>
          </div>
        </div>
      )}

      {activeTab === "activation" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Key className="w-5 h-5 text-emerald-600"/> Generate Activation Code</h2>
            <p className="text-sm text-slate-600 mb-6">Create a one-time activation code to upgrade a user to premium after confirming their payment on UPI <strong>{upiId}</strong>.</p>
            
            <div className="mb-4">
               <label className="block text-sm font-medium text-slate-700 mb-1">Duration (Days)</label>
               <input 
                 type="number" 
                 value={activationDays} 
                 onChange={(e) => setActivationDays(parseInt(e.target.value) || 30)}
                 className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-emerald-500" 
                 min="1"
               />
            </div>

            <button onClick={generateActivationCode} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors">
              <Plus className="w-4 h-4"/> Generate New Code
            </button>

            {activationCode && (
              <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                <p className="text-xs font-bold text-emerald-800 uppercase tracking-widest mb-1">New Code Genereated</p>
                <div className="text-2xl font-black text-emerald-900 tracking-wider font-mono">{activationCode}</div>
                <p className="text-xs text-emerald-600 mt-2">Share this code securely with the customer.</p>
              </div>
            )}
          </div>
          
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Recent Codes</h2>
            {recentCodes.length === 0 ? (
              <p className="text-sm text-slate-500">No codes generated yet.</p>
            ) : (
              <div className="space-y-3">
                {recentCodes.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-3 rounded-lg border border-slate-100 bg-slate-50">
                    <div>
                      <div className="font-mono font-bold text-slate-800">{c.code}</div>
                      <div className="text-xs text-slate-500">{c.durationDays} Days • {new Date(c.createdAt?.toMillis ? c.createdAt.toMillis() : Date.now()).toLocaleDateString()}</div>
                    </div>
                    <div>
                      {c.used ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="px-2 py-1 bg-slate-200 text-slate-600 text-xs font-bold rounded">USED</span>
                          {c.usedAt?.toDate && <span className="text-xs text-slate-500">on {c.usedAt.toDate().toLocaleDateString()}</span>}
                          {c.usedBy && <span className="text-[10px] text-slate-400 font-mono">by: {c.usedBy}</span>}
                        </div>
                      ) : (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded">ACTIVE</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {activeTab === "coupons" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Gift className="w-5 h-5 text-purple-600"/> Discount Coupons</h2>
          <p className="text-sm text-slate-600 mb-6">Create promotional discount codes for new signups.</p>
          
          <button onClick={generateCouponCode} className="w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors">
            <Plus className="w-4 h-4"/> Generate Auto Coupon
          </button>

          {couponCode && (
            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg text-center">
              <p className="text-xs font-bold text-purple-800 uppercase tracking-widest mb-1">New Coupon created</p>
              <div className="text-2xl font-black text-purple-900 tracking-wider font-mono">{couponCode}</div>
            </div>
          )}
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Bell className="w-5 h-5 text-blue-600"/> Broadcast Notification</h2>
          <div className="space-y-4">
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input type="text" className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500" placeholder="e.g. System Maintenance" />
             </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                <textarea className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500" placeholder="Your message here..." rows={4}></textarea>
             </div>
             <button className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-bold text-sm transition-colors">Send to All Users</button>
          </div>
        </div>
      )}

      {activeTab === "users" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600"/> Registered Users</h2>
          
          {usersLoading ? (
            <div className="text-center py-8 text-slate-500">Loading users...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-sm">
                    <th className="p-3 font-semibold text-slate-700">User Details</th>
                    <th className="p-3 font-semibold text-slate-700">Contact</th>
                    <th className="p-3 font-semibold text-slate-700">Plan Status</th>
                    <th className="p-3 font-semibold text-slate-700">Joined Date</th>
                    <th className="p-3 font-semibold text-slate-700 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => {
                    const isAdmin = u.role === 'admin' || u.role === 'superadmin';
                    const creditsLeft = (u.creditsTotal || 0) - (u.creditsUsed || 0);
                    const hasCredits = isAdmin || creditsLeft > 0;

                    return (
                      <tr key={u.id} className="text-sm hover:bg-slate-50 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-slate-800">{u.name || "N/A"}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{u.email}</div>
                        </td>
                        <td className="p-3">
                          <div className="text-slate-700">{u.phone || "N/A"}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${isAdmin ? 'bg-blue-100 text-blue-700' : hasCredits ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                              {(u.role || 'free').toUpperCase()}
                            </span>
                            {u.creditsTotal !== undefined && !isAdmin && (
                              <span className="text-xs text-slate-500">
                                {u.creditsUsed || 0}/{u.creditsTotal} credits used
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-slate-600">
                          {u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {u.role !== 'admin' && <button onClick={() => updateRole(u.id, 'admin')} className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded hover:bg-blue-200">Make Admin</button>}
                            {u.role !== 'free' && <button onClick={() => updateRole(u.id, 'free')} className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200">Make Free</button>}
                            <button onClick={() => grantCreditsToUser(u.id, 10)} className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded hover:bg-emerald-200">+10 Credits</button>
                            <button onClick={() => grantCreditsToUser(u.id, 20)} className="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded hover:bg-indigo-200">+20 Credits</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "customers" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600"/> Pre-Register Customer</h2>
          <p className="text-sm text-slate-600 mb-6">Manually provision a customer account via email.</p>
          <div className="space-y-4">
             <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer Email</label>
                <input type="email" className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500" placeholder="customer@example.com" />
             </div>
             <button onClick={() => toast.success('Backend API endpoint required to safely bypass client auth creation limits. Use activation codes as primary onboarding flow.')} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-lg font-bold text-sm transition-colors">Create Account</button>
          </div>
        </div>
      )}

    </div>
  );
}
