import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, FileText, Zap, Shield, ArrowRight, Menu, X, Play, Check } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import toast from 'react-hot-toast';

export default function LandingPage() {
  const { user } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navigate = useNavigate();
  const handleRazorpayClick = async (amount: number) => {
    if (!user) {
      toast("Please create an account first to subscribe.");
      navigate('/login');
      return;
    }
    
    try {
      const { fetchWithAuth } = await import('../lib/api');
      const toast = (await import('react-hot-toast')).default;
      
      toast.loading("Generating payment link...", { id: "payment" });
      const callbackUrl = new URL(window.location.origin);
      callbackUrl.pathname = '/dashboard/settings';
      callbackUrl.searchParams.set("payment", "success");
      callbackUrl.searchParams.set("amount", amount.toString());
      
      const response = await fetchWithAuth('/api/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          amount: amount * 100, 
          description: "Premium Subscription",
          customer: {
            email: user.email || "",
            name: user?.displayName || "User"
          },
          callback_url: callbackUrl.toString()
        })
      });
      
      let paymentLink;
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        console.log("Raw payment response:", text);
        try {
          paymentLink = JSON.parse(text);
        } catch(e2) {
          throw new Error("Server returned invalid JSON: " + text.substring(0, 50));
        }
      } catch (e) {
        throw e;
      }
      
      if (!response.ok) {
        throw new Error(paymentLink.error || "Failed to create payment link");
      }
      
      if (paymentLink.short_url) {
         toast.dismiss("payment");
         window.location.href = paymentLink.short_url;
      } else {
         throw new Error("Invalid payment link returned");
      }
    } catch (err: any) {
      const toast = (await import('react-hot-toast')).default;
      toast.error(err.message || "Checkout failed", { id: "payment" });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-blue-100 scroll-smooth">
      {/* Header */}
      <header className="fixed top-0 inset-x-0 bg-white/80 backdrop-blur-md z-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-[#002b5b] rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">
                T
              </div>
              <span className="font-bold text-2xl tracking-tight text-slate-900">TenderMaster <span className="text-[#002b5b]">AI</span></span>
            </div>
            
            <nav className="hidden md:flex gap-8 items-center">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-[#002b5b] transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm font-medium text-slate-600 hover:text-[#002b5b] transition-colors">How it Works</a>
              <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-[#002b5b] transition-colors">Pricing</a>
              {user ? (
                <Link to="/dashboard" className="text-sm font-semibold bg-[#002b5b] text-white px-5 py-2.5 rounded-lg shadow-md hover:bg-[#001f42] transition-all">
                  Go to Dashboard
                </Link>
              ) : (
                <div className="flex items-center gap-4">
                  <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-[#002b5b]">Log in</Link>
                  <Link to="/login" className="text-sm font-semibold bg-[#002b5b] text-white px-5 py-2.5 rounded-lg shadow-md hover:bg-[#001f42] transition-all">
                    Get Started
                  </Link>
                </div>
              )}
            </nav>

            <button className="md:hidden p-2 text-slate-600" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-4 py-4 space-y-4 shadow-lg">
            <a href="#features" className="block text-slate-600 font-medium" onClick={() => setIsMenuOpen(false)}>Features</a>
            <a href="#how-it-works" className="block text-slate-600 font-medium" onClick={() => setIsMenuOpen(false)}>How it Works</a>
            <a href="#pricing" className="block text-slate-600 font-medium" onClick={() => setIsMenuOpen(false)}>Pricing</a>
            <hr className="border-slate-100" />
            {user ? (
                <Link to="/dashboard" className="block text-center font-semibold bg-[#002b5b] text-white px-5 py-2.5 rounded-lg">Go to Dashboard</Link>
            ) : (
              <Link to="/login" className="block text-center font-semibold bg-[#002b5b] text-white px-5 py-2.5 rounded-lg">Get Started / Log in</Link>
            )}
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col items-center text-center mt-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 font-medium text-sm mb-8 border border-blue-100">
          <Zap className="w-4 h-4" />
          Revolutionizing Government Bidding
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight leading-tight max-w-4xl">
          Win More Tenders with <span className="text-[#002b5b]">AI-Powered Precision.</span>
        </h1>
        <p className="mt-6 text-xl text-slate-600 max-w-2xl leading-relaxed">
          Automate your tender analysis, extract critical compliance criteria instantly, and generate flawless technical bids in minutes instead of days.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          {user ? (
            <Link to="/dashboard" className="bg-[#002b5b] text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#001f42] transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-2">
              Open Dashboard <ArrowRight className="w-5 h-5" />
            </Link>
          ) : (
            <Link to="/login" className="bg-[#002b5b] text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#001f42] transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-2">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
          )}
          <a href="#how-it-works" className="bg-white text-slate-700 px-8 py-4 rounded-xl font-bold text-lg border border-slate-200 hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
            <Play className="w-5 h-5" /> See it in Action
          </a>
        </div>
      </section>

      {/* Feature Showcase Grid */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Everything you need to scale your bidding.</h2>
            <p className="mt-4 text-lg text-slate-600">Built specifically for modern contractors and infrastructure firms.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700 mb-6">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Smart PDF Parsing</h3>
              <p className="text-slate-600 leading-relaxed">
                Upload lengthy NIT documents and our AI will instantly extract EMD, deadlines, eligibility criteria, and critical clauses.
              </p>
            </div>
            
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 mb-6">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Automated Compliance</h3>
              <p className="text-slate-600 leading-relaxed">
                Cross-references tender requirements against your saved Business Profile to instantly flag missing qualifications or documents.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-700 mb-6">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Ready-to-Print Forms</h3>
              <p className="text-slate-600 leading-relaxed">
                Generates perfectly formatted Technical Bids, Affidavits, and Compliance sheets on your company's digital letterhead.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="how-it-works" className="py-24 bg-slate-900 text-white relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-blue-500 opacity-10 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 rounded-full bg-emerald-500 opacity-10 blur-3xl"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold sm:text-4xl text-white">How TenderMaster AI Works</h2>
            <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">Streamline your bidding process from hours to minutes. We simplify document parsing, compliance checking, and technical bid generation.</p>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            <div className="flex flex-col text-center items-center">
              <div className="w-16 h-16 bg-[#002b5b] rounded-2xl flex items-center justify-center shadow-lg border border-blue-800 mb-6">
                <span className="text-2xl font-bold text-white">1</span>
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Create Profile</h3>
              <p className="text-slate-400 text-sm leading-relaxed">Set up your business profile with GST details, turnover history, and upload your letterhead templates securely.</p>
            </div>
            
            <div className="flex flex-col text-center items-center relative">
              <div className="hidden md:block absolute top-8 -left-[50%] w-full h-[2px] bg-slate-800 -z-10"></div>
              <div className="w-16 h-16 bg-[#002b5b] rounded-2xl flex items-center justify-center shadow-lg border border-blue-800 mb-6">
                <span className="text-2xl font-bold text-white">2</span>
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Upload NIT</h3>
              <p className="text-slate-400 text-sm leading-relaxed">Upload any complex tender document (PDF). Our AI instantly reads and understands the requirements, EMD, and deadlines.</p>
            </div>
            
            <div className="flex flex-col text-center items-center relative">
              <div className="hidden md:block absolute top-8 -left-[50%] w-full h-[2px] bg-slate-800 -z-10"></div>
              <div className="w-16 h-16 bg-[#002b5b] rounded-2xl flex items-center justify-center shadow-lg border border-blue-800 mb-6">
                <span className="text-2xl font-bold text-white">3</span>
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Analyze & Chat</h3>
              <p className="text-slate-400 text-sm leading-relaxed">Review the extracted summary. Have questions? Chat directly with our AI assistant specifically trained on your uploaded tender.</p>
            </div>
            
            <div className="flex flex-col text-center items-center relative">
              <div className="hidden md:block absolute top-8 -left-[50%] w-full h-[2px] bg-slate-800 -z-10"></div>
              <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg border border-emerald-500 mb-6">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">Generate Bids</h3>
              <p className="text-slate-400 text-sm leading-relaxed">One-click generate fully compliant technical bids, cover letters, and annexures on your official letterhead.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Simple, transparent pricing.</h2>
            <p className="mt-4 text-lg text-slate-600">Choose the plan that fits your bidding frequency.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Free Plan */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col hover:border-blue-200 hover:shadow-md transition-all">
              <h3 className="text-2xl font-bold text-slate-900">Basic</h3>
              <p className="text-slate-500 mt-2 text-sm">Perfect for exploring the platform capabilities before committing.</p>
              <div className="mt-6 mb-8 pb-8 border-b border-slate-100">
                <span className="text-5xl font-extrabold text-slate-900">₹0</span>
                <span className="text-slate-500 font-medium ml-2">/ forever</span>
              </div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Up to 3 Tender Analyses per month</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Basic PDF Data Extraction</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Standard Email Support</li>
                <li className="flex gap-3 text-slate-400"><X className="w-5 h-5 shrink-0" /> No AI Chatbot Assistance</li>
                <li className="flex gap-3 text-slate-400"><X className="w-5 h-5 shrink-0" /> No Custom Letterhead Generation</li>
              </ul>
              
              {user ? (
                <Link to="/dashboard" className="w-full py-4 rounded-xl font-bold text-center border-2 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all block">
                  Current Plan
                </Link>
              ) : (
                <Link to="/login" className="w-full py-4 rounded-xl font-bold text-center border-2 border-[#002b5b] text-[#002b5b] hover:bg-slate-50 transition-all block">
                  Get Started Free
                </Link>
              )}
            </div>

            {/* Pro Plan (Quarterly) */}
            <div className="bg-white rounded-3xl p-8 border-2 border-[#002b5b] shadow-xl flex flex-col relative transform lg:-translate-y-4">
              <div className="absolute top-0 right-8 transform -translate-y-1/2 bg-[#002b5b] text-white px-4 py-1 rounded-full text-sm font-bold shadow-md">
                Quarterly
              </div>
              <h3 className="text-2xl font-bold text-slate-900">Pro</h3>
              <p className="text-slate-500 mt-2 text-sm">For active contractors bidding regularly on medium to large projects.</p>
              <div className="mt-6 mb-8 pb-8 border-b border-slate-100">
                <span className="text-5xl font-extrabold text-slate-900">₹999</span>
                <span className="text-slate-500 font-medium ml-2">/ 3 months</span>
              </div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex gap-3 text-slate-700 font-medium"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Unlimited Tender Analyses</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Advanced AI Parsing & Compliance Check</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Interactive AI Tender Chat</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Automated Form Generation (Annexures)</li>
                <li className="flex gap-3 text-slate-600"><Check className="w-5 h-5 text-emerald-500 shrink-0" /> Custom Digital Letterhead Export</li>
              </ul>
              
              <button onClick={() => handleRazorpayClick(999)} className="w-full py-4 rounded-xl font-bold text-center bg-[#002b5b] text-white hover:bg-[#001f42] transition-all shadow-md flex items-center justify-center gap-2">
                Subscribe Quarterly <ArrowRight className="w-5 h-5" />
              </button>
            </div>

            {/* Enterprise Plan (Yearly) */}
            <div className="bg-[#002b5b] rounded-3xl p-8 border border-[#001f42] shadow-2xl flex flex-col relative">
              <div className="absolute top-0 right-8 transform -translate-y-1/2 bg-gradient-to-r from-amber-400 to-orange-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
                Best Value
              </div>
              <h3 className="text-2xl font-bold text-white">Enterprise</h3>
              <p className="text-blue-200 mt-2 text-sm">Maximum value for serious infrastructure firms seeking ultimate efficiency.</p>
              <div className="mt-6 mb-8 pb-8 border-b border-blue-900/50">
                <div className="flex items-end gap-2">
                  <span className="text-5xl font-extrabold text-white">₹1,999</span>
                  <span className="text-blue-200 font-medium pb-1">/ year</span>
                </div>
                <div className="mt-2 text-emerald-400 text-sm font-semibold">Save ₹1,997 annually vs Pro plan</div>
              </div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex gap-3 text-white"><Check className="w-5 h-5 text-emerald-400 shrink-0" /> <span className="font-semibold">Everything in Pro</span></li>
                <li className="flex gap-3 text-blue-100"><Check className="w-5 h-5 text-emerald-400 shrink-0" /> Priority 24/7 Dedicated Support</li>
                <li className="flex gap-3 text-blue-100"><Check className="w-5 h-5 text-emerald-400 shrink-0" /> Early Access to New Features</li>
                <li className="flex gap-3 text-blue-100"><Check className="w-5 h-5 text-emerald-400 shrink-0" /> Bulk Tender Processing (Coming Soon)</li>
                <li className="flex gap-3 text-blue-100"><Check className="w-5 h-5 text-emerald-400 shrink-0" /> Multi-user Team Accounts (Coming Soon)</li>
              </ul>
              
              <button onClick={() => handleRazorpayClick(1999)} className="w-full py-4 rounded-xl font-bold text-center bg-white text-[#002b5b] hover:bg-blue-50 transition-all shadow-lg flex items-center justify-center gap-2">
                Subscribe Annually <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl mb-6">Ready to transform your bidding process?</h2>
          <p className="text-lg text-slate-600 mb-10">Join forward-thinking contractors who are already saving hours on every tender submission.</p>
          {user ? (
            <Link to="/dashboard" className="bg-[#002b5b] text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#001f42] transition-all shadow-xl shadow-blue-900/20 inline-flex items-center gap-2">
              Go to Dashboard <ArrowRight className="w-5 h-5" />
            </Link>
          ) : (
            <Link to="/login" className="bg-[#002b5b] text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#001f42] transition-all shadow-xl shadow-blue-900/20 inline-flex items-center gap-2">
              Start Your Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-[#002b5b] rounded-lg flex items-center justify-center text-white font-bold text-lg">
                T
              </div>
              <span className="font-bold text-xl tracking-tight text-white">TenderMaster AI</span>
            </div>
            <p className="text-sm max-w-md">Automating the tedious aspects of government and private tender bidding so you can focus on execution and growth.</p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              <li><Link to="/login" className="hover:text-white transition-colors">Sign In</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-8 border-t border-slate-800 text-sm text-center flex flex-col md:flex-row justify-between items-center">
          <p>&copy; {new Date().getFullYear()} TenderMaster AI. All rights reserved.</p>
          <p className="mt-2 md:mt-0">Powered by AI Studio</p>
        </div>
      </footer>
    </div>
  );
}
