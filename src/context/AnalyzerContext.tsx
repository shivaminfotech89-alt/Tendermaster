import React, { createContext, useContext, useState, useEffect } from "react";

interface AnalyzerState {
  analyzing: boolean;
  progress: number;
  reanalyzing: boolean;
  reanalyzeProgress: number;
  analysisResult: any;
  payloadContext: string | string[];
  setAnalyzing: (v: boolean) => void;
  setProgress: (v: number) => void;
  setReanalyzing: (v: boolean) => void;
  setReanalyzeProgress: (v: number) => void;
  setAnalysisResult: (v: any) => void;
  setPayloadContext: (v: string | string[]) => void;
  clearAnalysis: () => void;
}

const Context = createContext<AnalyzerState | null>(null);

export const useAnalyzerStore = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing AnalyzerProvider");
  return ctx;
};

export const AnalyzerProvider = ({ children }: { children: React.ReactNode }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeProgress, setReanalyzeProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [payloadContext, setPayloadContext] = useState<string | string[]>("");

  // Simulated progress immune to background throttling
  useEffect(() => {
    let interval: any;
    if (analyzing) {
      setProgress(0);
      const startTime = Date.now();
      const expectedDuration = 25000; // 25 seconds to reach 95%
      
      interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        let p = Math.min((elapsed / expectedDuration) * 95, 95);
        setProgress(Math.floor(p));
      }, 500);
    } else {
      if (analysisResult) setProgress(100);
    }
    return () => clearInterval(interval);
  }, [analyzing, analysisResult]);

  useEffect(() => {
    let interval: any;
    if (reanalyzing) {
      setReanalyzeProgress(0);
      interval = setInterval(() => {
        setReanalyzeProgress(p => {
          if (p >= 95) return p;
          const increment = Math.random() * 5 + 2;
          return Math.min(p + increment, 95);
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [reanalyzing]);

  const clearAnalysis = () => {
    setAnalyzing(false);
    setProgress(0);
    setReanalyzing(false);
    setReanalyzeProgress(0);
    setAnalysisResult(null);
    setPayloadContext("");
  };

  return (
    <Context.Provider value={{
      analyzing, progress, reanalyzing, reanalyzeProgress, analysisResult, payloadContext,
      setAnalyzing, setProgress, setReanalyzing, setReanalyzeProgress, setAnalysisResult, setPayloadContext, clearAnalysis
    }}>
      {children}
    </Context.Provider>
  );
};
