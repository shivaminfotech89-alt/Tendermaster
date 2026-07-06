import { useState, useRef, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { Upload, X, Loader2, Sparkles, AlertCircle, FileText, CheckCircle2, ChevronRight, Activity, CalendarDays, Link as LinkIcon, File, MessageSquare, Send, Calculator, Building, Target, Download, Edit2, Trash2, Plus, Minus , ArrowLeft } from "lucide-react";
import { doc, setDoc, collection, addDoc, getDocs, query } from "firebase/firestore";
import { db } from "../lib/firebase";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "../lib/api";

const CollapsibleSection = ({ title, defaultOpen = true, children }: { title: string, defaultOpen?: boolean, children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="space-y-4 pt-4">
      <div 
        className="flex justify-between items-center cursor-pointer border-b border-indigo-100 pb-2 select-none group"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h2 className="text-sm font-black tracking-widest text-indigo-500 uppercase group-hover:text-indigo-700 transition-colors">{title}</h2>
        <div className="text-indigo-400 group-hover:text-indigo-600 bg-indigo-50 p-1 rounded-md transition-colors">
          {isOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        </div>
      </div>
      {isOpen && (
        <div className="animate-in fade-in zoom-in-95 duration-200">
           {children}
        </div>
      )}
    </div>
  );
};

export default function TenderAnalyzer() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  
  const { analyzing, progress, analysisResult, payloadContext, setAnalyzing, setProgress, setAnalysisResult, setPayloadContext, clearAnalysis } = useAnalyzerStore();

  const [inputType, setInputType] = useState<'url' | 'pdf' | 'zip'>('pdf');
  const [tenderUrl, setTenderUrl] = useState("");
  const [tenderPdfBase64, setTenderPdfBase64] = useState<string | string[]>("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [zipFilesData, setZipFilesData] = useState<string[]>([]);
  const [zipFileName, setZipFileName] = useState("");
  
  const [error, setError] = useState("");
  const [projectName, setProjectName] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [analyzedPayload, setAnalyzedPayload] = useState<any>(null);
  const [hasSaved, setHasSaved] = useState(false);
  
  // Chat state
  const [activeTab, setActiveTab] = useState<'overview'|'docs'|'calculator'|'chat'>('overview');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [confirmClearChat, setConfirmClearChat] = useState(false);

  const [materials, setMaterials] = useState<any[]>([]);
  const [labour, setLabour] = useState<any[]>([]);
  const [revenue, setRevenue] = useState(0);

  useEffect(() => {
    if (analysisResult?.financial_estimate) {
      if (analysisResult.financial_estimate.material_costs && materials.length === 0) {
        setMaterials(analysisResult.financial_estimate.material_costs.map((m: any) => ({ ...m, cost_num: parseInt(String(m.estimated_cost).replace(/[^0-9]/g, '')) || 0 })));
      }
      if (analysisResult.financial_estimate.labour_costs && labour.length === 0) {
        setLabour(analysisResult.financial_estimate.labour_costs.map((l: any) => ({ ...l, cost_num: parseInt(String(l.estimated_cost).replace(/[^0-9]/g, '')) || 0 })));
      }
      if (analysisResult.bid_recommendation?.recommended && revenue === 0) {
        setRevenue(parseInt(String(analysisResult.bid_recommendation.recommended).replace(/[^0-9]/g, '')) || 0);
      }
    }
  }, [analysisResult]);

  const totalExpense = materials.reduce((acc, m) => acc + (m.cost_num || 0), 0) + labour.reduce((acc, l) => acc + (l.cost_num || 0), 0);
  const estimatedProfit = revenue - totalExpense;

  
  // Business Profile Context
  const [businessProfile, setBusinessProfile] = useState<any>(null);

  // Doc Generator state
  const [hideTLDR, setHideTLDR] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState("");
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [docType, setDocType] = useState("Cover Letter");
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [extraInstructions, setExtraInstructions] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (analysisResult && !hasSaved) {
        e.preventDefault();
        e.returnValue = "You have unsaved analysis. Are you sure you want to leave without saving?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [analysisResult, hasSaved]);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    let totalSize = 0;
    const base64Files: string[] = [];
    
    for (const file of files) {
      totalSize += file.size;
    }
    
    if (totalSize > 30 * 1024 * 1024) {
      setError("Total size must be less than 30MB");
      return;
    }
    
    setPdfFileName(files.length === 1 ? files[0].name : `${files.length} PDFs selected`);
    
    for (const file of files) {
       const base64 = await new Promise<string>((resolve) => {
         const reader = new FileReader();
         reader.onload = () => resolve(reader.result as string);
         reader.readAsDataURL(file);
       });
       base64Files.push(base64);
    }
    setTenderPdfBase64(base64Files as any);
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 30 * 1024 * 1024) {
      setError("ZIP size must be less than 30MB");
      return;
    }
    
    setZipFileName(file.name);
    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);
      const fileDataArray: string[] = [];
      
      for (const [filename, zipEntry] of Object.entries(contents.files)) {
        if (zipEntry.dir) continue;
        
        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.endsWith('.pdf')) {
          const base64Data = await zipEntry.async("base64");
          fileDataArray.push(`data:application/pdf;base64,${base64Data}`);
        } else if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xls') || lowerFilename.endsWith('.csv')) {
          try {
            const arrayBuffer = await zipEntry.async("arraybuffer");
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            let allText = `\n--- CONTENT OF SPREADSHEET: ${filename} ---\n`;
            for (const sheetName of workbook.SheetNames) {
              allText += `\nSheet: ${sheetName}\n`;
              const sheet = workbook.Sheets[sheetName];
              const csv = XLSX.utils.sheet_to_csv(sheet);
              allText += csv;
            }
            // btoa expects a string, so we convert text to base64
            // To handle unicode, we use TextEncoder
            const utf8Bytes = new TextEncoder().encode(allText);
            const base64Text = btoa(String.fromCharCode(...utf8Bytes));
            fileDataArray.push(`data:text/plain;base64,${base64Text}`);
          } catch (err) {
            console.error(`Failed to parse spreadsheet ${filename}:`, err);
          }
        }
      }
      
      if (fileDataArray.length === 0) {
        setError("No supported documents (PDF, Excel, CSV) found in the ZIP folder.");
        setZipFileName("");
        return;
      }
      
      setZipFilesData(fileDataArray);
    } catch (err) {
      setError("Failed to extract ZIP file.");
      console.error(err);
    }
  };

  const clearPdf = () => {
    setPdfFileName("");
    setTenderPdfBase64("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearZip = () => {
    setZipFileName("");
    setZipFilesData([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAnalyze = async () => {
    let payload: string | string[] = "";
    
    if (inputType === 'url') {
      if (!tenderUrl.trim()) return setError("Please enter a valid tender URL.");
      payload = tenderUrl;
    } else if (inputType === 'pdf') {
      if (!tenderPdfBase64 || tenderPdfBase64.length === 0) return setError("Please upload a PDF document.");
      payload = tenderPdfBase64;
    } else if (inputType === 'zip') {
      if (!zipFilesData || zipFilesData.length === 0) return setError("Please upload a ZIP folder containing PDF documents.");
      payload = zipFilesData;
    }
    
    setError("");
    setAnalyzing(true);
    setAnalysisResult(null);

    try {
      const { doc: firestoreDoc, getDoc: fGetDoc } = await import("firebase/firestore");
      const { db: firestoreDb } = await import("../lib/firebase");
      
      const userRef = firestoreDoc(firestoreDb, "business_profiles", user!.uid);
      const userSnap = await fGetDoc(userRef);
      const profile = userSnap.exists() ? userSnap.data() : { turnover: 0, experienceYears: 0 };
      setBusinessProfile(userSnap.exists() ? userSnap.data() : null);


      const { ref, uploadString, getDownloadURL } = await import("firebase/storage");
      const { storage } = await import("../lib/firebase");

      let processedPayload = payload;
      let finalTenderType: string = inputType;

      if (inputType === 'pdf' || inputType === 'zip') {
        const dataUris = Array.isArray(payload) ? payload : [payload];
        const uploadedUrls = [];
        
        for (let i = 0; i < dataUris.length; i++) {
          const dataUri = dataUris[i];
          const storageRef = ref(storage, `users/${user?.uid || 'anon'}/tenders/${Date.now()}_${i}`);
          await uploadString(storageRef, dataUri, 'data_url');
          const url = await getDownloadURL(storageRef);
          uploadedUrls.push(url);
        }
        
        processedPayload = uploadedUrls;
        finalTenderType = 'storage_urls';
      }
      
      setAnalyzedPayload(processedPayload);

      const response = await fetchWithAuth("/api/analyze-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          tenderType: finalTenderType,
          tenderContent: processedPayload,
          userProfile: JSON.stringify(profile),
          language: i18n.language
        })
      });


      let data;
      const responseText = await response.text();
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`The document is too large or the analysis took too long for Vercel limits (60s). Please try a smaller document or check back later.`);
      }

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setAnalysisResult(data.analysis);
      setPayloadContext(payload);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveToPipeline = async () => {
    if (!analysisResult || !user) return;
    setSaving(true);
    try {
       await addDoc(collection(db, "saved_tenders"), {
         userId: user.uid,
         projectName: projectName || analysisResult.tender_title || "Unnamed Project",
         tenderId: Date.now().toString(),
         details: analysisResult,
         payloadRef: inputType === 'url' ? tenderUrl : (analyzedPayload ? analyzedPayload : 'Text/PDF Document'),
         savedAt: new Date()
       });

       await addDoc(collection(db, "notifications"), {
         userId: user.uid,
         message: "New project saved to your pipeline.",
         read: false,
         createdAt: new Date()
       });
       
       setHasSaved(true);
       toast.success("Project saved to your pipeline successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save project.");
    } finally {
      setSaving(false);
    }
  };

  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const handleDownloadPDF = async () => {
    try {
      setIsExportingPDF(true);
      if (!(window as any).html2pdf) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      
      const element = document.getElementById('analyzer-report-container');
      
      const opt = {
        margin:       0.3,
        filename:     `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'analysis'}_report.pdf`,
        image:        { type: 'jpeg' as const, quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, windowWidth: 1024 },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' as const }
      };
      
      await (window as any).html2pdf().set(opt).from(element).save();
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate PDF. Falling back to print.");
      window.print();
    } finally {
      setIsExportingPDF(false);
    }
  };

  const generateDocument = async () => {
    if (!analysisResult) return;
    setGeneratingDoc(true);
    setGeneratedDoc("Generating...");
    setIsEditingDoc(false);
    try {
      const res = await fetchWithAuth("/api/generate-doc", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            docType,
            tenderDetails: analysisResult,
            userProfile: businessProfile,
            extraInstructions,
            language: i18n.language
         })
      });
      const resText = await res.text();
      let data;
      try {
         data = JSON.parse(resText);
      } catch (e) {
         throw new Error(`The document is too large or the analysis took too long for Vercel limits (60s). Please try a smaller document or check back later.`);
      }
      if (!res.ok) throw new Error(data.error || "Failed to generate document");
      setGeneratedDoc(data.document);
    } catch (e: any) {
      toast.error("Failed to generate: " + e.message);
    } finally {
      setGeneratingDoc(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    
    const newMessages = [...messages, { role: 'user' as const, text: chatInput }];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

    try {
      const response = await fetchWithAuth("/api/chat-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderDocument: payloadContext,
          analysisResult,
          messages: newMessages,
          language: i18n.language
        })
      });
      
      const resText = await response.text();
      let data;
      try {
         data = JSON.parse(resText);
      } catch (e) {
         throw new Error(`The document is too large or the analysis took too long for Vercel limits (60s). Please try a smaller document or check back later.`);
      }
      if (!response.ok) throw new Error(data.error || "Failed to process query");
      
      setMessages([...newMessages, { role: 'model', text: data.answer }]);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      setMessages([...newMessages, { role: 'model', text: "Error: Failed to process query. " + String(err) }]);
    } finally {
      setChatLoading(false);
    }
  };

  const getMatchColor = (score: number) => {
    if (score >= 80) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (score >= 50) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  const [whatsappNumber, setWhatsappNumber] = useState("7990878248");
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDocs(query(collection(db, "system_settings")));
        snap.forEach(d => {
          if (d.id === "payments") {
            setWhatsappNumber(d.data().whatsapp_number || "7990878248");
          }
        });
      } catch (e) {}
    }
    fetchSettings();
  }, []);

  const LockedOverlay = () => (
    <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm my-6 p-12 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">{t("locked_feature")}</h2>
      <p className="text-slate-600 mb-6 max-w-md mx-auto">{t("premium_required")}</p>
      
      <div className="bg-slate-50 p-4 rounded-lg mb-6 border border-slate-200 text-sm max-w-sm w-full">
        <p className="mb-2 text-slate-700 font-semibold text-left">How to unlock:</p>
        <p className="text-left text-slate-600">Please visit the Settings page to select a plan and upgrade your account.</p>
      </div>

      <button 
        onClick={() => window.location.href = '/dashboard/settings'}
        className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-lg font-bold shadow-sm transition-colors"
      >
        Go to Settings to Upgrade
      </button>
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto pb-24 relative">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("analyzer")}</h1>
          <p className="text-slate-500 mt-1">Cross-match GeM/eProcure documents against your business constraints.</p>
        </div>
      </div>

      {!analysisResult && (
        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-opacity ${analyzing ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="p-0 border-b border-slate-100 flex items-center bg-slate-50 overflow-x-auto">
            <button 
              onClick={() => setInputType('pdf')}
              className={`flex-1 py-4 px-6 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 whitespace-nowrap ${inputType === 'pdf' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <File className="w-4 h-4" /> Attach PDF Files
            </button>
            <button 
              onClick={() => setInputType('zip')}
              className={`flex-1 py-4 px-6 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 whitespace-nowrap ${inputType === 'zip' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <Upload className="w-4 h-4" /> ZIP Folder (PDF, Excel, CSV)
            </button>
            <button 
              onClick={() => setInputType('url')}
              className={`flex-1 py-4 px-6 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 whitespace-nowrap ${inputType === 'url' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <LinkIcon className="w-4 h-4" /> Web Link
            </button>
          </div>
          <div className="p-6 md:p-8">
            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-200">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {inputType === 'pdf' && (
              <div className="space-y-4">
                {!pdfFileName ? (
                  <div 
                    onClick={() => !analyzing && fileInputRef.current?.click()}
                    className={`border-2 border-dashed border-slate-300 rounded-xl p-8 md:p-12 text-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all ${analyzing ? 'opacity-50' : ''}`}
                  >
                    <File className="w-10 h-10 text-blue-500 mx-auto mb-4" />
                    <p className="font-medium text-slate-800 text-lg mb-1">Upload PDF tender documents</p>
                    <p className="text-sm text-slate-500">Supported formats: .pdf</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl p-6 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="bg-blue-100 p-3 rounded-lg text-blue-600">
                         <FileText className="w-6 h-6" />
                       </div>
                       <div>
                         <p className="font-semibold text-slate-800">{pdfFileName}</p>
                         <p className="text-sm text-slate-500">Ready for analysis</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={clearPdf} disabled={analyzing} className="text-slate-500 hover:text-red-500 p-2 disabled:opacity-50">
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleAnalyze} 
                        disabled={analyzing}
                        className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing</> : 'Analyze Document'}
                      </button>
                    </div>
                  </div>
                )}
                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,application/pdf" multiple onChange={(e) => (inputType as string) === 'pdf' ? handlePdfUpload(e) : handleZipUpload(e)} />
              </div>
            )}
            
            {inputType === 'zip' && (
               <div className="space-y-4">
                 {!zipFileName ? (
                   <div 
                     onClick={() => !analyzing && fileInputRef.current?.click()}
                     className={`border-2 border-dashed border-slate-300 rounded-xl p-8 md:p-12 text-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all ${analyzing ? 'opacity-50' : ''}`}
                   >
                     <Upload className="w-10 h-10 text-indigo-500 mx-auto mb-4" />
                     <p className="font-medium text-slate-800 text-lg mb-1">Upload ZIP containing tender documents</p>
                     <p className="text-sm text-slate-500">Includes PDFs, BOQ Excel, CSV, text files</p>
                   </div>
                 ) : (
                   <div className="border border-slate-200 rounded-xl p-6 bg-slate-50 flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className="bg-indigo-100 p-3 rounded-lg text-indigo-600">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{zipFileName}</p>
                          <p className="text-sm text-slate-500">{zipFilesData.length} documents ready</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-3">
                       <button onClick={clearZip} disabled={analyzing} className="text-slate-500 hover:text-red-500 p-2 disabled:opacity-50">
                         <Trash2 className="w-5 h-5" />
                       </button>
                       <button 
                         onClick={handleAnalyze} 
                         disabled={analyzing}
                         className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                       >
                         {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing</> : 'Analyze ZIP'}
                       </button>
                     </div>
                   </div>
                 )}
                 <input type="file" ref={fileInputRef} className="hidden" accept=".zip,application/zip" onChange={(e) => (inputType as string) === 'pdf' ? handlePdfUpload(e) : handleZipUpload(e)} />
               </div>
            )}

            {inputType === 'url' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input 
                    type="url"
                    value={tenderUrl}
                    onChange={e => setTenderUrl(e.target.value)}
                    placeholder="https://gem.gov.in/tender/..." 
                    className="flex-1 px-4 py-3 rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                  <button 
                    onClick={() => { if(tenderUrl) handleAnalyze(); }}
                    disabled={!tenderUrl || analyzing}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
                  >
                    Analyze
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {analysisResult && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
            <div>
               <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                 <Target className="w-5 h-5 text-emerald-600" />
                 Analysis Complete
               </h2>
               <p className="text-sm text-slate-500 mt-1">Review the AI generated breakdown below.</p>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
               <button onClick={clearAnalysis} className="text-slate-500 hover:text-slate-800 font-semibold text-sm flex items-center gap-2">
                 <ArrowLeft className="w-4 h-4" /> New Analysis
               </button>
               <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                 <button className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 shrink-0 print:hidden border border-slate-200 shadow-sm transition-colors disabled:opacity-50">
                   Export PDF Report
                 </button>
                 <input 
                   type="text" 
                   value={projectName}
                   onChange={e => setProjectName(e.target.value)}
                   placeholder="Enter Workspace / Project Name..." 
                   className="flex-1 md:w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                 />
                 <button onClick={handleSaveToPipeline} disabled={saving} className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 shrink-0 transition-colors">
                   {saving ? "Saving..." : "Save Project"}
                 </button>
               </div>
            </div>
          </div>

          <div className="flex border-b border-slate-200 mb-6 bg-white rounded-xl shadow-sm overflow-x-auto print:hidden">

                <button onClick={() => setActiveTab('overview')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'overview' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Overview</button>
                <button onClick={() => setActiveTab('docs')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'docs' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Auto-Generate Documents</button>
                <button onClick={() => setActiveTab('calculator')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'calculator' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Bid Engine & Profit Calculator</button>
                <button onClick={() => setActiveTab('chat')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'chat' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Chat AI</button>
             </div>

            {activeTab === 'overview' && (
              <>
            {/* Quick Executive Summary */}
            {!hideTLDR && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100 shadow-sm mt-6 mb-8 relative group">
              <button onClick={() => setHideTLDR(true)} className="absolute top-4 right-4 text-blue-400 hover:text-blue-700 bg-blue-100/50 hover:bg-blue-200 p-1.5 rounded-full transition-colors opacity-0 group-hover:opacity-100" title="Hide Summary">
                <X className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-bold text-blue-900 mb-2 pr-8">TL;DR / Quick Summary</h2>
              <p className="text-blue-800 leading-relaxed font-medium">
                 {analysisResult.tender_simplified.scope_of_work}
              </p>
            </div>
            )}

            {/* Part 1: Match with Profile */}
            <CollapsibleSection title="Part 1: Match With Profile & Assessment">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row mt-2">
               <div className={`p-8 md:w-1/3 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r ${getMatchColor(analysisResult.compatibility.score)}`}>
                 <div className="text-center">
                    <span className="text-sm font-bold uppercase tracking-widest opacity-80 mb-2 block">Match Score</span>
                    <span className="text-7xl font-black">{analysisResult.compatibility.score}</span>
                    <span className="text-2xl font-bold opacity-50">/100</span>
                 </div>
               </div>
               <div className="p-8 md:w-2/3 flex flex-col justify-center">
                  <h3 className="text-lg font-bold text-slate-900 mb-2">AI Strategic Assessment</h3>
                  <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                    {analysisResult.compatibility.rationale}
                  </p>
               </div>
            </div>
            </CollapsibleSection>
            </>
            )}

            {/* Bid Recommendation / Risk Calculator */}
            {activeTab === 'calculator' && role === 'free' && <LockedOverlay />}
            {activeTab === 'calculator' && role !== 'free' && analysisResult.bid_recommendation && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
                {/* Bid Recommendation */}
                <div className="p-6 md:w-2/3">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <Target className="w-5 h-5 text-indigo-600" /> AI Risk & Bid Calculator
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Estimated Value</p>
                      <p className="font-bold text-slate-800">{analysisResult.bid_recommendation.estimated_value || '₹ -'}</p>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                      <p className="text-xs text-blue-600 font-semibold mb-1">Target Bid</p>
                      <p className="font-black text-blue-700">{analysisResult.bid_recommendation.recommended || '₹ -'}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Safe Range</p>
                      <p className="font-semibold text-slate-700 text-sm overflow-hidden text-ellipsis whitespace-nowrap" title={analysisResult.bid_recommendation.safe_range}>{analysisResult.bid_recommendation.safe_range || '₹ -'}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Risk Level</p>
                      <p className="font-bold text-slate-800">{analysisResult.bid_recommendation.risk_level || '-'}</p>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-600 border border-slate-100">
                    <span className="font-semibold text-slate-700">Rationale: </span>
                    {analysisResult.bid_recommendation.rationale}
                  </div>
                </div>

                {/* Winning Probability */}
                {analysisResult.winning_probability && (
                  <div className="p-6 md:w-1/3 flex flex-col items-center justify-center bg-gradient-to-b from-white to-slate-50">
                     <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">Winning Probability</h3>
                     <div className="relative flex items-center justify-center">
                        <svg className="w-32 h-32 transform -rotate-90">
                           <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
                           <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={56 * 2 * Math.PI} strokeDashoffset={(56 * 2 * Math.PI) - ((analysisResult.winning_probability.score || 0) / 100) * (56 * 2 * Math.PI)} className="text-emerald-500 transition-all duration-1000 ease-out" strokeLinecap="round" />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                           <span className="text-3xl font-black text-slate-800">{analysisResult.winning_probability.score || 0}%</span>
                        </div>
                     </div>
                     <p className="mt-4 text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                       {analysisResult.winning_probability.recommended_action || "Participate"}
                     </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'overview' && (
              <>
              <CollapsibleSection title="Part 2: Tender Information & Scope">
              {/* Simplified Scope */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mt-2">
                 <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                   <FileText className="w-5 h-5 text-blue-600" />
                   Scope of Work
                 </h3>
                 <p className="text-slate-700 text-sm leading-relaxed mb-6">
                   {analysisResult.tender_simplified.scope_of_work}
                 </p>
                 
                 <div className="grid grid-cols-1 gap-4">
                   <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                     <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-widest mb-3">Green Flags</h4>
                     <ul className="space-y-2">
                       {analysisResult.tender_simplified.pros.map((p: string, i: number) => (
                         <li key={i} className="flex gap-2 text-sm text-emerald-900">
                           <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                           {p}
                         </li>
                       ))}
                     </ul>
                   </div>
                   <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                     <h4 className="text-xs font-bold text-red-800 uppercase tracking-widest mb-3">Red Flags & Risks</h4>
                     <ul className="space-y-2">
                       {analysisResult.tender_simplified.cons_and_risks.map((p: string, i: number) => (
                         <li key={i} className="flex gap-2 text-sm text-red-900">
                           <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                           {p}
                         </li>
                       ))}
                     </ul>
                   </div>
                 </div>
              </div>
</CollapsibleSection>

              {/* Part 3: Timeline & Steps */}
              {role === 'free' ? <LockedOverlay /> : (
              <>
              <CollapsibleSection title="Part 3: Updation & Roadmap">
                <div className="flex flex-col gap-6 mt-2">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-blue-600" />
                    Key Milestones
                  </h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-500">Pre-Bid Meeting</span>
                      <span className="text-sm font-bold text-slate-900">{analysisResult.timeline_and_milestones.pre_bid_meeting}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-500">Clarification Closes</span>
                      <span className="text-sm font-bold text-slate-900">{analysisResult.timeline_and_milestones.clarification_deadline}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-500">Submission Deadline</span>
                      <span className="text-sm font-bold text-slate-900 text-red-600">{analysisResult.timeline_and_milestones.submission_deadline}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-semibold text-slate-500">Contract Duration</span>
                      <span className="text-sm font-bold text-slate-900">{analysisResult.timeline_and_milestones.execution_duration}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm p-6 text-white h-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                     <Activity className="w-5 h-5 text-amber-400" />
                     Execution Strategy
                  </h3>
                  <div className="space-y-3">
                    {analysisResult.application_roadmap.winning_strategy_tips?.map((tip: string, i: number) => (
                      <div key={i} className="flex gap-3 text-sm text-slate-300">
                         <ChevronRight className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                         <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm p-6">
                   <h3 className="text-lg font-bold text-indigo-950 mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-indigo-600" />
                      Application Procedure & Road Map
                   </h3>
                   <div className="text-sm font-semibold text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded inline-block mb-4">
                     Portal: {analysisResult.application_roadmap.portal_source}
                   </div>
                   
                   <div className="space-y-4">
                     {analysisResult.application_roadmap.detailed_procedure_steps && analysisResult.application_roadmap.detailed_procedure_steps.length > 0 ? (
                       <div className="space-y-3">
                         {analysisResult.application_roadmap.detailed_procedure_steps.map((step: string, i: number) => (
                           <div key={i} className="flex gap-3 items-start">
                             <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
                             <p className="text-sm text-slate-700 leading-relaxed font-medium">{step}</p>
                           </div>
                         ))}
                       </div>
                     ) : (
                       <ul className="space-y-2">
                         {analysisResult.application_roadmap.next_immediate_steps?.map((step: string, i: number) => (
                           <li key={i} className="flex gap-3 text-sm text-slate-700">
                             <ChevronRight className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                             <span>{step}</span>
                           </li>
                         ))}
                       </ul>
                     )}
                   </div>
                </div>
              </div>
            </div>
            </CollapsibleSection>

            {/* Part 4: Requirements */}
            <CollapsibleSection title="Part 4: Requirements & Financials">
              
            {/* Financial analytics */}
            {analysisResult.financial_estimate && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-2">
                 <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-indigo-600" />
                        Estimated Materials & Labor Cost Breakup
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">AI-estimated baseline costs derived from BOQ/scope data.</p>
                    </div>
                    <div className="text-right">
                       <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Est. Total Cost</p>
                       <p className="text-2xl font-black text-indigo-700">{analysisResult.financial_estimate.total_estimated_cost}</p>
                    </div>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                    <div className="p-6">
                       <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-slate-400" /> Material Costs</h4>
                       <ul className="space-y-4">
                         {analysisResult.financial_estimate.material_costs.map((mc: any, i: number) => (
                            <li key={i} className="flex justify-between items-start gap-4">
                               <div>
                                 <p className="font-semibold text-slate-900">{mc.item}</p>
                                 <p className="text-xs text-slate-500 mt-0.5">{mc.rationale}</p>
                               </div>
                               <span className="font-mono text-sm font-bold text-slate-700 bg-slate-50 px-2 py-1 rounded">{mc.estimated_cost}</span>
                            </li>
                         ))}
                       </ul>
                    </div>
                    <div className="p-6">
                       <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Labor Costs</h4>
                       <ul className="space-y-4">
                         {analysisResult.financial_estimate.labour_costs.map((lc: any, i: number) => (
                            <li key={i} className="flex justify-between items-start gap-4">
                               <div>
                                 <p className="font-semibold text-slate-900">{lc.role}</p>
                                 <p className="text-xs text-slate-500 mt-0.5">{lc.rationale}</p>
                               </div>
                               <span className="font-mono text-sm font-bold text-slate-700 bg-slate-50 px-2 py-1 rounded">{lc.estimated_cost}</span>
                            </li>
                         ))}
                       </ul>
                    </div>
                 </div>
              </div>
            )}

            {/* Checklist */}
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                   <h3 className="text-lg font-bold text-slate-900">Document Compliance Checklist</h3>
                   <p className="text-sm text-slate-500 mt-1">Gather these documents before initiating the portal upload.</p>
                </div>
                <div className="p-0">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-4 pl-6">Document Name</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 pr-6">Context</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysisResult.required_documents_checklist.map((doc: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 pl-6 font-medium text-slate-900 w-1/3">{doc.document_name}</td>
                          <td className="p-4 w-1/6">
                             <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${doc.status.toLowerCase() === 'mandatory' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>
                               {doc.status}
                             </span>
                          </td>
                          <td className="p-4 pr-6 text-slate-600 w-1/2">{doc.context}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
             </div>

             {/* Required Annexures */}
             {analysisResult.required_annexures && analysisResult.required_annexures.length > 0 && (
               <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                 <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800">Required Annexures & Schedules</h3>
                 </div>
                 <div className="p-0 overflow-x-auto">
                   <table className="w-full text-left text-sm border-collapse">
                     <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                       <tr>
                         <th className="p-4 pl-6 w-1/3">Annexure Name</th>
                         <th className="p-4 w-1/2">Purpose</th>
                         <th className="p-4 pr-6 w-1/6">Filling Complexity</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                       {analysisResult.required_annexures.map((annex: any, i: number) => (
                         <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                           <td className="p-4 pl-6 font-medium text-slate-900">{annex.annexure_name}</td>
                           <td className="p-4 text-slate-600">{annex.purpose}</td>
                           <td className="p-4 pr-6">
                              <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${annex.filling_complexity?.toLowerCase?.() === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                                {annex.filling_complexity || 'Medium'}
                              </span>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
             )}

             </CollapsibleSection>
             </>
             )}
             
             </>
             )}

             {/* Generate Documents */}
             {activeTab === 'docs' && role === 'free' && <LockedOverlay />}
             {activeTab === 'docs' && role !== 'free' && (
             <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 shadow-sm overflow-hidden mb-6">
               <div className="p-5 border-b border-indigo-100/50">
                  <h3 className="font-semibold text-indigo-900 flex items-center gap-2"><FileText className="w-5 h-5" /> Auto-Generate Documents</h3>
                  <p className="text-xs text-indigo-700/70 mt-1">Generate tender submission documents tailored to this project.</p>
               </div>
               <div className="p-5 space-y-4">
                  <select 
                    value={docType} 
                    onChange={e => setDocType(e.target.value)}
                    className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <optgroup label="Standard Documents">
                      <option>Cover Letter</option>
                      <option>Bid Submission Letter</option>
                      <option>Undertaking / Declaration</option>
                      <option>Compliance Sheet</option>
                      <option>Company Profile Summary</option>
                      <option>Technical Proposal</option>
                      <option>Commercial Proposal Template</option>
                    </optgroup>
                    {analysisResult?.required_annexures && analysisResult.required_annexures.length > 0 && (
                      <optgroup label="Tender Specific Annexures & Schedules">
                        {analysisResult.required_annexures.map((annex: any, idx: number) => (
                           <option key={idx} value={`Auto-Fill: ${annex.annexure_name}`}>Auto-Fill: {annex.annexure_name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <input
                    type="text"
                    placeholder="Optional: Enter specific details or numbers for this document..."
                    value={extraInstructions}
                    onChange={(e) => setExtraInstructions(e.target.value)}
                    className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 mt-3 mb-3"
                  />
                  <button 
                    onClick={generateDocument} 
                    disabled={generatingDoc}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center flex items-center justify-center gap-2 transition-colors"
                  >
                    {generatingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                    {generatingDoc ? "Drafting..." : "Generate Draft"}
                  </button>

                  {generatedDoc && (
                     <div className="mt-6">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-indigo-900 uppercase">Generated Output</span>
                          <div className="flex items-center gap-3">
                           <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={useLetterhead} 
                                onChange={(e) => setUseLetterhead(e.target.checked)} 
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Use Letterhead
                           </label>
                           <button onClick={() => {
                               const printWindow = window.open('', '', 'width=800,height=900');
                               if (!printWindow) return;
                               const content = document.getElementById('generated-doc-content-analyzer')?.innerHTML || '';

                               let headerHtml = '';
                               let footerHtml = '';
                               let bgImageHtml = '';
                               let pageMargin = '20mm'; // Standard A4 margin
                               let bodyPadding = '0';
                               
                               if (useLetterhead && businessProfile) {
                                  if (businessProfile.letterheadBackgroundImage) {
                                     bgImageHtml = `<img src="${businessProfile.letterheadBackgroundImage}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; object-fit: cover; margin: 0; padding: 0;" />`;
                                     // Full bleed for letterhead image
                                     pageMargin = '0';
                                     bodyPadding = '0 20mm'; // Add side margins via body padding
                                     
                                     // A4 height is 297mm. Add top/bottom space for the graphics.
                                     headerHtml = `<div style="height: 35mm; width: 100%;"></div>`;
                                     footerHtml = `<div style="height: 25mm; width: 100%;"></div>`;
                                  } else {
                                     headerHtml = businessProfile.letterheadHeader || `<div style="text-align:center; padding-bottom: 5mm; border-bottom: 2px solid #000; margin-bottom: 5mm;"><h2>${businessProfile.companyName || 'Company Name'}</h2><p>${businessProfile.contactDetails || ''}</p></div>`;
                                     footerHtml = businessProfile.letterheadFooter || `<div style="text-align:center; padding-top: 5mm; border-top: 1px solid #000; margin-top: 5mm; font-size: 12px;"><p>${businessProfile.website || ''}</p></div>`;
                                  }
                               }

                               printWindow.document.write(`
                                 <html>
                                   <head>
                                     <title>Print Document - ${docType}</title>
                                     <style>
                                       @page { size: A4; margin: ${pageMargin}; }
                                       body { 
                                         font-family: system-ui, -apple-system, sans-serif; 
                                         color: #111827; 
                                         margin: 0;
                                         padding: ${bodyPadding};
                                         box-sizing: border-box;
                                       }
                                       .content { font-size: 11pt; line-height: 1.6; }
                                       
                                       /* Layout tables (header/footer) */
                                       table.layout-table { width: 100%; border-collapse: collapse; border: none; margin: 0; padding: 0; table-layout: fixed; }
                                       table.layout-table > thead { display: table-header-group; }
                                       table.layout-table > tfoot { display: table-footer-group; }
                                       table.layout-table > tbody > tr > td { border: none; padding: 0; }
                                       table.layout-table > thead > tr > td { border: none; padding: 0; }
                                       table.layout-table > tfoot > tr > td { border: none; padding: 0; }
                                       
                                       /* Content tables inside the document */
                                       table:not(.layout-table) { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; page-break-inside: auto; }
                                       table:not(.layout-table) tr { page-break-inside: avoid; page-break-after: auto; }
                                       table:not(.layout-table) th, table:not(.layout-table) td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; word-wrap: break-word; }
                                       table:not(.layout-table) th { background-color: #f3f4f6; }
                                       
                                       h1, h2, h3, h4, h5 { margin-top: 15px; margin-bottom: 10px; page-break-after: avoid; }
                                       p { margin-bottom: 10px; }
                                       ul, ol { margin-bottom: 10px; padding-left: 20px; }
                                       
                                       @media print {
                                          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                        }
                                     </style>
                                   </head>
                                   <body>
                                     ${bgImageHtml}
                                     <table class="layout-table">
                                       <thead>
                                         <tr>
                                           <td>
                                             ${headerHtml}
                                           </td>
                                         </tr>
                                       </thead>
                                       <tbody>
                                         <tr>
                                           <td>
                                             <div class="content">
                                               ${content}
                                             </div>
                                           </td>
                                         </tr>
                                       </tbody>
                                       <tfoot>
                                         <tr>
                                           <td>
                                             ${footerHtml}
                                           </td>
                                         </tr>
                                       </tfoot>
                                     </table>
                                   </body>
                                 </html>
                               `);
                               printWindow.document.close();
                               printWindow.focus();
                               setTimeout(() => {
                                 printWindow.print();
                                 printWindow.close();
                               }, 250);
                             }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium transition-colors">
                                <FileText className="w-3 h-3" /> Print
                             </button>
                             <button onClick={() => {
                               const blob = new Blob([generatedDoc], {type: "text/plain"});
                               const url = URL.createObjectURL(blob);
                               const a = document.createElement("a");
                               a.href = url;
                               a.download = docType.replace(/\s+/g, "_") + ".txt";
                               a.click();
                             }} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                                <Download className="w-3 h-3" /> Download
                             </button>
                             <button onClick={() => {
                                navigator.clipboard.writeText(generatedDoc);
                                toast.success("Copied to clipboard!");
                             }} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                                <FileText className="w-3 h-3" /> Copy
                             </button>
                             <button onClick={() => setIsEditingDoc(!isEditingDoc)} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                                <Edit2 className="w-3 h-3" /> {isEditingDoc ? "Preview" : "Edit"}
                             </button>
                          </div>
                        </div>
                        <div id="generated-doc-content-analyzer" className="bg-white p-4 rounded-lg border border-indigo-100 text-sm h-64 overflow-y-auto font-mono text-indigo-950 prose prose-sm prose-indigo max-w-none">
                           {isEditingDoc ? (
                             <textarea
                               value={generatedDoc}
                               onChange={(e) => setGeneratedDoc(e.target.value)}
                               className="w-full h-[200px] p-2 border-none focus:ring-0 resize-none font-mono text-xs bg-indigo-50/50"
                             />
                           ) : (
                             <Markdown remarkPlugins={[remarkGfm]}>{generatedDoc || "No document generated yet."}</Markdown>
                           )}
                        </div>
                     </div>
                  )}
               </div>
             </div>
             )}

             {/* Integrated Chatbot for active tender */}
             {activeTab === 'chat' && role === 'free' && <LockedOverlay />}
             {activeTab === 'chat' && role !== 'free' && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: '500px' }}>
                <div className="p-4 border-b border-slate-100 bg-blue-600 text-white flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <h3 className="font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" />
                        Ask Questions About This Tender
                      </h3>
                      <span className="text-xs bg-blue-500 px-2 py-1 rounded font-medium">TenderMaster AI</span>
                   </div>
                   <button 
                     onClick={() => {
                         if (messages.length > 0) {
                             if (confirmClearChat) {
                                 setMessages([]);
                                 setConfirmClearChat(false);
                             } else {
                                 setConfirmClearChat(true);
                                 setTimeout(() => setConfirmClearChat(false), 3000);
                             }
                         }
                     }} 
                     className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1 shrink-0 ${confirmClearChat ? 'bg-red-500 hover:bg-red-600 text-white font-bold' : 'bg-blue-700 hover:bg-blue-800 text-blue-100'}`}
                   >
                     <Trash2 className="w-3 h-3" /> {confirmClearChat ? 'Confirm Clear?' : 'Clear Chat'}
                   </button>
                </div>
                
                <div className="flex-1 p-4 overflow-y-auto bg-slate-50 flex flex-col gap-4">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                       <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
                       <p className="text-sm">Ask any question to clarify EMD, eligibility, technical docs, or deadlines.</p>
                       <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-md">
                         <button onClick={() => setChatInput("What is the exact EMD amount and how should it be paid?")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">What is the EMD?</button>
                         <button onClick={() => setChatInput("Do MSME registered companies get an exemption for turnover or EMD?")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">MSME Exemptions?</button>
                       </div>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'}`}>
                           <div className={msg.role === 'user' ? "prose prose-sm prose-invert max-w-none" : "prose prose-sm max-w-none"}>
                             <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                           </div>
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex justify-start">
                       <div className="bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-bl-sm p-4 text-sm shadow-sm flex items-center gap-2">
                         <Loader2 className="w-4 h-4 animate-spin" /> Thinking...
                       </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
                
                <div className="p-4 border-t border-slate-100 bg-white">
                   <div className="flex items-end gap-2">
                     <textarea 
                       value={chatInput}
                       onChange={e => setChatInput(e.target.value)}
                       onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                       className="flex-1 border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                       placeholder="Message TenderMaster AI..."
                       rows={2}
                     />
                     <button 
                       onClick={handleSendMessage}
                       disabled={!chatInput.trim() || chatLoading}
                       className="bg-blue-600 hover:bg-blue-700 text-white w-11 h-11 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 transition-colors"
                     >
                       <Send className="w-5 h-5 -ml-0.5" />
                     </button>
                   </div>
                </div>
             </div>
             )}
        </div>
      )}
    </div>
  );
}