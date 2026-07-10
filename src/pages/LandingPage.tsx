import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, FileText, ArrowRight, Menu, X, AlertTriangle, Calendar, MessageSquare, TrendingUp } from 'lucide-react';
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
    <div className="min-h-screen bg-white font-sans text-slate-900 selection:bg-indigo-100 scroll-smooth">

      {/* ── Header ── */}
      <header className="sticky top-0 bg-white/92 backdrop-blur-md z-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-14 flex justify-between items-center h-16">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0">T</div>
            <span className="font-extrabold text-base tracking-tight text-slate-900">TenderMaster <span className="text-indigo-600">AI</span></span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
            <a href="#how" className="hover:text-indigo-600 transition-colors">How it works</a>
            <a href="#features" className="hover:text-indigo-600 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-indigo-600 transition-colors">Pricing</a>
            {user ? (
              <Link to="/dashboard" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="hover:text-indigo-600 transition-colors">Log in</Link>
                <Link to="/login" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  Get Started
                </Link>
              </>
            )}
          </nav>

          <button className="md:hidden p-2 text-slate-500" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-100 px-6 py-4 space-y-4 shadow-lg">
            <a href="#how" className="block text-sm font-semibold text-slate-600" onClick={() => setIsMenuOpen(false)}>How it works</a>
            <a href="#features" className="block text-sm font-semibold text-slate-600" onClick={() => setIsMenuOpen(false)}>Features</a>
            <a href="#pricing" className="block text-sm font-semibold text-slate-600" onClick={() => setIsMenuOpen(false)}>Pricing</a>
            <hr className="border-slate-100" />
            {user ? (
              <Link to="/dashboard" onClick={() => setIsMenuOpen(false)} className="block text-center text-sm font-bold bg-indigo-600 text-white px-4 py-2.5 rounded-lg">
                Go to Dashboard
              </Link>
            ) : (
              <Link to="/login" onClick={() => setIsMenuOpen(false)} className="block text-center text-sm font-bold bg-indigo-600 text-white px-4 py-2.5 rounded-lg">
                Get Started / Log in
              </Link>
            )}
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="px-6 lg:px-14 pt-20 pb-16 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xs mb-6 uppercase tracking-wider">
          Built for Indian government tenders
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight tracking-tight max-w-3xl mx-auto" style={{ letterSpacing: '-.03em' }}>
          Know which tenders to bid on — before you spend a rupee preparing one.
        </h1>
        <p className="mt-5 text-lg text-slate-500 max-w-xl mx-auto leading-relaxed">
          TenderMaster AI reads the tender document, checks it against your business profile, and gives you a clear bid decision in seconds.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
          {user ? (
            <Link to="/dashboard" className="inline-flex items-center gap-2 px-6 py-3.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">
              Open Dashboard <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">
              Get Started Free <ArrowRight className="w-4 h-4" />
            </Link>
          )}
          <a href="#how" className="inline-flex items-center gap-2 px-6 py-3.5 text-slate-700 font-semibold text-sm rounded-xl border border-slate-200 hover:bg-slate-50 transition-all">
            See how it works
          </a>
        </div>
        <p className="mt-4 text-xs text-slate-400">No credit card required &bull; Cancel anytime</p>
      </section>

      {/* ── How it Works ── */}
      <section id="how" className="max-w-5xl mx-auto px-6 lg:px-14 pb-16">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-11">How it works</p>
        <div className="grid md:grid-cols-3 gap-9">
          {[
            { n: '1', title: 'Upload the tender', desc: 'Drop the PDF or paste a GeM / CPPP link.' },
            { n: '2', title: 'AI reads & analyzes it', desc: 'Eligibility, financials, risk clauses, key dates.' },
            { n: '3', title: 'Get your bid decision', desc: 'A clear bid / caution / no-bid, with reasons.' },
          ].map(({ n, title, desc }) => (
            <div key={n} className="text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-extrabold mb-5">{n}</div>
              <div className="text-base font-bold text-slate-900 mb-1.5">{title}</div>
              <div className="text-sm text-slate-500 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="bg-slate-50 py-16 px-6 lg:px-14">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-11" style={{ letterSpacing: '-.02em' }}>
            Everything you need to decide, fast
          </h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Eligibility matching</div>
              <div className="text-sm text-slate-500 leading-relaxed">Auto-checks turnover, licences and past-work criteria against your profile.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Financial & profit analysis</div>
              <div className="text-sm text-slate-500 leading-relaxed">EMD, working capital and estimated margin, before you commit.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Risk assessment</div>
              <div className="text-sm text-slate-500 leading-relaxed">Flags one-sided clauses — LD caps, PBG terms, payment holds.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Deadline tracking</div>
              <div className="text-sm text-slate-500 leading-relaxed">Pre-bid meetings, submission and opening dates, never missed.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center mb-4">
                <FileText className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Document generation</div>
              <div className="text-sm text-slate-500 leading-relaxed">Compliance checklists and bid summary reports, ready to export.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Tender chat</div>
              <div className="text-sm text-slate-500 leading-relaxed">Ask questions of the document directly, in plain language.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Value strip ── */}
      <section className="max-w-5xl mx-auto px-6 lg:px-14 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 border-t border-b border-slate-100">
          <div className="py-6 px-3 text-center border-r border-slate-100">
            <div className="text-base font-extrabold text-slate-900 leading-tight">Under 60 seconds</div>
            <div className="text-xs text-slate-400 mt-1">Per tender analysis</div>
          </div>
          <div className="py-6 px-3 text-center md:border-r border-slate-100">
            <div className="text-base font-extrabold text-slate-900 leading-tight">GeM, CPPP & nProcure</div>
            <div className="text-xs text-slate-400 mt-1">Portals supported</div>
          </div>
          <div className="py-6 px-3 text-center border-r border-slate-100 border-t md:border-t-0">
            <div className="text-base font-extrabold text-slate-900 leading-tight">Eligibility, risk & profit</div>
            <div className="text-xs text-slate-400 mt-1">All in one analysis</div>
          </div>
          <div className="py-6 px-3 text-center border-t md:border-t-0">
            <div className="text-base font-extrabold text-slate-900 leading-tight">PDF, URL or ZIP</div>
            <div className="text-xs text-slate-400 mt-1">Any format accepted</div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="bg-white border-t border-slate-100 py-16 px-6 lg:px-14">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2" style={{ letterSpacing: '-.02em' }}>
            Simple, transparent pricing
          </h2>
          <p className="text-sm text-slate-500 text-center mb-10">Cancel anytime. No hidden fees.</p>

          <div className="flex flex-col md:flex-row gap-6 justify-center items-stretch max-w-2xl mx-auto">
            {/* Quarterly */}
            <div className="flex-1 border border-slate-200 rounded-2xl p-7 flex flex-col">
              <div className="text-sm font-bold text-slate-500">Quarterly</div>
              <div className="mt-2 text-3xl font-extrabold text-slate-900">
                ₹999 <span className="text-sm font-semibold text-slate-400">/ 3 months</span>
              </div>
              <div className="my-5 h-px bg-slate-100" />
              <ul className="space-y-2.5 text-sm text-slate-700 flex-1 leading-relaxed">
                <li>✓ Unlimited tender analyses</li>
                <li>✓ Eligibility &amp; risk reports</li>
                <li>✓ Deadline reminders</li>
                <li>✓ Email support</li>
              </ul>
              <button
                onClick={() => handleRazorpayClick(999)}
                className="mt-6 w-full py-3 border border-slate-300 rounded-xl font-bold text-slate-700 text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                Subscribe Quarterly <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Annual — highlighted */}
            <div className="flex-1 border-2 border-indigo-600 rounded-2xl p-7 flex flex-col relative shadow-xl shadow-indigo-600/10">
              <div className="absolute -top-3.5 left-7 bg-indigo-600 text-white text-xs font-extrabold px-3 py-1 rounded-full">
                BEST VALUE
              </div>
              <div className="text-sm font-bold text-indigo-700">Annual</div>
              <div className="mt-2 text-3xl font-extrabold text-slate-900">
                ₹1,999 <span className="text-sm font-semibold text-slate-400">/ year</span>
              </div>
              <div className="text-xs font-bold text-emerald-600 mt-1">Save ~₹1,997 vs. quarterly</div>
              <div className="my-5 h-px bg-slate-100" />
              <ul className="space-y-2.5 text-sm text-slate-700 flex-1 leading-relaxed">
                <li>✓ Everything in Quarterly</li>
                <li>✓ Priority support</li>
                <li>✓ Early access to new features</li>
                <li>✓ Bulk tender import</li>
              </ul>
              <button
                onClick={() => handleRazorpayClick(1999)}
                className="mt-6 w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                Subscribe Annually <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 bg-slate-50 border-t border-slate-100 text-center px-6">
        <h2 className="text-2xl font-extrabold text-slate-900 mb-4" style={{ letterSpacing: '-.02em' }}>
          Ready to transform your bidding process?
        </h2>
        <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto">
          Join forward-thinking contractors who are already saving hours on every tender submission.
        </p>
        {user ? (
          <Link to="/dashboard" className="inline-flex items-center gap-2 px-6 py-3.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">
            Start Your Free Trial <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-11 px-6 lg:px-14">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-indigo-600 rounded-md flex items-center justify-center text-white font-extrabold text-xs">T</div>
              <span className="font-extrabold text-sm text-white">TenderMaster AI</span>
            </div>
            <p className="text-sm leading-relaxed">Helping Indian businesses bid smarter.</p>
          </div>

          <div className="flex gap-14 flex-wrap">
            <div>
              <div className="text-white font-bold text-sm mb-3">Product</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how" className="hover:text-white transition-colors">How it works</a></li>
                <li><Link to="/login" className="hover:text-white transition-colors">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-white font-bold text-sm mb-3">Legal</div>
              <ul className="space-y-2 text-sm">
                <li><Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto mt-10 pt-7 border-t border-slate-800 text-xs text-slate-500 flex flex-col md:flex-row justify-between items-center gap-2">
          <p>&copy; {new Date().getFullYear()} TenderMaster AI. All rights reserved.</p>
          <p>Powered by AI Studio</p>
        </div>
      </footer>

    </div>
  );
}
