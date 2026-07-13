import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2, FileText, ArrowRight, Menu, X, Calendar, MessageSquare,
  TrendingUp, Building2, Languages, CreditCard, Folder, LayoutGrid
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import toast from 'react-hot-toast';
import { PLANS } from '../lib/plans';

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
    <div
      style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
      className="min-h-screen bg-white text-slate-900 selection:bg-indigo-100 scroll-smooth"
    >

      {/* ── Header ── */}
      <header className="sticky top-0 bg-white/92 backdrop-blur-md z-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-14 flex justify-between items-center h-16">
          <div className="flex items-center gap-2.5">
            <img src="/tendermaster-logo-lockup.png" alt="TenderMaster AI" className="h-10" />
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
        <h1
          className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight max-w-3xl mx-auto"
          style={{ letterSpacing: '-.03em' }}
        >
          Upload a tender. Know in 60 seconds whether to bid. Get every annexure filled and submission-ready.
        </h1>
        <p className="mt-5 text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          And never lose track of your EMD again. TenderMaster AI reads the document, checks it against your business profile, and hands you a bid decision — plus the paperwork.
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
            { n: '1', title: 'Upload the tender', desc: 'PDF, a ZIP of documents, or a GeM / CPPP link.' },
            { n: '2', title: 'AI analyzes against your profile', desc: 'Eligibility, compliance, financials, risk, deadlines, win probability.' },
            { n: '3', title: 'Get a decision — and the paperwork', desc: 'A bid recommendation, plus every annexure filled and ready to submit.' },
          ].map(({ n, title, desc }) => (
            <div key={n} className="text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-extrabold mb-5">{n}</div>
              <div className="text-base font-bold text-slate-900 mb-1.5">{title}</div>
              <div className="text-sm text-slate-500 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Differentiator — Form Fill ── */}
      <section className="max-w-6xl mx-auto px-6 lg:px-14 pb-16">
        <div className="grid md:grid-cols-2 gap-10 items-center bg-gradient-to-br from-indigo-700 to-blue-600 rounded-2xl p-8 md:p-11 shadow-2xl shadow-indigo-600/20">

          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-900 bg-green-400 px-3 py-1.5 rounded-full mb-5">
              ⚡ THE DIFFERENTIATOR — NO ONE ELSE DOES THIS
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-snug" style={{ letterSpacing: '-.02em' }}>
              We don't summarize your tender. We fill it out.
            </h2>
            <p className="text-sm text-indigo-100 mt-4 leading-relaxed">
              Upload the tender's actual annexure or proforma. TenderMaster reproduces it verbatim — nested tables, original clause wording, header and footer on every page — and fills in your business data. Not a generic template: the exact form the department issued, submission-ready in minutes instead of hours of retyping.
            </p>
            <div className="flex items-stretch gap-6 mt-6 flex-wrap">
              <div>
                <div className="text-xl font-extrabold text-white">Hours → Minutes</div>
                <div className="text-xs text-indigo-200 mt-0.5">per bid, on paperwork alone</div>
              </div>
              <div className="w-px bg-white/25 self-stretch" />
              <div>
                <div className="text-xl font-extrabold text-white">Zero</div>
                <div className="text-xs text-indigo-200 mt-0.5">fabricated stamps or statutory numbers</div>
              </div>
            </div>
            <p className="text-xs text-indigo-200/80 mt-4">
              Blank fields stay blank for your signature — you stay in control of what's submitted.
            </p>
          </div>

          {/* Right: mock annexure */}
          <div className="bg-white rounded-2xl p-5 shadow-2xl shadow-slate-900/25">
            <div className="text-xs font-bold text-slate-400 tracking-wider border-b border-slate-100 pb-2.5 mb-3">
              ANNEXURE-III · DECLARATION OF ELIGIBILITY
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between items-baseline">
                <span className="text-slate-500">Name of Bidder</span>
                <span className="font-bold text-slate-900 text-right ml-4">Your company name</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-slate-500">GSTIN</span>
                <span className="font-bold text-slate-900 text-right ml-4">From your profile</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-slate-500">Registration Class</span>
                <span className="font-bold text-slate-900 text-right ml-4">Auto-filled</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-dashed border-slate-200 pt-2.5">
                <span className="text-slate-500">Authorised Signatory</span>
                <span className="text-slate-300 text-right ml-4">___________</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 text-center">Blank fields stay blank — you sign and submit</div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="bg-slate-50 py-16 px-6 lg:px-14">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2" style={{ letterSpacing: '-.02em' }}>
            Everything a bidder needs, in one place
          </h2>
          <p className="text-sm text-slate-500 text-center mb-11">
            From first read of the tender to tracking the refund of your Security Deposit.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Tender analysis</div>
              <div className="text-sm text-slate-500 leading-relaxed">Match score, eligibility, compliance matrix, win probability and risk flags from the full document.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Business profile</div>
              <div className="text-sm text-slate-500 leading-relaxed">Fill your statutory details once — GST, PAN, Udyam, turnover, directors — auto-filled from certificates.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Bid engine &amp; profit calculator</div>
              <div className="text-sm text-slate-500 leading-relaxed">Enter revenue, materials, labour and overheads — get margin and a recommended bid amount.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Tender chat</div>
              <div className="text-sm text-slate-500 leading-relaxed">"What's the EMD? Am I eligible?" — plain-language answers instead of Ctrl+F through a PDF.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Languages className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Analysis in your language</div>
              <div className="text-sm text-slate-500 leading-relaxed">Every result — English, Hindi or Gujarati. Read it the way your team actually talks.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <CreditCard className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Payments tracker</div>
              <div className="text-sm text-slate-500 leading-relaxed">Every EMD and Security Deposit tracked Paid → Pending Refund → Refunded, so your capital doesn't sit forgotten.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center mb-4">
                <Folder className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Documents center</div>
              <div className="text-sm text-slate-500 leading-relaxed">Every certificate and record, uploaded once, searchable — no hunting at 11 pm before a deadline.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Deadline notifications</div>
              <div className="text-sm text-slate-500 leading-relaxed">Submission and pre-bid dates, extracted automatically and never missed.</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <LayoutGrid className="w-5 h-5" />
              </div>
              <div className="font-bold text-slate-900 text-sm mb-1.5">Dashboard &amp; pipeline</div>
              <div className="text-sm text-slate-500 leading-relaxed">Active tenders, high-match count, deadlines this week and your whole bidding operation on one screen.</div>
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
            <div className="text-base font-extrabold text-slate-900 leading-tight">GeM, CPPP &amp; nProcure</div>
            <div className="text-xs text-slate-400 mt-1">Portals supported</div>
          </div>
          <div className="py-6 px-3 text-center border-r border-slate-100 border-t md:border-t-0">
            <div className="text-base font-extrabold text-slate-900 leading-tight">Eligibility, risk &amp; profit</div>
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
            Pay per tender, not per month
          </h2>
          <p className="text-sm text-slate-500 text-center mb-2">Credits never expire — valid 24 months. Your data stays accessible forever.</p>
          <p className="text-sm text-slate-400 text-center mb-10">1 credit = 1 tender analysis. Re-analyses on saved projects are free.</p>

          {/* Trial callout */}
          <div className="max-w-2xl mx-auto mb-8 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 flex flex-col md:flex-row items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-bold text-indigo-700">Free Trial</div>
              <div className="text-2xl font-extrabold text-slate-900 mt-0.5">1 credit — free</div>
              <p className="text-sm text-slate-600 mt-1">Analyse your first tender at no cost. No card required.</p>
            </div>
            <Link to="/login" className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl text-sm flex items-center gap-2">
              Start Free <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="flex flex-col md:flex-row gap-6 justify-center items-stretch max-w-2xl mx-auto">
            {PLANS.filter(p => !p.adminOnly).map((plan, i) => {
              const featured = i === 1;
              const perCredit = Math.round(plan.amountRupees / plan.credits);
              const features = i === 0
                ? [`${plan.credits} tender analyses`, "Eligibility & risk reports", "Document generation & chat", "24-month validity"]
                : [`${plan.credits} tender analyses`, "Eligibility & risk reports", "Document generation & chat", "24-month validity", `Only ₹${perCredit.toLocaleString('en-IN')} per analysis`];

              return (
                <div
                  key={plan.amountPaise}
                  className={`flex-1 rounded-2xl p-7 flex flex-col relative ${
                    featured
                      ? "border-2 border-indigo-600 shadow-xl shadow-indigo-600/10"
                      : "border border-slate-200"
                  }`}
                >
                  {featured && (
                    <div className="absolute -top-3.5 left-7 bg-indigo-600 text-white text-xs font-extrabold px-3 py-1 rounded-full">
                      BEST VALUE
                    </div>
                  )}
                  <div className={`text-sm font-bold ${featured ? "text-indigo-700" : "text-slate-500"}`}>
                    {plan.label}
                  </div>
                  <div className="mt-2 text-4xl font-extrabold text-slate-900">
                    ₹{plan.amountRupees.toLocaleString('en-IN')}
                  </div>
                  <div className={`text-sm mt-1 ${featured ? "text-indigo-600 font-semibold" : "text-slate-500"}`}>
                    {plan.credits} credits · ₹{perCredit.toLocaleString('en-IN')} each
                  </div>
                  <div className="my-5 h-px bg-slate-100" />
                  <ul className="space-y-2.5 text-sm text-slate-700 flex-1 leading-relaxed">
                    {features.map(f => <li key={f}>✓ {f}</li>)}
                  </ul>
                  <button
                    onClick={() => handleRazorpayClick(plan.amountRupees)}
                    className={`mt-6 w-full py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                      featured
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Buy {plan.credits} Credits <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
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
              <img src="/tendermaster-logo-lockup.png" alt="TenderMaster AI" className="h-9 brightness-0 invert" />
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
