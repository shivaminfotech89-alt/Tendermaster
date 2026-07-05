import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ExternalLink, Save, Bell, Shield, Key, User, Settings2, Loader2, IndianRupee } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { fetchWithAuth } from "../lib/api";

export default function Settings() {
  const { user, role, subscriptionExpiry } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("account");

  const [activationCode, setActivationCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [checkingOut, setCheckingOut] = useState<number | null>(null);
  
  const [premiumFeatures, setPremiumFeatures] = useState(["Unlimited Tender Analysis", "Automated Document Generation", "Dedicated Tender Chat AI", "PDF Exports & Competitor Analysis"]);

  const daysRemaining = subscriptionExpiry ? Math.max(0, Math.ceil((subscriptionExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) : 0;

  useEffect(() => {
    // Load Razorpay Script
    if (!document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  
  const handleCheckout = async (amountInRupees: number) => {
    if (!user) {
      toast.error("Please login to continue");
      return;
    }

    setCheckingOut(amountInRupees);
    try {
      // Get the current URL base to return to after payment
      const callbackUrl = new URL(window.location.href);
      callbackUrl.searchParams.set("payment", "success");
      callbackUrl.searchParams.set("amount", amountInRupees.toString());

      const response = await fetchWithAuth('/api/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          amount: amountInRupees * 100, 
          description: "Premium Subscription",
          customer: {
            email: user.email || "",
            contact: "9999999999" // Fallback contact
          },
          callback_url: callbackUrl.toString()
        })
      });
      
      const paymentLink = await response.json();
      
      if (!response.ok) {
        throw new Error(paymentLink.error || "Failed to create payment link");
      }

      if (paymentLink.short_url) {
         // Open the payment link in a new tab
         window.open(paymentLink.short_url, '_blank');
         toast.success("Payment link opened in a new tab. Please complete the payment there.");
         setCheckingOut(null);
      } else {
         throw new Error("Invalid payment link returned");
      }

    } catch (err: any) {
      toast.error(err.message || "Checkout failed");
      setCheckingOut(null);
    }
  };

  const handleActivate = async () => {
    if (!activationCode) return;
    setActivating(true);
    try {
      const res = await fetchWithAuth('/api/activate-code', {
        method: 'POST',
        body: JSON.stringify({ code: activationCode })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to redeem code");
      }
      const data = await res.json();
      if (data.success && data.newExpiry) {
        const { doc, updateDoc, Timestamp } = await import('firebase/firestore');
        const { db } = await import('../lib/firebase');
        if (user) {
          await updateDoc(doc(db, 'users', user.uid), {
            role: 'premium',
            subscriptionExpiry: Timestamp.fromDate(new Date(data.newExpiry))
          });
        }
      }
      toast.success(data.message || "Success! Your account has been upgraded to PREMIUM. Please refresh the page.");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e: any) {
      toast.error("Activation failed: " + e.message);
    } finally {
      setActivating(false);
    }
  };


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      const pId = params.get('razorpay_payment_id');
      const plId = params.get('razorpay_payment_link_id');
      const refId = params.get('razorpay_payment_link_reference_id');
      const status = params.get('razorpay_payment_link_status');
      const sig = params.get('razorpay_signature');
      const amount = params.get('amount') || "999";

      if (pId && sig) {
         const verifyPayment = async () => {
            if (user) {
               toast.loading("Verifying payment security signature...");
               try {
                 const res = await fetchWithAuth('/api/verify-payment', {
                    method: 'POST',
                    body: JSON.stringify({
                       razorpay_payment_id: pId,
                       razorpay_payment_link_id: plId,
                       razorpay_payment_link_reference_id: refId,
                       razorpay_payment_link_status: status,
                       razorpay_signature: sig,
                       amount: amount
                    })
                 });
                 const data = await res.json();
                 if (data.success && data.newExpiry) {
                    const { doc, updateDoc, Timestamp } = await import('firebase/firestore');
                    const { db } = await import('../lib/firebase');
                    if (user) {
                       await updateDoc(doc(db, 'users', user.uid), {
                          role: 'premium',
                          subscriptionExpiry: Timestamp.fromDate(new Date(data.newExpiry)),
                          paymentId: pId
                       });
                    }
                 }
                 toast.dismiss();
                 toast.success("Payment verified! Your account is upgraded to Premium.");
                 setTimeout(() => {
                    window.location.href = "/settings";
                 }, 2000);
               } catch (e: any) {
                 toast.dismiss();
                 toast.error("Security verification failed: " + e.message);
               }
            }
         };
         verifyPayment();
      } else {
         toast.success("Payment link processed. Awaiting confirmation.");
      }
    }
  }, [user]);

  const handleSave = async () => {
     setLoading(true);
     setTimeout(() => { setLoading(false); toast.success("Saved"); }, 1000);
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
                   {role !== 'premium' && role !== 'admin' && role !== 'superadmin' ? (
                     <div className="text-right">
                        <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2 py-1 rounded">UPGRADE AVAILABLE</span>
                     </div>
                   ) : (
                     <div className="text-right">
                        <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded mb-1 inline-block">ACTIVE</span>
                        {role === 'premium' && <div className="text-xs text-slate-500 font-semibold">{daysRemaining} days remaining</div>}
                     </div>
                   )}
                </div>

                 {role !== "premium" && (
                  <div className="mt-8 space-y-8">
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                       {/* 3 Months Plan */}
                       <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden flex flex-col">
                          <div className="absolute top-0 right-0 p-4 opacity-5">
                             <Shield className="w-32 h-32" />
                          </div>
                          <div className="relative z-10 flex-1">
                             <h3 className="text-xl font-bold mb-1 text-slate-200">Quarterly Plan</h3>
                             <div className="text-3xl font-extrabold mb-4 flex items-baseline gap-1">
                                ₹999 <span className="text-sm font-medium text-slate-400">/ 3 months</span>
                             </div>
                             
                             <ul className="space-y-2 mb-6 text-sm text-slate-300">
                                {premiumFeatures.map((feat, i) => (
                                   <li key={i} className="flex items-start gap-2">
                                     <div className="mt-1 w-1.5 h-1.5 bg-blue-400 rounded-full shrink-0"></div>
                                     {feat}
                                   </li>
                                ))}
                             </ul>
                          </div>
                          <div className="relative z-10">
                             <button onClick={() => handleCheckout(999)} disabled={checkingOut === 999} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                               {checkingOut === 999 ? <Loader2 className="w-5 h-5 animate-spin" /> : "Subscribe Now"}
                             </button>
                          </div>
                       </div>

                       {/* 1 Year Plan */}
                       <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden flex flex-col border border-indigo-500/30">
                          <div className="absolute top-0 right-0 p-4 opacity-10">
                             <Shield className="w-32 h-32" />
                          </div>
                          <div className="relative z-10 flex-1">
                             <span className="bg-indigo-500/30 text-indigo-100 text-xs font-bold px-2 py-1 rounded inline-block mb-3">BEST VALUE</span>
                             <h3 className="text-xl font-bold mb-1 text-indigo-100">Yearly Plan</h3>
                             <div className="text-3xl font-extrabold mb-4 flex items-baseline gap-1">
                                ₹1999 <span className="text-sm font-medium text-indigo-300">/ year</span>
                             </div>
                             
                             <ul className="space-y-2 mb-6 text-sm text-indigo-100">
                                {premiumFeatures.map((feat, i) => (
                                   <li key={i} className="flex items-start gap-2">
                                     <div className="mt-1 w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0"></div>
                                     {feat}
                                   </li>
                                ))}
                             </ul>
                          </div>
                          <div className="relative z-10">
                             <button onClick={() => handleCheckout(1999)} disabled={checkingOut === 1999} className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-300 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/50">
                               {checkingOut === 1999 ? <Loader2 className="w-5 h-5 animate-spin" /> : "Subscribe Now"}
                             </button>
                          </div>
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
              <div className="max-w-2xl space-y-6">
                 <div>
                    <h2 className="text-xl font-bold text-slate-900">General Preferences</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure your app experience and notifications.</p>
                 </div>
                 
                 <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                       <div>
                          <h3 className="font-semibold text-slate-900">Email Notifications</h3>
                          <p className="text-sm text-slate-500 mt-1">Receive updates about new tenders and analysis results.</p>
                       </div>
                       <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                       </label>
                    </div>
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                       <div>
                          <h3 className="font-semibold text-slate-900">Weekly Digest</h3>
                          <p className="text-sm text-slate-500 mt-1">Get a weekly summary of matching tenders and insights.</p>
                       </div>
                       <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" defaultChecked />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                       </label>
                    </div>
                 </div>

                 <div>
                    <h2 className="text-xl font-bold text-slate-900 mt-8">Legal & Compliance</h2>
                    <p className="text-sm text-slate-500 mt-1">Important documents and policies.</p>
                 </div>

                 <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <button onClick={() => window.open('/privacy', '_blank')} className="w-full p-4 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
                       <span className="font-medium text-slate-800">Privacy Policy</span>
                       <ExternalLink className="w-4 h-4 text-slate-400" />
                    </button>
                    <button onClick={() => window.open('/terms', '_blank')} className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                       <span className="font-medium text-slate-800">Terms & Conditions</span>
                       <ExternalLink className="w-4 h-4 text-slate-400" />
                    </button>
                 </div>
              </div>
           )}

        </div>
      </div>
    </div>
  );
}
