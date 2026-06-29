import { ShieldCheck, Users, Settings, Activity, Plus, Key, Gift, Bell } from "lucide-react";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, doc, setDoc, query, getDocs } from "firebase/firestore";
import { toast } from "react-hot-toast";

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [upiId, setUpiId] = useState("7990878248@ybl"); // Default

  // Fetch UPI ID from settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDocs(query(collection(db, "system_settings")));
        snap.forEach(d => {
          if (d.id === "payments") setUpiId(d.data().upi_id || "7990878248@ybl");
        });
      } catch (e) {}
    }
    fetchSettings();
  }, []);

  const [activationCode, setActivationCode] = useState("");
  const generateActivationCode = async () => {
    const code = "ACT-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      await setDoc(doc(db, "activation_codes", code), {
        code,
        status: "active",
        createdAt: new Date(),
      });
      setActivationCode(code);
      toast.success("Activation code generated successfully!");
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

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Admin Control Center</h1>
          <p className="text-slate-500 mt-1">Platform management and daily operations.</p>
        </div>
        <button 
          onClick={() => window.location.href = "/"}
          className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium transition-colors border border-slate-200"
        >
          Back to Main App
        </button>
      </div>

      <div className="flex bg-white rounded-lg p-1 border border-slate-200 mb-8 inline-flex overflow-x-auto max-w-full">
        <button onClick={() => setActiveTab("dashboard")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'dashboard' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Dashboard</button>
        <button onClick={() => setActiveTab("activation")} className={`whitespace-nowrap px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === 'activation' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Activation Codes</button>
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
             <h3 className="text-3xl font-black mt-1">1,204</h3>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                   <Activity className="w-5 h-5 text-emerald-400" />
                </div>
             </div>
             <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">API Calls (Last 24h)</p>
             <h3 className="text-3xl font-black mt-1">8,492</h3>
          </div>

          <div className="bg-slate-900 text-white p-6 rounded-xl shadow-sm border border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                   <ShieldCheck className="w-5 h-5 text-purple-400" />
                </div>
             </div>
             <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Active Subscriptions</p>
             <h3 className="text-3xl font-black mt-1">328</h3>
          </div>
        </div>
      )}

      {activeTab === "activation" && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-lg">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Key className="w-5 h-5 text-emerald-600"/> Generate Activation Code</h2>
          <p className="text-sm text-slate-600 mb-6">Create a one-time activation code to upgrade a user to premium after confirming their payment on UPI <strong>{upiId}</strong>.</p>
          
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
