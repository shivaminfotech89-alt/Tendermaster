import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ExternalLink, Save, Bell, Shield, Key, User, Settings2, Loader2, IndianRupee } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { fetchWithAuth } from "../lib/api";
import { PLANS } from "../lib/plans";

export default function Settings() {
  const { user, role, credits } = useAuth();
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("tab") || "account";
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [location.search]);

  const [activationCode, setActivationCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [checkingOut, setCheckingOut] = useState<number | null>(null);
  const [upiId, setUpiId] = useState("");
  useEffect(() => {
    getDoc(doc(db, "system_settings", "payments")).then(snap => {
      if(snap.exists()) setUpiId(snap.data().upi_id || "");
    });
  }, []);

  const creditsLeft = credits.total - credits.used;
  const creditsExpiryStr = credits.expiry
    ? credits.expiry.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const isAdmin = role === "admin" || role === "superadmin";

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
            name: user.displayName || "User"
          },
          callback_url: callbackUrl.toString()
        })
      });
      
      let paymentLink;
      try {
        const text = await response.text();
        try {
          paymentLink = JSON.parse(text);
        } catch (e) {
          throw new Error("Invalid response JSON. Body: " + text.substring(0, 100));
        }
      } catch (e) {
        throw e;
      }
      
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
        
        let errData;
        try { errData = await res.json(); } catch(e) { errData = { error: "A server error occurred." }; }
  
        throw new Error(errData.error || "Failed to redeem code");
      }
      
        let data;
        try { data = await res.json(); } catch(e) { throw new Error("A server error occurred. Please try again."); }
  
      // Server has already written role/subscriptionExpiry via Admin SDK.
      // The onSnapshot listener in AuthProvider will pick up the change automatically.
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
                 
        let data;
        try { data = await res.json(); } catch(e) { throw new Error("A server error occurred. Please try again."); }
  
                 // Server has already written role/subscriptionExpiry via Admin SDK.
                 // The onSnapshot listener in AuthProvider will pick up the change automatically.
                 toast.dismiss();
                 toast.success("Payment verified! Your account is upgraded to Premium.");
                 setTimeout(() => {
                    window.location.href = "/dashboard/settings";
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
             <div className="max-w-lg space-y-6">
                <div>
                   <h2 className="text-xl font-bold text-slate-900">Credits & Billing</h2>
                   <p className="text-sm text-slate-500 mt-1">Each credit = 1 tender analysis. Credits never expire for 24 months from purchase.</p>
                </div>

                {/* Credits balance card */}
                {isAdmin ? (
                  <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                    <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-1">Account Type</p>
                    <h3 className="text-2xl font-black text-indigo-900 uppercase">{role}</h3>
                    <p className="text-sm text-indigo-700 mt-1">Unlimited access — credits not consumed</p>
                  </div>
                ) : (
                  <div className={`border p-4 rounded-xl ${credits.hasCredits ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                    <p className="text-xs font-bold uppercase tracking-widest mb-1 ${credits.hasCredits ? 'text-emerald-600' : 'text-rose-600'}">Credits Remaining</p>
                    <div className="flex items-end gap-2">
                      <span className={`text-4xl font-black ${credits.hasCredits ? "text-emerald-700" : "text-rose-700"}`}>{creditsLeft}</span>
                      <span className="text-slate-500 text-sm mb-1">of {credits.total} total</span>
                    </div>
                    {credits.total > 0 && (
                      <div className="mt-2 bg-white/60 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${credits.hasCredits ? "bg-emerald-500" : "bg-rose-400"}`}
                          style={{ width: `${Math.max(0, Math.min(100, (creditsLeft / credits.total) * 100))}%` }}
                        />
                      </div>
                    )}
                    {creditsExpiryStr && (
                      <p className="text-xs text-slate-500 mt-2">Valid until {creditsExpiryStr}</p>
                    )}
                    {!credits.hasCredits && (
                      <p className="text-xs font-semibold text-rose-600 mt-2">Purchase credits below to run new analyses. Your existing data stays accessible.</p>
                    )}
                  </div>
                )}

                {/* Buy credits */}
                {!isAdmin && (
                  <div className="space-y-4">
                    <p className="text-sm font-semibold text-slate-700">Top up credits — stacks with existing balance</p>
                    <div className="grid grid-cols-1 gap-4">
                      {PLANS.filter(p => !p.adminOnly).map((plan, i) => {
                        const featured = i === 1;
                        const features = i === 0
                          ? ["10 tender analyses", "All AI features", "24-month validity"]
                          : ["20 tender analyses", "All AI features", "24-month validity", "Best value per analysis"];
                        return (
                          <div
                            key={plan.amountPaise}
                            className={`rounded-2xl p-5 text-white shadow-lg relative overflow-hidden flex flex-col md:flex-row md:items-center gap-4 ${
                              featured
                                ? "bg-gradient-to-br from-indigo-900 to-purple-900"
                                : "bg-gradient-to-br from-slate-900 to-slate-800"
                            }`}
                          >
                            {featured && (
                              <span className="absolute top-3 right-4 bg-indigo-500/40 text-indigo-100 text-xs font-bold px-2 py-0.5 rounded">BEST VALUE</span>
                            )}
                            <div className="flex-1">
                              <div className="font-bold text-lg">{plan.label}</div>
                              <div className="text-3xl font-extrabold">₹{plan.amountRupees.toLocaleString('en-IN')}</div>
                              <div className={`text-sm mt-1 ${featured ? "text-indigo-300" : "text-slate-400"}`}>{plan.credits} credits · 24-month validity</div>
                              <ul className={`mt-2 space-y-1 text-sm ${featured ? "text-indigo-100" : "text-slate-300"}`}>
                                {features.map(f => <li key={f}>✓ {f}</li>)}
                              </ul>
                            </div>
                            <button
                              onClick={() => handleCheckout(plan.amountRupees)}
                              disabled={checkingOut === plan.amountRupees}
                              className={`shrink-0 font-bold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 ${
                                featured ? "bg-indigo-500 hover:bg-indigo-400" : "bg-blue-600 hover:bg-blue-700"
                              } text-white disabled:opacity-60`}
                            >
                              {checkingOut === plan.amountRupees ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buy Credits"}
                            </button>
                          </div>
                        );
                      })}

                      {/* Admin test plan — only for admins */}
                      {isAdmin && PLANS.filter(p => p.adminOnly).map(plan => (
                        <div key={plan.amountPaise} className="rounded-2xl p-5 bg-amber-50 border-2 border-amber-300 flex flex-col md:flex-row md:items-center gap-4">
                          <div className="flex-1">
                            <div className="font-bold text-amber-800">₹1 Admin Test</div>
                            <div className="text-sm text-amber-700">Verifies the live payment cycle · 1 credit</div>
                          </div>
                          <button
                            onClick={() => handleCheckout(plan.amountRupees)}
                            disabled={checkingOut === plan.amountRupees}
                            className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-5 rounded-xl disabled:opacity-60 flex items-center gap-2"
                          >
                            {checkingOut === plan.amountRupees ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test Payment"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual payment / activation code */}
                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-2">Redeem Activation Code</h3>
                  {upiId && (
                    <p className="text-sm text-slate-600 mb-3">
                      Paid via UPI to <strong>{upiId}</strong>? Request a code from support and redeem it here.
                    </p>
                  )}
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={activationCode}
                      onChange={(e) => setActivationCode(e.target.value)}
                      placeholder="Enter activation code"
                      className="flex-1 bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleActivate}
                      disabled={!activationCode || activating}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
                    >
                      {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Redeem"}
                    </button>
                  </div>
                </div>
             </div>
           )}

           {/* Email Preferences tab — no email service / cron exists; hidden until backend is wired.
           activeTab === "notifications" && (
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
           )
           */}
           
           {activeTab === "preferences" && (
              <div className="max-w-2xl space-y-6">
                 <div>
                    <h2 className="text-xl font-bold text-slate-900">General Preferences</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure your app experience and notifications.</p>
                 </div>
                 
                 {/* Email Notifications — no email service exists; hidden until backend is wired.
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
                 */}
                 {/* Weekly Digest — no email backend / cron yet; hidden until wired.
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
                 */}
                 {/* </div> (closing tag of email preferences card — hidden with the rows above) */}

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
