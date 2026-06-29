import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Save, Bell, Shield, Key, User, Settings2, IndianRupee, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { toast } from 'react-hot-toast';

export default function Settings() {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("account");

  const [activationCode, setActivationCode] = useState("");
  const [activating, setActivating] = useState(false);
  
  const [upiId, setUpiId] = useState("7990878248@ybl");
  const [premiumPrice, setPremiumPrice] = useState("999");
  const [premiumFeatures, setPremiumFeatures] = useState(["Unlimited Tender Analysis", "Automated Document Generation", "Dedicated Tender Chat AI", "PDF Exports & Competitor Analysis"]);

  useEffect(() => {
    const fetchSettings = async () => {
       try {
         const snap = await getDoc(doc(db, "system_settings", "payments"));
         if (snap.exists() && snap.data().upi_id) setUpiId(snap.data().upi_id);
         
         const pSnap = await getDoc(doc(db, "system_settings", "plans"));
         if (pSnap.exists()) {
             if (pSnap.data().premiumPrice) setPremiumPrice(pSnap.data().premiumPrice);
             if (pSnap.data().premiumFeatures) {
                 setPremiumFeatures(pSnap.data().premiumFeatures.split("\n").filter((f:string) => f.trim() !== ""));
             }
         }
       } catch (e) {}
    };
    fetchSettings();
  }, []);

  if (!user) return null;

  const handleSave = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success("Preferences saved successfully");
    }, 800);
  };

  const handleActivate = async () => {
    if (!activationCode) return;
    setActivating(true);
    try {
      const codeRef = doc(db, "activation_codes", activationCode);
      const codeSnap = await getDoc(codeRef);
      if (!codeSnap.exists() || codeSnap.data().status !== "active") {
         throw new Error("Invalid or already used activation code");
      }
      
      // Update code
      await updateDoc(codeRef, { status: "used", usedBy: user.email, usedAt: new Date() });
      
      // Upgrade user
      await updateDoc(doc(db, "users", user.uid), { role: "premium" });
      
      toast.success("Success! Your account has been upgraded to PREMIUM. Please refresh the page.");
      window.location.reload();
    } catch (e: any) {
      toast.error("Activation failed: " + e.message);
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-slate-500 mt-1">Manage your account preferences and application configuration.</p>
      </div>

      <div className="bg-white p-0 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-slate-50 border-r border-slate-100 p-6 flex flex-col gap-1">
           <button onClick={() => setActiveTab("account")} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left ${activeTab === 'account' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
             <User className="w-4 h-4" /> Account
           </button>
           <button onClick={() => setActiveTab("subscription")} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left ${activeTab === 'subscription' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
             <Shield className="w-4 h-4" /> Subscription
           </button>
           <button onClick={() => setActiveTab("notifications")} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'notifications' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
             <Bell className="w-4 h-4" /> Notifications
           </button>
           <button onClick={() => setActiveTab("preferences")} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'preferences' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
             <Settings2 className="w-4 h-4" /> Preferences
           </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-8">
           {activeTab === "account" && (
             <div className="max-w-md space-y-6">
                <div>
                   <h2 className="text-xl font-bold text-slate-900">Account Details</h2>
                   <p className="text-sm text-slate-500 mt-1">Update your personal account information.</p>
                </div>

                <div className="space-y-4">
                   <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                     <input type="email" disabled value={user.email || ''} className="w-full bg-slate-50 border border-slate-200 text-slate-500 text-sm rounded-lg block p-2.5 cursor-not-allowed" />
                     <p className="text-xs text-slate-400 mt-1">Email address is tied to your primary authentication provider.</p>
                   </div>
                   
                   <div>
                     <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                     <input type="text" placeholder="Your name" className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5" />
                   </div>

                   <hr className="border-slate-100" />

                   <div className="pt-4">
                      <button 
                         onClick={handleSave}
                         disabled={loading}
                         className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2.5 px-6 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
                      >
                         {loading ? <span className="animate-pulse">Saving...</span> : <><Save className="w-4 h-4" /> Save Changes</>}
                      </button>
                   </div>
                </div>
             </div>
           )}

           {activeTab === "subscription" && (
             <div className="max-w-md space-y-6">
                <div>
                   <h2 className="text-xl font-bold text-slate-900">Plan & Billing</h2>
                   <p className="text-sm text-slate-500 mt-1">Manage your current subscription and limits.</p>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
                   <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Current Plan</p>
                      <h3 className="text-2xl font-black text-indigo-900 uppercase">{role || "FREE"}</h3>
                   </div>
                   {role !== 'premium' && role !== 'admin' && role !== 'superadmin' && (
                     <div className="text-right">
                        <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded">UPGRADE AVAILABLE</span>
                     </div>
                   )}
                </div>

                {role === "free" && (
                  <div className="mt-8 space-y-8">
                     
                     <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                           <Shield className="w-32 h-32" />
                        </div>
                        <div className="relative z-10">
                           <span className="bg-indigo-500/30 text-indigo-100 text-xs font-bold px-2 py-1 rounded inline-block mb-3">RECOMMENDED</span>
                           <h3 className="text-2xl font-black mb-1">Premium Plan</h3>
                           <div className="text-4xl font-extrabold mb-4 flex items-baseline gap-1">
                              ₹{premiumPrice} <span className="text-lg font-medium text-indigo-300">/ month</span>
                           </div>
                           
                           <ul className="space-y-2 mb-6">
                              {premiumFeatures.map((feat, i) => (
                                 <li key={i} className="flex items-start gap-2 text-sm text-indigo-100">
                                   <div className="mt-1 w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0"></div>
                                   {feat}
                                 </li>
                              ))}
                           </ul>
                        </div>
                     </div>

                     <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Manual Upgrade via UPI</h3>
                        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                           To upgrade to the Premium Plan, please transfer <strong className="text-slate-900">₹{premiumPrice}</strong> to our official UPI ID <strong className="text-slate-800 bg-slate-100 px-1 py-0.5 rounded">{upiId}</strong>. Once payment is confirmed, contact our administration to receive your one-time activation code.
                        </p>
                        
                        <div className="space-y-4 border border-slate-200 p-4 rounded-xl bg-white">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Have an Activation Code?</label>
                          <input 
                             type="text" 
                             value={activationCode}
                             onChange={e => setActivationCode(e.target.value.toUpperCase())}
                             placeholder="e.g. ACT-X7B9F1" 
                             className="w-full font-mono font-bold bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5" 
                          />
                        </div>
                        <button 
                           onClick={handleActivate}
                           disabled={activating || !activationCode}
                           className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold py-2.5 px-6 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
                        >
                           {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />} Redeem Code
                        </button>
                     </div>
                  </div>
                </div>
                )}
             </div>
           )}

           {activeTab === "notifications" && (
              <div className="max-w-md space-y-6">
                 <div>
                    <h2 className="text-xl font-bold text-slate-900">Email Preferences</h2>
                    <p className="text-sm text-slate-500 mt-1">Choose what we email you about.</p>
                 </div>
                 <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" defaultChecked className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" />
                      <span className="text-sm text-slate-700">Tender Alerts & Deadlines</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" defaultChecked className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" />
                      <span className="text-sm text-slate-700">Weekly Performance Report</span>
                    </label>
                 </div>
              </div>
           )}
           
           {activeTab === "preferences" && (
              <div className="max-w-md space-y-6">
                 <div>
                    <h2 className="text-xl font-bold text-slate-900">General Preferences</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure your app experience.</p>
                 </div>
              </div>
           )}

        </div>
      </div>
    </div>
  );
}
