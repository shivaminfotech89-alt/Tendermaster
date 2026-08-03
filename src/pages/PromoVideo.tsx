import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Play, Pause, RotateCcw, Volume2, VolumeX, ArrowRight, ArrowLeft,
  CheckCircle, AlertCircle, Sparkles, MessageSquare, FileText,
  Calculator, RefreshCw, Landmark, ShieldAlert, Award, Folder, HelpCircle,
  FileSpreadsheet, ClipboardList
} from "lucide-react";

// Web Audio API Sound Effects Helper
class SoundEffects {
  private ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playClick() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playTransition() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(450, this.ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.06, this.ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  playChime() {
    this.init();
    if (!this.ctx) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
    osc1.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.08); // E5

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, this.ctx.currentTime + 0.16); // G5

    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);

    osc1.start();
    osc2.start();
    osc1.stop(this.ctx.currentTime + 0.5);
    osc2.stop(this.ctx.currentTime + 0.5);
  }
}

const sfx = new SoundEffects();

interface Scene {
  title: string;
  tagline: string;
  voiceover: string;
  visualType: "hero" | "dashboard" | "analyzer" | "boq" | "autofill" | "chat" | "tracker" | "cta";
}

const SCENES: Scene[] = [
  {
    title: "TenderMaster AI",
    tagline: "Win Indian Government Tenders 10x Faster",
    voiceover: "Welcome to TenderMaster AI. The complete, AI-powered bidding assistant built specifically for Indian government contractors, supporting GeM, CPPP, and local e-procurement portals.",
    visualType: "hero"
  },
  {
    title: "Real-Time Bidding Dashboard",
    tagline: "Track Your Active Projects & Deadlines",
    voiceover: "Get a comprehensive view of all your bidding projects. Monitor high-compatibility matches, see upcoming submission dates, and track your total bidding values in one unified command center.",
    visualType: "dashboard"
  },
  {
    title: "AI Tender Analyzer",
    tagline: "Scan PDF Tenders for Eligibility & Hidden Risks",
    voiceover: "No more reading 200-page tender documents. Our AI scanner reads the entire document, checks compatibility against your profile, extracts critical dates, and lists hidden risks instantly.",
    visualType: "analyzer"
  },
  {
    title: "Universal BOQ Pricing Engine",
    tagline: "Instant Extraction & Smart Bid Calculations",
    voiceover: "Parse Bill of Quantity schedules instantly. The financial engine detects Percentage, Item Rate, or Lump Sum contracts, letting you adjust markups and calculate bid rates live.",
    visualType: "boq"
  },
  {
    title: "Verbatim Annexure Auto-Fill",
    tagline: "Fill Actual Government Proformas in Seconds",
    voiceover: "TenderMaster doesn't just create summaries. It replicates the actual blank annexures and forms issued by the tender authority, filling in your statutory profile details with absolute precision.",
    visualType: "autofill"
  },
  {
    title: "Multilingual AI Tender Chat",
    tagline: "Ask Questions in English, Hindi, or Gujarati",
    voiceover: "Clarify turnover clauses, experience criteria, or EMD rules instantly. Chat with the tender document in your preferred language and get answers cited with exact page numbers.",
    visualType: "chat"
  },
  {
    title: "EMD & Security Deposit Tracker",
    tagline: "Track Your Deposits Paid, Pending, & Refunded",
    voiceover: "Never lose track of your Earnest Money Deposits again. Follow each transaction through the stages of payment, refund pending, and successful return to your bank account.",
    visualType: "tracker"
  },
  {
    title: "Ready to Bid Smarter?",
    tagline: "Claim 1 Free Tender Analysis Immediately",
    voiceover: "No credit card required. Claim your free credit, upload your tender, and generate submission-ready annexures today. Start winning more bids with TenderMaster AI!",
    visualType: "cta"
  }
];

export default function PromoVideo() {
  const [currentScene, setCurrentScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Dynamic simulation mock states
  const [boqMarkup, setBoqMarkup] = useState(12);
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "ai"; text: string }>>([]);
  const [chatTyping, setChatTyping] = useState(false);
  const [trackerStep, setTrackerStep] = useState(0);

  // Premium mockup graphics
  const dashboardMock = "/promo_hero_dashboard.png";
  const autofillMock = "/promo_autofill_docs.png";

  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const duration = 8000; // 8 seconds per slide for better reading time

  // Play/Pause
  const togglePlay = () => {
    sfx.playClick();
    setIsPlaying(!isPlaying);
  };

  // Sound triggers
  const toggleMute = () => {
    sfx.playClick();
    setIsMuted(!isMuted);
  };

  // Navigation
  const handleNext = () => {
    if (!isMuted) sfx.playTransition();
    setCurrentScene((prev) => (prev + 1) % SCENES.length);
    setProgress(0);
  };

  const handlePrev = () => {
    if (!isMuted) sfx.playTransition();
    setCurrentScene((prev) => (prev - 1 + SCENES.length) % SCENES.length);
    setProgress(0);
  };

  const jumpToScene = (index: number) => {
    if (!isMuted) sfx.playClick();
    setCurrentScene(index);
    setProgress(0);
  };

  const handleRestart = () => {
    if (!isMuted) sfx.playTransition();
    setCurrentScene(0);
    setProgress(0);
    setIsPlaying(true);
  };

  // Voiceover MP3 player & progress updates synced to audio playback
  useEffect(() => {
    // 1. Clean up old audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setProgress(0);

    const audio = new Audio(`/audio/scene_${currentScene}.mp3`);
    audio.muted = isMuted;
    audioRef.current = audio;

    let fallbackTimer: NodeJS.Timeout | null = null;
    let isFallbackActive = false;

    const onTimeUpdate = () => {
      if (!isFallbackActive && audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const onEnded = () => {
      handleNext();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    if (isPlaying) {
      audio.play().catch((err) => {
        console.warn("Autoplay blocked, running fallback timer", err);
        // Fallback timer when autoplay is blocked
        isFallbackActive = true;
        let start = Date.now();
        const fallbackDuration = 8000;
        fallbackTimer = setInterval(() => {
          const elapsed = Date.now() - start;
          const pct = Math.min((elapsed / fallbackDuration) * 100, 100);
          setProgress(pct);
          if (pct >= 100) {
            if (fallbackTimer) clearInterval(fallbackTimer);
            handleNext();
          }
        }, 100);
      });
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [currentScene]);

  // Sync play/pause changes to audio playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Sync mute state changes to audio player
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Sync animations for specific slides
  useEffect(() => {
    if (SCENES[currentScene].visualType === "boq") {
      const boqTimer = setInterval(() => {
        setBoqMarkup((prev) => (prev === 12 ? 18 : prev === 18 ? 5 : 12));
        if (!isMuted) sfx.playClick();
      }, 2500);
      return () => clearInterval(boqTimer);
    }

    if (SCENES[currentScene].visualType === "chat") {
      setChatMessages([
        { sender: "user", text: "What is the EMD exemption rule for MSME Class-C electrical contractors?" }
      ]);
      setChatTyping(true);
      const typingTimer = setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            sender: "ai",
            text: "Based on Clause 4.2 (Page 7): MSME registered bidders are exempted from paying Earnest Money Deposit (EMD). You must upload a valid Udyam Registration Certificate in lieu of the EMD BG/DD. 📝"
          }
        ]);
        setChatTyping(false);
        if (!isMuted) sfx.playChime();
      }, 2200);

      return () => clearTimeout(typingTimer);
    }

    if (SCENES[currentScene].visualType === "tracker") {
      setTrackerStep(0);
      const stepTimer = setInterval(() => {
        setTrackerStep((prev) => {
          const next = (prev + 1) % 3;
          if (!isMuted) {
            if (next === 2) sfx.playChime();
            else sfx.playClick();
          }
          return next;
        });
      }, 2000);
      return () => clearInterval(stepTimer);
    }
  }, [currentScene]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      
      {/* ── Top Bar ── */}
      <header className="flex justify-between items-center px-6 py-4 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-extrabold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              TenderMaster
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              AI PROMO
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleMute}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition-colors"
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-rose-400" />
                <span className="hidden sm:inline">Mute Voiceover</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Voiceover ON</span>
              </>
            )}
          </button>
          <Link
            to="/login"
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
          >
            Go to App
          </Link>
        </div>
      </header>

      {/* ── Presentation Content ── */}
      <main className="flex-1 flex flex-col lg:flex-row items-stretch justify-center max-w-7xl mx-auto w-full p-4 lg:p-8 gap-6 overflow-hidden">
        
        {/* Left Side: Navigation / Narrative Timeline */}
        <div className="lg:w-1/3 flex flex-col justify-between gap-6 p-1">
          <div className="space-y-4">
            <h1 className="text-sm font-bold text-slate-500 uppercase tracking-widest">
              Core Bidding Features
            </h1>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
              {SCENES.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToScene(idx)}
                  className={`text-left p-3 rounded-xl border transition-all flex items-center justify-between text-xs ${
                    currentScene === idx
                      ? "bg-indigo-600/10 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-900/10"
                      : "bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <span className="truncate pr-2">{idx + 1}. {s.title}</span>
                  {currentScene === idx && (
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Simulated Narrator / Subtitle Text */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 bg-indigo-600 h-0.5 transition-all duration-300" style={{ width: `${progress}%` }} />
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              NARRATOR VOICE
            </div>
            <p className="text-sm text-slate-200 leading-relaxed italic min-h-[90px]">
              "{SCENES[currentScene].voiceover}"
            </p>
          </div>
        </div>

        {/* Right Side: High-Fidelity App Mockups / Live Demos */}
        <div className="flex-1 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 lg:p-8 flex flex-col justify-between shadow-2xl relative min-h-[420px] lg:min-h-0 overflow-hidden">
          
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px]" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-[100px]" />

          {/* Slide Description Header */}
          <div className="relative z-10 mb-6 text-center lg:text-left flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 border-b border-slate-800/50 pb-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                FEATURE PREVIEW {currentScene + 1} of {SCENES.length}
              </span>
              <h2 className="text-2xl lg:text-3xl font-extrabold text-white mt-2.5 tracking-tight">
                {SCENES[currentScene].title}
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                {SCENES[currentScene].tagline}
              </p>
            </div>

          </div>

          {/* Main Visual Block */}
          <div className="flex-1 flex items-center justify-center relative z-10 min-h-[260px] p-2">
            
            {/* SCENE 1: HERO / TITLE INTRO */}
            {SCENES[currentScene].visualType === "hero" && (
              <div className="w-full max-w-xl animate-fade-in relative group">
                <img
                  src={dashboardMock}
                  alt="TenderMaster AI Dashboard Mockup"
                  className="rounded-xl shadow-2xl border border-slate-700/60 transition-all duration-500 group-hover:scale-101 mx-auto max-h-[300px] object-cover"
                />
                <div className="absolute -top-3 -right-3 bg-indigo-500 text-white rounded-full p-2.5 shadow-lg flex items-center justify-center animate-bounce">
                  <Sparkles className="w-5 h-5" />
                </div>
              </div>
            )}

            {/* SCENE 2: REAL DASHBOARD PREVIEW */}
            {SCENES[currentScene].visualType === "dashboard" && (
              <div className="w-full max-w-xl animate-fade-in relative group">
                <img
                  src={dashboardMock}
                  alt="TenderMaster AI Dashboard Mockup"
                  className="rounded-xl shadow-2xl border border-slate-700/60 transition-all duration-500 group-hover:scale-101 mx-auto max-h-[300px] object-cover"
                />
                <div className="absolute bottom-3 left-3 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-[10px] text-slate-300">
                  📁 Includes **EMD refund counters**, **Active bids tracker**, & **Win margins**
                </div>
              </div>
            )}

            {/* SCENE 3: REAL TENDER ANALYZER */}
            {SCENES[currentScene].visualType === "analyzer" && (
              <div className="w-full max-w-xl animate-fade-in relative group">
                <img
                  src={dashboardMock}
                  alt="TenderMaster AI Analyzer Mockup"
                  className="rounded-xl shadow-2xl border border-slate-700/60 transition-all duration-500 group-hover:scale-101 mx-auto max-h-[300px] object-cover"
                />
                <div className="absolute bottom-3 right-3 bg-emerald-500/90 text-slate-950 px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Compliance Check & Date Extractor
                </div>
              </div>
            )}

            {/* SCENE 4: UNIVERSAL BOQ PRICING ENGINE */}
            {SCENES[currentScene].visualType === "boq" && (
              <div className="w-full max-w-xl bg-slate-950/90 border border-slate-850 rounded-2xl p-4 shadow-xl font-mono text-[10px] lg:text-xs">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2.5 mb-3">
                  <span className="font-bold text-indigo-400 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4" /> Universal BOQ Calculator (Percentage & Item Rates)
                  </span>
                  <span className="text-[9px] text-slate-400 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                    Live Simulator
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-4 text-slate-500 font-bold border-b border-slate-900 pb-1">
                    <span>ITEM SCHEDULE</span>
                    <span className="text-right">QUANTITY</span>
                    <span className="text-right">ESTIMATE RATE</span>
                    <span className="text-right text-indigo-300">BID PRICE</span>
                  </div>
                  {[
                    { name: "Excavation Works", qty: 1500, base: 380 },
                    { name: "PCC Foundations", qty: 250, base: 4500 },
                    { name: "MS Structural Steel", qty: 45, base: 82000 }
                  ].map((row, idx) => (
                    <div key={idx} className="grid grid-cols-4 text-slate-300 py-1.5 border-b border-slate-900/30">
                      <span className="text-slate-400 truncate">{row.name}</span>
                      <span className="text-right">{row.qty}</span>
                      <span className="text-right">₹{row.base.toLocaleString()}</span>
                      <span className="text-right font-bold text-emerald-400 transition-all duration-300">
                        ₹{Math.round(row.base * (1 + boqMarkup / 100)).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-sans">Toggle Margin:</span>
                    <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded font-bold">
                      {boqMarkup}%
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-slate-500 font-sans uppercase">Total Calculated Bid</div>
                    <div className="text-sm font-extrabold text-white animate-pulse">
                      ₹{Math.round((1500 * 380 + 250 * 4500 + 45 * 82000) * (1 + boqMarkup / 100)).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCENE 5: AUTO-FILL ANNEXURES & DOCUMENT GENERATION */}
            {SCENES[currentScene].visualType === "autofill" && (
              <div className="w-full max-w-xl animate-fade-in relative group overflow-hidden rounded-2xl shadow-2xl border border-slate-700/50">
                <img
                  src={autofillMock}
                  alt="TenderMaster AI Autofill Document Preview"
                  className="w-full max-h-[300px] object-cover mx-auto hover:scale-102 transition-transform duration-700"
                />
                {/* Visual Scanner Overlay bar */}
                <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent opacity-85 shadow-[0_0_10px_#10b981] animate-scan top-0" />
                <div className="absolute top-3 left-3 bg-emerald-500/90 text-white rounded px-2.5 py-1 text-[10px] font-extrabold uppercase shadow-md flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" /> Exact Format Filled
                </div>
              </div>
            )}

            {/* SCENE 6: REAL AI CHAT WITH CITATIONS */}
            {SCENES[currentScene].visualType === "chat" && (
              <div className="w-full max-w-xl animate-fade-in relative group flex gap-4 flex-col lg:flex-row items-stretch">
                <div className="flex-1 max-w-[50%] hidden lg:block">
                  <img
                    src={dashboardMock}
                    alt="TenderMaster AI Dashboard Mockup"
                    className="rounded-xl shadow-2xl border border-slate-700/60 max-h-[280px] object-cover w-full"
                  />
                </div>
                <div className="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between text-xs">
                  <div className="flex items-center gap-2 border-b border-slate-850 pb-2 mb-2 font-bold text-slate-300">
                    <MessageSquare className="w-4 h-4 text-indigo-400" /> Live Query Response
                  </div>
                  <div className="space-y-2.5">
                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg p-2.5 leading-relaxed transition-all duration-300 ${
                          msg.sender === "user"
                            ? "bg-slate-800 text-slate-200 self-end ml-4"
                            : "bg-indigo-600/10 border border-indigo-500/10 text-indigo-200 self-start mr-4"
                        }`}
                      >
                        {msg.text}
                      </div>
                    ))}
                    {chatTyping && (
                      <div className="bg-indigo-600/5 text-indigo-400 px-3 py-1.5 rounded-lg italic flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Cross-referencing PDF Clauses...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SCENE 7: EMD REFUND LIFECYCLE TRACKER */}
            {SCENES[currentScene].visualType === "tracker" && (
              <div className="w-full max-w-md space-y-5 font-sans">
                <div className="relative flex justify-between items-center px-4">
                  <div className="absolute left-10 right-10 h-0.5 bg-slate-800 top-5 z-0" />
                  <div
                    className="absolute left-10 h-0.5 bg-gradient-to-r from-emerald-500 to-indigo-500 top-5 z-0 transition-all duration-500"
                    style={{ width: trackerStep === 0 ? "0%" : trackerStep === 1 ? "50%" : "100%" }}
                  />

                  {[
                    { label: "Deposit Paid", color: "bg-emerald-500 text-slate-950 font-bold" },
                    { label: "Pending Refund", color: trackerStep >= 1 ? "bg-indigo-500 text-slate-950 font-bold" : "bg-slate-800 text-slate-400" },
                    { label: "Refund Returned", color: trackerStep >= 2 ? "bg-amber-500 text-slate-950 font-bold" : "bg-slate-800 text-slate-400" }
                  ].map((node, idx) => (
                    <div key={idx} className="flex flex-col items-center z-10 relative">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs transition-all duration-300 ring-4 ring-slate-900 ${node.color}`}>
                        {idx + 1}
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 mt-2 tracking-wide">{node.label}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-xs max-w-sm mx-auto shadow-md">
                  <div className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1.5">Active EMD Entry</div>
                  {trackerStep === 0 && (
                    <p className="text-slate-300">
                      💳 EMD Payment of <strong className="text-emerald-400">₹1,50,000</strong> recorded for GeM Tender ref. Railway-2026-X.
                    </p>
                  )}
                  {trackerStep === 1 && (
                    <p className="text-slate-300">
                      ⏳ Bid submitted. System set up auto-notifications for the release date of performance security.
                    </p>
                  )}
                  {trackerStep === 2 && (
                    <p className="text-slate-300">
                      🎉 Payment refunded back to bank account successfully. Tracker closed.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* SCENE 8: CALL TO ACTION */}
            {SCENES[currentScene].visualType === "cta" && (
              <div className="w-full max-w-md bg-gradient-to-br from-indigo-950/50 via-slate-900/50 to-violet-950/50 border border-indigo-500/30 rounded-3xl p-6 text-center shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-indigo-500/20 w-32 h-32 rounded-full blur-2xl" />
                <Award className="w-12 h-12 text-indigo-400 mx-auto mb-4 animate-pulse" />
                <h3 className="text-xl font-extrabold text-white">Scale your bidding operation</h3>
                <p className="text-slate-400 text-xs mt-2 max-w-xs mx-auto leading-relaxed">
                  Analyze government tenders, verify qualifications, and fill complete annexures in English, Hindi, and Gujarati.
                </p>
                <div className="mt-6 flex flex-col gap-2.5">
                  <Link
                    to="/login"
                    className="inline-flex items-center justify-center gap-2 w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/30"
                  >
                    Get Started Free <ArrowRight className="w-4 h-4" />
                  </Link>
                  <span className="text-[10px] text-slate-500">1 Analysis Credit Included Upon Sign Up</span>
                </div>
              </div>
            )}

          </div>

          {/* Controls (Bottom of visual container) */}
          <div className="mt-8 border-t border-slate-800/80 pt-5 flex items-center justify-between gap-4 relative z-10 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Previous Slide"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={togglePlay}
                className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={handleNext}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Next Slide"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleRestart}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Restart Presentation"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Pagination dots */}
            <div className="flex gap-2">
              {SCENES.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToScene(idx)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    currentScene === idx ? "w-6 bg-indigo-500" : "w-2 bg-slate-700 hover:bg-slate-600"
                  }`}
                />
              ))}
            </div>
          </div>

        </div>

      </main>

      {/* Styled inline components styles for scan lines */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0.8; }
          50% { top: 100%; opacity: 0.8; }
          100% { top: 0%; opacity: 0.8; }
        }
        .animate-scan {
          position: absolute;
          animation: scan 4s linear infinite;
        }
        .scale-101:hover {
          transform: scale(1.01);
        }
      `}</style>
      
    </div>
  );
}
