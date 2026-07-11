import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, arrayUnion } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ArrowLeft, AlertCircle, Calculator, Building, Activity, Upload, FileText, Download, Loader2, Save, Plus, Target, CheckCircle, ListTodo, Calendar, MessageSquare, Send, X, Trash2, RefreshCw, Edit2, Check, ChevronRight, Info } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import JSZip from "jszip";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { fetchWithAuth } from "../lib/api";

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function sanitizeDocOutput(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '  \n')           // <br> → Markdown line break
    .replace(/<[^>]*data:[^>]*\/>[^<]*/gi, '') // self-closing tags with data: URIs
    .replace(/<[^>]*data:[^>]*>[\s\S]*?<\/[^>]+>/gi, '') // block tags wrapping data: URIs
    .replace(/<[^>]+>/g, '')                   // any remaining HTML tags
    .replace(/\[(?:FILL\s*MANUALLY?|NOT\s*APPLICABLE|INSERT\s*HERE|FILL|N\/?A|TBD|TO\s*BE\s*FILLED?)\]/gi, '__________')
    .trim();
}
const LARGE_FILE_BYTES = 20 * 1024 * 1024;

function friendlyAnalysisError(raw: string): string {
  if (/exceeds the maximum number of tokens|1048576/i.test(raw))
    return "Your documents are too large to analyze together. Please analyze fewer or smaller documents at a time.";
  if (/exceeds the supported page limit/i.test(raw))
    return "Your documents have too many pages to analyze at once. Please analyze the key documents separately.";
  if (/RESOURCE_EXHAUSTED|credits|quota/i.test(raw))
    return "Analysis is temporarily unavailable. Please try again in a few minutes.";
  if (/too long|timed? ?out/i.test(raw))
    return "The analysis took too long. Please try with fewer or smaller documents.";
  return "Analysis couldn't be completed. Please try again or with smaller documents.";
}

function fmtDate(ts: any): string {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProjectDetails() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [businessProfile, setBusinessProfile] = useState<any>(null);
  
  // Renaming State
  const [isEditingName, setIsEditingName] = useState(false);
  const [projectName, setProjectName] = useState("");

  // Calculator States
  const [materials, setMaterials] = useState<any[]>([]);
  const [labour, setLabour] = useState<any[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [savingCalc, setSavingCalc] = useState(false);

  // Document Generation
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState("");
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [docType, setDocType] = useState("Covering Letter");
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [exactFormMode, setExactFormMode] = useState(false);
  const [exactFormFile, setExactFormFile] = useState<File | null>(null);
  
  // Checked items for action center
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  // Uploaded docs
  const [uploadedFiles, setUploadedFiles] = useState<{name: string, size: string, type: string, bytes?: number}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chatbot state
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string, createdAt?: Date}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  
  // Comparison State
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'overview'|'docs'|'calculator'|'chat'|'notes'>('overview');
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReanalyzeModal, setShowReanalyzeModal] = useState(false);
  const [showClearChatModal, setShowClearChatModal] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    const fetchProject = async () => {
      try {
        const docRef = doc(db, "saved_tenders", projectId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProject(data);
          setProjectName(data.projectName || data.details?.tender_simplified?.scope_of_work || "Unnamed Project");
          
          if (data.materials) setMaterials(data.materials);
          else if (data.details?.financial_estimate?.material_costs) {
            setMaterials(data.details.financial_estimate.material_costs.map((m: any) => ({ ...m, cost_num: parseInt(m.estimated_cost.replace(/[^0-9]/g, '')) || 0 })));
          }

          if (data.labour) setLabour(data.labour);
          else if (data.details?.financial_estimate?.labour_costs) {
            setLabour(data.details.financial_estimate.labour_costs.map((l: any) => ({ ...l, cost_num: parseInt(l.estimated_cost.replace(/[^0-9]/g, '')) || 0 })));
          }
          
          if (data.revenue) setRevenue(data.revenue);
          
          if (data.checkedItems) setCheckedItems(data.checkedItems);
          
          if (data.uploadedFiles) setUploadedFiles(data.uploadedFiles);
        }
        
        if (user) {
           const profileRef = doc(db, "business_profiles", user.uid);
           const pSnap = await getDoc(profileRef);
           if (pSnap.exists()) setBusinessProfile(pSnap.data());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [projectId, user]);

  useEffect(() => {
    if (!projectId || !user) return;
    const loadChatHistory = async () => {
      try {
        const q = query(collection(db, "chat_messages"), where("userId", "==", user.uid), where("projectId", "==", projectId));
        const snap = await getDocs(q);
        const msgs = snap.docs
          .map(d => d.data() as any)
          .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
          .map(d => ({
            role: d.role as 'user' | 'model',
            text: d.text as string,
            createdAt: d.createdAt?.toDate?.() as Date | undefined,
          }));
        setMessages(msgs);
      } catch (e) {
        console.error("Failed to load chat history:", e);
      }
    };
    loadChatHistory();
  }, [projectId, user]);

  const handleSaveName = async () => {
    if (!projectId || !projectName.trim()) return;
    try {
      await updateDoc(doc(db, "saved_tenders", projectId), {
        projectName: projectName.trim()
      });
      setIsEditingName(false);
    } catch (e) {
      console.error(e);
      console.log("Failed to rename project");
    }
  };

  const saveCalculations = async () => {
    if (!projectId) return;
    setSavingCalc(true);
    try {
      const docRef = doc(db, "saved_tenders", projectId);
      await updateDoc(docRef, {
        materials,
        labour,
        revenue
      });
      
      // Auto re-analyze financial risk with manual data
      setReanalyzing(true);
      const expenseTotal = materials.reduce((a, m) => a + (m.cost_num || 0), 0) + labour.reduce((a, l) => a + (l.cost_num || 0), 0);
      const payload = `--- CURRENT FINANCIAL STATE (MANUALLY UPDATED BY USER) ---\nBid Value / Revenue: ₹${revenue}\nTotal Expenses: ₹${expenseTotal}\n\nPlease critically re-analyze the bid recommendation and winning probability using these precise user-provided numbers.`;
        
      const response = await fetchWithAuth("/api/analyze-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          tenderType: Array.isArray(project.payloadRef) ? 'storage_urls' : (typeof project.payloadRef === 'string' && project.payloadRef.startsWith('http') ? 'url' : 'text'),
          tenderContent: (project.payloadRef && project.payloadRef !== 'Text/PDF Document') ? project.payloadRef : JSON.stringify(project.details),
          userProfile: JSON.stringify(businessProfile || {}),
          extraContext: payload,
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
      if (!response.ok) throw new Error(data.error || "Financial Re-analysis failed");
      const updatedDetails = data.analysis;
      
      setProject((prev: any) => ({ ...prev, details: updatedDetails }));
      await updateDoc(docRef, { details: updatedDetails, lastReanalyzedAt: serverTimestamp() });

      toast.success("Calculations saved and Financial AI Risk re-analyzed!");
    } catch (e: any) {
      console.error(e);
      toast.error("Saved calculations but AI re-analysis failed: " + friendlyAnalysisError(e.message));
    } finally {
      setSavingCalc(false);
      setReanalyzing(false);
    }
  };

  const { reanalyzing, reanalyzeProgress, setReanalyzing, setReanalyzeProgress } = useAnalyzerStore();
  const navigate = useNavigate();

  const handleRemoveProject = async () => {
    if (!projectId) return;
    try {
      await deleteDoc(doc(db, "saved_tenders", projectId));
      setShowDeleteModal(false);
      navigate("/dashboard/projects");
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to delete project: " + e.message);
    }
  };

  const handleClearChat = async () => {
    if (!projectId) return;
    try {
      const q = query(collection(db, "chat_messages"), where("userId", "==", user.uid), where("projectId", "==", projectId));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setMessages([]);
      setShowClearChatModal(false);
    } catch (e) {
      console.error("Failed to clear chat:", e);
    }
  };

  const handleManualReanalyze = async () => {
    if (!projectId || !project?.details) return;
    
    setShowReanalyzeModal(false);
    setReanalyzing(true);
    try {
        const payload = `--- CURRENT STATE TO BE IMPROVED ---\n${JSON.stringify(project.details)}\n\nPlease re-analyze this tender from scratch and return the JSON. Ensure risk values and projections are thoroughly detailed.`;
        
        const response = await fetchWithAuth("/api/analyze-tender", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            tenderType: Array.isArray(project.payloadRef) ? 'storage_urls' : (typeof project.payloadRef === 'string' && project.payloadRef.startsWith('http') ? 'url' : 'text'),
            tenderContent: project.payloadRef || project.details.tender_simplified.scope_of_work,
            userProfile: JSON.stringify(businessProfile || {}),
            extraContext: payload,
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
        if (!response.ok) throw new Error(data.error || "Re-analysis failed");
        
        const updatedDetails = data.analysis;
        setProject((prev: any) => ({ ...prev, details: updatedDetails }));

        const docRef = doc(db, "saved_tenders", projectId);
        await updateDoc(docRef, { details: updatedDetails, lastReanalyzedAt: serverTimestamp() });

        toast.success("Project thoroughly re-analyzed!");
    } catch (e: any) {
        console.error(e);
        const friendly = friendlyAnalysisError(e.message);
        toast.error(friendly);
        try {
          const docRef = doc(db, "saved_tenders", projectId);
          const currentRemarks = project?.remarks || { totalFilesProvided: 0, filesAnalyzed: 0, filesSkipped: [], notes: [] };
          const updatedRemarks = { ...currentRemarks, notes: [...(currentRemarks.notes || []), `Re-analysis failed: ${friendly} The original analysis remains unchanged.`] };
          await updateDoc(docRef, { remarks: updatedRemarks });
          setProject((prev: any) => prev ? { ...prev, remarks: updatedRemarks } : prev);
        } catch { /* note save failure is non-critical */ }
    } finally {
        setReanalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      let type = "Other";
      if (file.name.toLowerCase().includes('corrigendum')) type = "Corrigendum";
      else if (file.name.toLowerCase().includes('boq')) type = "BOQ";
      else if (file.name.toLowerCase().includes('zip') || file.type === "application/zip" || file.type === "application/x-zip-compressed") type = "ZIP File";
      else if (file.name.toLowerCase().includes('pdf') || file.type === "application/pdf") type = "Tender Document";
      
      const newFiles = [...uploadedFiles, { name: file.name, size: formatFileSize(file.size), type, bytes: file.size }];
      setUploadedFiles(newFiles);
      
      if (projectId) {
        const docRef = doc(db, "saved_tenders", projectId);
        await updateDoc(docRef, { uploadedFiles: newFiles });
      }

      setReanalyzing(true);
      
      try {
          const payload = `--- EXISTING PROJECT KNOWLEDGE ---\n${JSON.stringify(project.details)}\n\n--- NEW UPLOADED DOCUMENT: ${file.name} ---\nThe user uploaded this new document. Please re-analyze the entire project and output the completely updated JSON state, factoring in any changes (eligibility, dates, boq, etc).`;
          
          let tenderTypeToSend = "pdf";
          let contentToSend: string | string[] = "";
          let uploadedEntryNames: string[] = [];
          
          if (type === "ZIP File") {
             const zip = new JSZip();
             const contents = await zip.loadAsync(file);
             const pdfBase64Array: string[] = [];
             const zipEntryNames: string[] = [];

             for (const [filename, zipEntry] of Object.entries(contents.files)) {
                if (!zipEntry.dir && filename.toLowerCase().endsWith('.pdf')) {
                   const base64Data = await zipEntry.async("base64");
                   pdfBase64Array.push(`data:application/pdf;base64,${base64Data}`);
                   zipEntryNames.push(filename.split('/').pop() || filename);
                }
             }
             if (pdfBase64Array.length === 0) {
                 setReanalyzing(false);
                 toast.error("No PDFs found in the ZIP.");
                 return;
             }
             tenderTypeToSend = "zip";
             contentToSend = pdfBase64Array;
             uploadedEntryNames = zipEntryNames;
          } else {
             contentToSend = await new Promise<string>((resolve) => {
                 const reader = new FileReader();
                 reader.onload = () => resolve(reader.result as string);
                 reader.readAsDataURL(file);
             });
          }

          // Upload files to Firebase Storage so they appear in Source Documents
          const newSourceUrls: string[] = [];
          const newSourceNames: string[] = [];
          try {
            const { ref: sRef, uploadString: uploadStr, getDownloadURL } = await import("firebase/storage");
            const { storage } = await import("../lib/firebase");
            const dataUris = Array.isArray(contentToSend) ? contentToSend as string[] : [contentToSend as string];
            for (let idx = 0; idx < dataUris.length; idx++) {
              const entryName = uploadedEntryNames.length === dataUris.length
                ? uploadedEntryNames[idx]
                : (dataUris.length === 1 ? file.name : `${file.name} — part ${idx + 1}`);
              const fileRef = sRef(storage, `users/${user?.uid}/tenders/${Date.now()}_${idx}_${file.name}`);
              await uploadStr(fileRef, dataUris[idx], 'data_url');
              newSourceUrls.push(await getDownloadURL(fileRef));
              newSourceNames.push(entryName);
            }
            if (newSourceUrls.length > 0 && projectId) {
              await updateDoc(doc(db, "saved_tenders", projectId), {
                sourceDocuments: arrayUnion(...newSourceUrls),
                sourceDocumentNames: arrayUnion(...newSourceNames),
              });
              setProject((prev: any) => prev ? {
                ...prev,
                sourceDocuments: [...((prev.sourceDocuments as string[]) || []), ...newSourceUrls],
                sourceDocumentNames: [...((prev.sourceDocumentNames as string[]) || []), ...newSourceNames],
              } : prev);
            }
          } catch (uploadErr) {
            console.warn("Source document storage upload failed — analysis will still proceed:", uploadErr);
          }

          const response = await fetchWithAuth("/api/analyze-tender", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ 
               tenderType: Array.isArray(contentToSend) ? 'storage_urls' : (typeof contentToSend === 'string' && contentToSend.startsWith('http') ? 'url' : 'text'),
               tenderContent: contentToSend,
               userProfile: JSON.stringify(businessProfile || {}),
               extraContext: payload,
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
          if (!response.ok) throw new Error(data.error || "Re-analysis failed");
          
          // Update project state
          const updatedDetails = data.analysis;
          setProject((prev: any) => ({ ...prev, details: updatedDetails }));

          if (projectId) {
             const docRef = doc(db, "saved_tenders", projectId);
             await updateDoc(docRef, { details: updatedDetails, lastReanalyzedAt: serverTimestamp() });
          }
          toast.success("Project completely re-analyzed with new document!");
      } catch (err: any) {
          console.error("Reanalysis Error:", err);
          const friendly = friendlyAnalysisError(err.message);
          toast.error(friendly);
          try {
            const docRef = doc(db, "saved_tenders", projectId);
            const currentRemarks = project?.remarks || { totalFilesProvided: 0, filesAnalyzed: 0, filesSkipped: [], notes: [] };
            const noteText = `Re-analysis failed after uploading "${file.name}": ${friendly} The file appears in Source Documents but was not included in the analysis.`;
            const updatedRemarks = { ...currentRemarks, notes: [...(currentRemarks.notes || []), noteText] };
            await updateDoc(docRef, { remarks: updatedRemarks });
            setProject((prev: any) => prev ? { ...prev, remarks: updatedRemarks } : prev);
          } catch { /* note save failure is non-critical */ }
      } finally {
          setReanalyzing(false);
      }
    }
  };

  const handleRemoveFile = async (index: number) => {
    if (!projectId) return;
    const newFiles = [...uploadedFiles];
    newFiles.splice(index, 1);
    setUploadedFiles(newFiles);
    
    try {
      const docRef = doc(db, "saved_tenders", projectId);
      await updateDoc(docRef, { uploadedFiles: newFiles });
    } catch (e) {
      console.error("Failed to remove file", e);
    }
  };

  const handleCompare = async (fileRec: any) => {
     setShowCompareModal(true);
     setComparing(true);
     setComparisonResult(null);
     
     try {
       const res = await fetchWithAuth("/api/compare-tender", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            originalTender: project.details,
            newDocument: "Corrigendum Details Attached. Timeline extended by 30 days due to Covid. Technical eligibility now requires 5 years instead of 3 years. EMD is unchanged.", // Mocking file text extraction for brevity
            documentType: fileRec.type,
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
       if (!res.ok) throw new Error(data.error || "Failed to compare tender");
       setComparisonResult(data.comparison);
     } catch(e: any) {
       alert("Error comparing: " + e.message);
       setShowCompareModal(false);
     } finally {
       setComparing(false);
     }
  };

  const generateDocument = async () => {
    if (!project) return;
    if (exactFormMode && !exactFormFile) {
      toast.error("Please upload the blank form you want filled.");
      return;
    }
    setGeneratingDoc(true);
    setGeneratedDoc("Generating...");
    setIsEditingDoc(false);
    try {
      let exactFormBase64: string | undefined;
      let exactFormMimeType: string | undefined;
      if (exactFormMode && exactFormFile) {
        exactFormBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(exactFormFile);
        });
        exactFormMimeType = exactFormFile.type || "application/pdf";
      }
      const res = await fetchWithAuth("/api/generate-doc", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            docType: exactFormMode ? "Exact Form Fill" : docType,
            tenderDetails: project.details,
            userProfile: businessProfile,
            extraInstructions,
            financialData: {
              revenue,
              materials,
              labour
            },
            language: i18n.language,
            ...(exactFormBase64 ? { exactFormBase64, exactFormMimeType } : {}),
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
      setGeneratedDoc(sanitizeDocOutput(data.document));
    } catch (e: any) {
      toast.error("Failed to generate: " + e.message);
    } finally {
      setGeneratingDoc(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userText = chatInput;
    const userMsg = { role: 'user' as const, text: userText, createdAt: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    if (projectId && user) {
      addDoc(collection(db, "chat_messages"), {
        userId: user.uid,
        projectId,
        role: 'user',
        text: userText,
        createdAt: serverTimestamp(),
      }).catch(e => console.error("Failed to save user message:", e));
    }

    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

    try {
      const response = await fetchWithAuth("/api/chat-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderDocument: project.payloadRef,
          analysisResult: project.details,
          messages: newMessages.map(m => ({ role: m.role, text: m.text })),
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

      const aiText = data.answer;
      const aiMsg = { role: 'model' as const, text: aiText, createdAt: new Date() };
      setMessages([...newMessages, aiMsg]);

      if (projectId && user) {
        addDoc(collection(db, "chat_messages"), {
          userId: user.uid,
          projectId,
          role: 'model',
          text: aiText,
          createdAt: serverTimestamp(),
        }).catch(e => console.error("Failed to save AI message:", e));
      }

      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      setMessages([...newMessages, { role: 'model', text: "Error: Failed to process query. " + String(err), createdAt: new Date() }]);
    } finally {
      setChatLoading(false);
    }
  };

  const totalExpense = materials.reduce((acc, m) => acc + (m.cost_num || 0), 0) + labour.reduce((acc, l) => acc + (l.cost_num || 0), 0);
  const estimatedProfit = revenue - totalExpense;

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
      
      const element = document.getElementById('report-container');
      
      const opt = {
        margin:       [0.3, 0.3, 0.8, 0.3],
        filename:     `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_report.pdf`,
        image:        { type: 'jpeg' as const, quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, windowWidth: 1024 },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' as const }
      };
      
      await (window as any).html2pdf().set(opt).from(element).save();
    } catch (e) {
      console.error(e);
      alert("Failed to generate PDF. Falling back to print.");
      window.print();
    } finally {
      setIsExportingPDF(false);
    }
  };

  const toggleCheckItem = async (itemName: string) => {
    if (!projectId) return;
    const newChecked = checkedItems.includes(itemName)
      ? checkedItems.filter(i => i !== itemName)
      : [...checkedItems, itemName];
      
    setCheckedItems(newChecked);
    try {
       await updateDoc(doc(db, "saved_tenders", projectId), { checkedItems: newChecked });
    } catch (e) {
       console.error("Failed to save checked item", e);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-4"/>Loading project...</div>;
  if (!project) return <div className="p-8 text-center text-slate-500">Project not found</div>;

  return (
    <>
      <div id="report-container" className={`p-6 md:p-8 max-w-7xl mx-auto space-y-8 pb-24 transition-opacity ${reanalyzing ? 'opacity-60 pointer-events-none' : ''}`}>
      
      {/* Header */}
      <div>
        <Link to="/dashboard" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-800 mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
           <div className="flex-1 mr-4">
             {isEditingName ? (
               <div className="flex items-center gap-2">
                 <input 
                   type="text" 
                   value={projectName} 
                   onChange={(e) => setProjectName(e.target.value)}
                   className="text-3xl font-bold tracking-tight text-slate-900 border-b-2 border-indigo-500 outline-none w-full bg-transparent px-1"
                   autoFocus
                   onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                 />
                 <button onClick={handleSaveName} className="text-emerald-600 p-2 hover:bg-emerald-50 rounded"><Check className="w-5 h-5"/></button>
                 <button onClick={() => { setIsEditingName(false); setProjectName(project.projectName || project.details?.tender_simplified?.scope_of_work || "Unnamed Project"); }} className="text-slate-400 p-2 hover:bg-slate-100 rounded"><X className="w-5 h-5"/></button>
               </div>
             ) : (
               <div className="flex items-center gap-3">
                 <h1 className="text-3xl font-bold tracking-tight text-slate-900 line-clamp-1">{projectName}</h1>
                 <button onClick={() => setIsEditingName(true)} className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-md hover:bg-slate-100"><Edit2 className="w-4 h-4" /></button>
               </div>
             )}
             <p className="text-slate-500 mt-1 flex items-center gap-2">
                Project ID: <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">{projectId}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${project.details?.compatibility?.score >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>
                   Match Score: {project.details?.compatibility?.score}/100
                </span>
             </p>
             <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-400">
               {project.savedAt && <span>Saved: {fmtDate(project.savedAt)}</span>}
               {project.lastReanalyzedAt && <span>Last re-analyzed: {fmtDate(project.lastReanalyzedAt)}</span>}
             </div>
           </div>
           <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
             <button onClick={() => setShowReanalyzeModal(true)} disabled={reanalyzing} className="font-semibold px-4 py-2 rounded-lg text-sm border flex items-center gap-2 transition-colors shrink-0 print:hidden bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200">
               {reanalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
               {reanalyzing ? `Re-Analyzing... ${Math.floor(reanalyzeProgress)}%` : "Re-Analyze"}
             </button>
             <button onClick={() => setShowDeleteModal(true)} className="font-semibold px-4 py-2 rounded-lg text-sm border flex items-center gap-2 transition-colors shrink-0 print:hidden bg-red-50 hover:bg-red-100 text-red-700 border-red-200">
               <Trash2 className="w-4 h-4" /> Remove Project
             </button>
             <button onClick={handleDownloadPDF} disabled={isExportingPDF} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-lg text-sm border border-slate-200 flex items-center gap-2 transition-colors shrink-0 print:hidden disabled:opacity-50">
               {isExportingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} 
               {isExportingPDF ? "Generating PDF..." : "Export PDF Report"}
             </button>
           </div>
        </div>
      </div>

      {/* Quick Executive Summary */}
      {project.details?.tender_simplified?.scope_of_work && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100 shadow-sm">
          <h2 className="text-xl font-bold text-blue-900 mb-2">TL;DR / Quick Summary</h2>
          <p className="text-blue-800 leading-relaxed font-medium">
             {project.details.tender_simplified.scope_of_work}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-slate-200 mb-8 pb-px no-scrollbar">
         <button onClick={() => setActiveTab('overview')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'overview' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Overview</button>
         <button onClick={() => setActiveTab('docs')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'docs' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Auto-Generate Documents</button>
         <button onClick={() => setActiveTab('calculator')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'calculator' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Bid Engine & Profit Calculator</button>
         <button onClick={() => setActiveTab('chat')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'chat' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Chat AI</button>
         <button onClick={() => setActiveTab('notes')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'notes' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Analysis Notes</button>
      </div>

      <div className="flex flex-col gap-8">
        
        {/* Active Tab Content */}
        <div className="w-full">
           
           {activeTab === 'overview' && (
             <div className="space-y-8">
               {/* Source Documents — original tender files stored in Firebase Storage */}
               {(() => {
                 const ref = project?.payloadRef;
                 const payloadUrls: string[] = Array.isArray(ref)
                   ? ref.filter((u: any) => typeof u === 'string' && u.startsWith('http'))
                   : typeof ref === 'string' && ref.startsWith('http')
                   ? [ref]
                   : [];
                 const payloadNames: string[] = (project?.payloadRefNames as string[]) || [];

                 const sourceDocUrls: string[] = ((project?.sourceDocuments as string[]) || [])
                   .filter((u: any) => typeof u === 'string' && u.startsWith('http'));
                 const sourceDocNames: string[] = (project?.sourceDocumentNames as string[]) || [];

                 const deduped = sourceDocUrls.filter(u => !payloadUrls.includes(u));
                 const dedupedNames: string[] = deduped.map((_, i) => sourceDocNames[sourceDocUrls.indexOf(deduped[i])] || `Document ${payloadUrls.length + i + 1}`);

                 const urls: string[] = [...payloadUrls, ...deduped];
                 const names: string[] = [
                   ...payloadUrls.map((_, i) => payloadNames[i] || (urls.length === 1 ? 'Source Document' : `Document ${i + 1}`)),
                   ...dedupedNames,
                 ];

                 if (urls.length === 0) return null;
                 return (
                   <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                     <div className="p-5 border-b border-slate-100">
                       <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                         <FileText className="w-5 h-5 text-indigo-600" /> Source Documents
                       </h3>
                       <p className="text-xs text-slate-500 mt-1">Original tender files used for this analysis.</p>
                     </div>
                     <div className="p-5 flex flex-wrap gap-3">
                       {urls.map((url, i) => (
                         <a
                           key={i}
                           href={url}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-semibold transition-colors"
                         >
                           <FileText className="w-4 h-4" />
                           {names[i]}
                         </a>
                       ))}
                     </div>
                   </div>
                 );
               })()}

               {/* Uploaded Documents */}
               <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-600" /> Project Documents & ZIPs</h3>
                    <button disabled={reanalyzing} onClick={() => fileInputRef.current?.click()} className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors disabled:opacity-50">
                      {reanalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.doc,.docx,.zip,application/pdf,application/zip" onChange={handleFileUpload} />
                 </div>
                 <div className="p-5">
                    {uploadedFiles.length === 0 ? (
                      <div className="text-center text-sm text-slate-500 py-4 border-2 border-dashed border-slate-200 rounded-xl">
                         <p>No documents uploaded.</p>
                         <p className="text-xs mt-1">Upload PDF documents or a ZIP file containing multiple documents.</p>
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {uploadedFiles.map((f: any, i) => (
                          <li key={i} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                             <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-3 overflow-hidden">
                                    <FileText className="w-5 h-5 text-slate-400 shrink-0" />
                                    <div className="truncate">
                                       <p className="text-sm font-medium text-slate-700 truncate">{f.name}</p>
                                       <p className="text-xs text-slate-400">{f.size} • {f.type}</p>
                                       {f.bytes != null && f.bytes > LARGE_FILE_BYTES && (
                                         <p className="text-xs text-amber-600 mt-0.5">Large file — may take longer or exceed analysis limits.</p>
                                       )}
                                    </div>
                                 </div>
                                 <button onClick={() => {
                                    handleRemoveFile(i);
                                 }} className="text-slate-400 hover:text-red-500 p-1 rounded transition-colors shrink-0">
                                    <X className="w-4 h-4" />
                                 </button>
                             </div>
                             {f.type !== 'Tender Document' && f.type !== 'Other' && (
                                 <div className="flex gap-2 mt-1">
                                   <button 
                                     onClick={() => handleCompare(f)}
                                     disabled={reanalyzing}
                                     className="text-[10px] bg-indigo-100/50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded border border-indigo-200 transition-colors disabled:opacity-50"
                                   >
                                     {reanalyzing ? `Re-Analyzing... ${Math.floor(reanalyzeProgress)}%` : 'Action: Compare & Re-Analyze'}
                                   </button>
                                 </div>
                             )}
                          </li>
                        ))}
                      </ul>
                    )}
                 </div>
               </div>
             </div>
           )}

           {activeTab === 'docs' && (
             <div className="space-y-8">

           {/* Generate Documents */}
           <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
             <div className="p-5 border-b border-indigo-100/50">
                <h3 className="font-semibold text-indigo-900 flex items-center gap-2"><FileText className="w-5 h-5" /> Auto-Generate Documents</h3>
                <p className="text-xs text-indigo-700/70 mt-1">Generate tender submission documents tailored to this project.</p>
             </div>
             <div className="p-5 space-y-4">
                {/* Mode toggle */}
                <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-sm font-medium">
                  <button
                    onClick={() => { setExactFormMode(false); setExactFormFile(null); }}
                    className={`flex-1 py-2 transition-colors ${!exactFormMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}
                  >
                    Generate from tender data
                  </button>
                  <button
                    onClick={() => setExactFormMode(true)}
                    className={`flex-1 py-2 transition-colors ${exactFormMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}
                  >
                    Fill an uploaded form
                  </button>
                </div>

                {!exactFormMode ? (
                <select
                  value={docType}
                  onChange={e => setDocType(e.target.value)}
                  className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                >
                  <optgroup label="Standard Documents">
                    <option>Cover Letter</option>
                    <option>Bid Submission Letter</option>
                    <option>Undertaking / Declaration</option>
                    <option>Compliance Sheet</option>
                    <option>Company Profile Summary</option>
                    <option>Technical Proposal</option>
                    <option>Commercial Proposal Template</option>
                    <option>Authorization Letter</option>
                    <option>Experience Summary</option>
                    <option>Joint Venture Agreement Template</option>
                  </optgroup>
                  {project.details?.required_annexures && project.details.required_annexures.length > 0 && (
                    <optgroup label="Tender Specific Annexures & Schedules">
                      {project.details.required_annexures.map((annex: any, idx: number) => (
                         <option key={idx} value={`Auto-Fill: ${annex.annexure_name}`}>Auto-Fill: {annex.annexure_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                ) : (
                <div>
                  <p className="text-xs text-indigo-700/80 mb-2">Upload the blank form/annexure page from your tender (PDF or image). The AI will reproduce its exact structure and fill your details in.</p>
                  {!exactFormFile ? (
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-indigo-300 rounded-lg cursor-pointer bg-white hover:bg-indigo-50 transition-colors">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Upload className="w-5 h-5 text-indigo-400" />
                        <span className="text-xs text-indigo-600 font-medium">Click to upload blank form</span>
                        <span className="text-[10px] text-slate-400">PDF or image • max 20 MB</span>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          if (f && f.size > LARGE_FILE_BYTES) {
                            toast.error("File is over 20 MB — please use a smaller file or a single page.");
                            return;
                          }
                          setExactFormFile(f);
                        }}
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 bg-white border border-indigo-200 rounded-lg px-3 py-2.5">
                      <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="text-xs text-indigo-900 font-medium truncate flex-1">{exactFormFile.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{formatFileSize(exactFormFile.size)}</span>
                      <button onClick={() => setExactFormFile(null)} className="text-slate-400 hover:text-red-500 shrink-0 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                )}

                <input
                  type="text"
                  placeholder="Optional: Enter specific details or instructions for this document..."
                  value={extraInstructions}
                  onChange={(e) => setExtraInstructions(e.target.value)}
                  className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                />
                <button
                  onClick={generateDocument}
                  disabled={generatingDoc}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center flex items-center justify-center gap-2"
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
                             const content = document.getElementById('generated-doc-content')?.innerHTML || '';
                             
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
                                   headerHtml = `<div style="height: 45mm; width: 100%;"></div>`;
                                   footerHtml = `<div style="height: 45mm; width: 100%;"></div>`;
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
                           }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium">
                              <FileText className="w-3 h-3" /> Print
                           </button>
                           <button onClick={() => {
                             const blob = new Blob([generatedDoc], {type: "text/plain"});
                             const url = URL.createObjectURL(blob);
                             const a = document.createElement("a");
                             a.href = url;
                             a.download = docType.replace(/\s+/g, "_") + ".txt";
                             a.click();
                           }} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
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
                      <div className="flex items-start gap-2 px-3 py-2.5 mb-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                        <span>AI-generated draft — verify against the exact format in the original tender before submission. Some fields, clauses, or formatting may need manual alignment with the tender's prescribed annexure.</span>
                      </div>
                      <div className="flex items-start gap-2 px-3 py-2.5 mb-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                        <span>Fields have been filled automatically from your Business Profile and tender details. Blank underlines (<span className="font-mono">__________</span>) indicate information not found in your profile — fill these in manually before submission, and verify all details against the original tender.</span>
                      </div>
                      <div id="generated-doc-content" className="bg-white p-4 rounded-lg border border-indigo-100 text-sm h-64 overflow-y-auto font-mono text-indigo-950 prose prose-sm prose-indigo max-w-none">
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

        </div>
        )}

        {/* Right Column: Financial Calculation */}
        {activeTab === 'calculator' && (
        <div className="lg:col-span-2 space-y-8">
          
           {project.details?.bid_recommendation ? (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
               {/* Bid Recommendation */}
               <div className="p-6 md:w-2/3">
                 <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
                   <Target className="w-5 h-5 text-indigo-600" /> Bid Recommendation Engine
                 </h3>
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                   <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                     <p className="text-xs text-slate-500 mb-1">Estimated Value</p>
                     <p className="font-bold text-slate-800">{project.details?.bid_recommendation?.estimated_value || '₹ -'}</p>
                   </div>
                   <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                     <p className="text-xs text-indigo-600 font-semibold mb-1">Target Bid</p>
                     <p className="font-black text-indigo-700">{project.details?.bid_recommendation?.recommended || '₹ -'}</p>
                   </div>
                   <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                     <p className="text-xs text-slate-500 mb-1">Safe Range</p>
                     <p className="font-semibold text-slate-700 text-sm overflow-hidden text-ellipsis whitespace-nowrap" title={project.details?.bid_recommendation?.safe_range}>{project.details?.bid_recommendation?.safe_range || '₹ -'}</p>
                   </div>
                   <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                     <p className="text-xs text-slate-500 mb-1">Expected Margin</p>
                     <p className="font-bold text-slate-800">{project.details?.bid_recommendation?.margin_range || '-'}</p>
                   </div>
                 </div>
                 <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-600 border border-slate-100">
                   <span className="font-semibold text-slate-700">Rationale: </span>
                   {project.details?.bid_recommendation?.rationale}
                 </div>
               </div>

               {/* Winning Probability */}
               {project.details?.winning_probability && (
                 <div className="p-6 md:w-1/3 flex flex-col items-center justify-center bg-gradient-to-b from-white to-slate-50">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">Winning Probability</h3>
                    <div className="relative flex items-center justify-center">
                       <svg className="w-32 h-32 transform -rotate-90">
                          <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
                          <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={56 * 2 * Math.PI} strokeDashoffset={(56 * 2 * Math.PI) - ((project.details.winning_probability.score || 0) / 100) * (56 * 2 * Math.PI)} className="text-emerald-500 transition-all duration-1000 ease-out" strokeLinecap="round" />
                       </svg>
                       <div className="absolute flex flex-col items-center">
                          <span className="text-3xl font-black text-slate-800">{project.details.winning_probability.score || 0}%</span>
                       </div>
                    </div>
                    <p className="mt-4 text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                      {project.details.winning_probability.recommended_action || "Participate"}
                    </p>
                 </div>
               )}
             </div>
           ) : (
             <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
               <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
               <span>AI bid recommendation isn't available for this analysis — you can still calculate manually below.</span>
             </div>
           )}

           <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
             
             {/* Header */}
             <div className="bg-slate-900 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                   <h3 className="text-xl font-bold text-white flex items-center gap-2">
                     <Calculator className="w-6 h-6 text-emerald-400" />
                     Expense & Profit Calculator
                   </h3>
                   <p className="text-sm text-slate-400 mt-1">Adjust AI estimates manually to calculate accurate profit margins.</p>
                </div>
                <button onClick={saveCalculations} disabled={savingCalc} className="bg-gradient-to-br from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-sm">
                   {savingCalc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                   Save Calculation
                </button>
             </div>

             <div className="p-6 space-y-8 bg-slate-50">
                
                {project.details?.bid_recommendation && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-4">
                     <h4 className="font-bold text-indigo-900 flex items-center gap-2 mb-3">
                       <Target className="w-4 h-4" /> AI Bid Recommendation
                     </h4>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-white p-3 rounded border border-indigo-100">
                           <p className="text-[10px] uppercase font-bold text-indigo-400">Aggressive Bid</p>
                           <p className="font-mono font-bold text-indigo-900">{project.details.bid_recommendation.aggressive}</p>
                        </div>
                        <div className="bg-white p-3 rounded border border-indigo-400 shadow-sm relative">
                           <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase">Recommended</span>
                           <p className="text-[10px] uppercase font-bold text-indigo-400">Sweet Spot</p>
                           <p className="font-mono text-lg font-black text-indigo-700">{project.details.bid_recommendation.recommended}</p>
                        </div>
                        <div className="bg-white p-3 rounded border border-indigo-100">
                           <p className="text-[10px] uppercase font-bold text-indigo-400">Conservative Bid</p>
                           <p className="font-mono font-bold text-indigo-900">{project.details.bid_recommendation.conservative}</p>
                        </div>
                     </div>
                     <div className="flex gap-4 text-xs text-indigo-800 bg-white/50 p-2 rounded">
                        <p><strong>Margin:</strong> {project.details.bid_recommendation.margin_range}</p>
                        <p><strong>Risk:</strong> {project.details.bid_recommendation.risk_level}</p>
                     </div>
                     <p className="text-xs text-slate-500 mt-2 italic">Disclaimer: AI recommendations are guidance only. Final pricing decisions remain with the bidder.</p>
                  </div>
                )}
                
                {/* Financial Summary */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                     <p className="text-xs font-bold text-slate-500 uppercase">Estimated Revenue (Bid Value)</p>
                     <div className="flex items-center mt-2">
                       <span className="text-slate-400 mr-1 text-lg font-bold">₹</span>
                       <input 
                         type="number"
                         value={revenue || ''}
                         onChange={e => setRevenue(Number(e.target.value))}
                         placeholder="Enter Bid Amount"
                         className="bg-transparent border-0 font-bold text-2xl text-slate-900 w-full p-0 focus:ring-0 outline-none"
                       />
                     </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                     <p className="text-xs font-bold text-slate-500 uppercase">Total Expenses</p>
                     <div className="mt-2 text-2xl font-bold text-rose-600">
                       ₹{totalExpense.toLocaleString()}
                     </div>
                  </div>
                  <div className={`p-4 rounded-xl border ${estimatedProfit > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                     <p className="text-xs font-bold uppercase opacity-70">Projected Profit / Loss</p>
                     <div className="mt-2 text-2xl font-bold">
                       ₹{estimatedProfit.toLocaleString()}
                     </div>
                     {revenue > 0 && (
                        <p className="text-sm font-medium mt-1 opacity-80">
                          {((estimatedProfit / revenue) * 100).toFixed(1)}% Margin
                        </p>
                     )}
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200">
                     <p className="text-xs font-bold text-slate-500 uppercase">Target Margin (%) &rarr; Auto Bid</p>
                     <div className="flex items-center mt-2">
                       <input 
                         type="number"
                         placeholder="e.g. 15"
                         onChange={e => {
                            const margin = Number(e.target.value);
                            if (margin > 0 && margin < 100) {
                               setRevenue(Math.round(totalExpense / (1 - margin / 100)));
                            }
                         }}
                         className="bg-transparent border-0 font-bold text-2xl text-slate-900 w-full p-0 focus:ring-0 outline-none"
                       />
                       <span className="text-slate-400 ml-1 text-lg font-bold">%</span>
                     </div>
                  </div>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   
                   {/* Materials */}
                   <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                         <h4 className="font-bold text-slate-800 flex items-center gap-2"><Building className="w-4 h-4 text-slate-400" /> Materials</h4>
                         <button onClick={() => setMaterials([...materials, { item: "New Material", cost_num: 0 }])} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center">
                           <Plus className="w-3 h-3 mr-1" /> Add
                         </button>
                      </div>
                      <div className="divide-y divide-slate-100">
                         {materials.map((m, idx) => (
                           <div key={idx} className="p-4 flex flex-col gap-2 relative group hover:bg-slate-50/50">
                              <input 
                                value={m.item} 
                                onChange={(e) => {
                                  const n = [...materials];
                                  n[idx].item = e.target.value;
                                  setMaterials(n);
                                }}
                                className="font-semibold text-slate-900 border-0 p-0 focus:ring-0 w-full bg-transparent outline-none"
                              />
                              <div className="flex items-center">
                                <span className="text-slate-400 font-medium mr-1">₹</span>
                                <input 
                                  type="number" 
                                  value={m.cost_num || ''} 
                                  onChange={(e) => {
                                    const n = [...materials];
                                    n[idx].cost_num = Number(e.target.value);
                                    setMaterials(n);
                                  }}
                                  className="font-mono text-sm border focus:ring-indigo-500 focus:border-indigo-500 rounded px-2 py-1 w-full"
                                  placeholder="0"
                                />
                              </div>
                              <button onClick={() => setMaterials(materials.filter((_, i) => i !== idx))} className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                &times;
                              </button>
                           </div>
                         ))}
                      </div>
                   </div>

                   {/* Labour */}
                   <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                         <h4 className="font-bold text-slate-800 flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Labour & Logistics</h4>
                         <button onClick={() => setLabour([...labour, { role: "New Role", cost_num: 0 }])} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center">
                           <Plus className="w-3 h-3 mr-1" /> Add
                         </button>
                      </div>
                      <div className="divide-y divide-slate-100">
                         {labour.map((l, idx) => (
                           <div key={idx} className="p-4 flex flex-col gap-2 relative group hover:bg-slate-50/50">
                              <input 
                                value={l.role} 
                                onChange={(e) => {
                                  const n = [...labour];
                                  n[idx].role = e.target.value;
                                  setLabour(n);
                                }}
                                className="font-semibold text-slate-900 border-0 p-0 focus:ring-0 w-full bg-transparent outline-none"
                              />
                              <div className="flex items-center">
                                <span className="text-slate-400 font-medium mr-1">₹</span>
                                <input 
                                  type="number" 
                                  value={l.cost_num || ''} 
                                  onChange={(e) => {
                                    const n = [...labour];
                                    n[idx].cost_num = Number(e.target.value);
                                    setLabour(n);
                                  }}
                                  className="font-mono text-sm border focus:ring-indigo-500 focus:border-indigo-500 rounded px-2 py-1 w-full"
                                  placeholder="0"
                                />
                              </div>
                              <button onClick={() => setLabour(labour.filter((_, i) => i !== idx))} className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                &times;
                              </button>
                           </div>
                         ))}
                      </div>
                   </div>

                </div>

             </div>
           </div>
         </div>
        )}

{/* Smart Timeline & Action Center */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Match Score + AI Strategic Assessment */}
            {project?.details?.compatibility && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
                <div className={`p-8 md:w-1/3 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r ${
                  (project.details.compatibility.score ?? 0) >= 80
                    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                    : (project.details.compatibility.score ?? 0) >= 50
                      ? 'text-amber-600 bg-amber-50 border-amber-200'
                      : 'text-red-600 bg-red-50 border-red-200'
                }`}>
                  <div className="text-center">
                    <span className="text-sm font-bold uppercase tracking-widest opacity-80 mb-2 block">Match Score</span>
                    <span className="text-7xl font-black">{project.details.compatibility.score}</span>
                    <span className="text-2xl font-bold opacity-50">/100</span>
                  </div>
                </div>
                <div className="p-8 md:w-2/3 flex flex-col justify-center">
                  <h3 className="text-lg font-bold text-slate-900 mb-2">AI Strategic Assessment</h3>
                  <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                    {project.details.compatibility.rationale}
                  </p>
                </div>
              </div>
            )}
            {/* Green Flags & Red Flags */}
            {project?.details?.tender_simplified && (project.details.tender_simplified.pros?.length > 0 || project.details.tender_simplified.cons_and_risks?.length > 0) && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="grid grid-cols-1 gap-4">
                  {project.details.tender_simplified.pros?.length > 0 && (
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                    <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-widest mb-3">Green Flags</h4>
                    <ul className="space-y-2">
                      {project.details.tender_simplified.pros.map((p: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-emerald-900">
                          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  )}
                  {project.details.tender_simplified.cons_and_risks?.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                    <h4 className="text-xs font-bold text-red-800 uppercase tracking-widest mb-3">Red Flags & Risks</h4>
                    <ul className="space-y-2">
                      {project.details.tender_simplified.cons_and_risks.map((p: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-red-900">
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-8 mt-8">
               
               {/* Smart Timeline */}
               <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                       <Calendar className="w-5 h-5 text-indigo-600" /> Smart Timeline
                     </h3>
                  </div>
                  <div className="p-5 overflow-x-auto">
                   <div className="flex flex-row items-start min-w-max gap-4 pb-4 pt-2 px-2">
                     {[
                       { label: "Tender Published", date: "Past", done: true },
                       { label: "Pre-bid Meeting", date: project.details?.timeline_and_milestones?.pre_bid_meeting || "TBD", done: false },
                       { label: "Clarification Deadline", date: project.details?.timeline_and_milestones?.clarification_deadline || "TBD", done: false },
                       { label: "Bid Submission", date: project.details?.timeline_and_milestones?.submission_deadline || "TBD", done: false, critical: true }
                     ].map((item, idx, arr) => {
                        const firstNotDoneIdx = arr.findIndex(i => !i.done);
                        const isActive = idx === firstNotDoneIdx;

                        return (
                        <div key={idx} className="flex flex-col relative w-48 shrink-0">
                           <div className="flex items-center w-full mb-4">
                             <div className={`w-4 h-4 rounded-full z-10 shrink-0 ${item.done ? 'bg-indigo-600' : (isActive ? 'bg-indigo-500 shadow-[0_0_12px_#6366f1] ring-4 ring-indigo-100' : 'bg-slate-200')} ${item.critical && !item.done && isActive ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e] ring-4 ring-rose-100' : ''} ${item.critical && !item.done && !isActive ? 'bg-rose-400 ring-4 ring-rose-50' : ''}`} />
                             {idx !== arr.length - 1 && <div className={`flex-1 h-1 ${item.done ? 'bg-indigo-600' : 'bg-slate-200'} -ml-1`} />}
                           </div>
                           <div className="pr-4">
                             <p className={`text-sm font-semibold ${item.critical ? 'text-rose-600' : 'text-slate-800'}`}>{item.label}</p>
                             <p className="text-xs text-slate-500 font-mono mt-1">{item.date}</p>
                           </div>
                        </div>
                     )})}
                   </div>
                  </div>
               </div>

               {/* Action Center */}
               <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100">
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                       <ListTodo className="w-5 h-5 text-indigo-600" /> Action Center
                     </h3>
                  </div>
                  <div className="p-5">
                     <div className="mb-4">
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                           <span>Submission Readiness</span>
                           <span>
                             {(() => {
                               const docsCount = project.details?.required_documents_checklist?.length || 1;
                               const uploadedCount = project.details?.required_documents_checklist?.filter((d: any) => uploadedFiles.some(f => (f.name || "").toLowerCase().includes((d.document_name || "").toLowerCase()) || (f.type || "").toLowerCase().includes((d.document_name || "").toLowerCase())) || checkedItems.includes(d.document_name)).length || 0;
                               const bidReady = revenue > 0 ? 1 : 0;
                               const totalSteps = docsCount + 2; // +1 analysis, +1 bid amount
                               const completedSteps = uploadedCount + 1 + bidReady;
                               return Math.round((completedSteps / totalSteps) * 100);
                             })()}%
                           </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                           <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500" style={{ width: `${(() => {
                               const docsCount = project.details?.required_documents_checklist?.length || 1;
                               const uploadedCount = project.details?.required_documents_checklist?.filter((d: any) => uploadedFiles.some(f => (f.name || "").toLowerCase().includes((d.document_name || "").toLowerCase()) || (f.type || "").toLowerCase().includes((d.document_name || "").toLowerCase())) || checkedItems.includes(d.document_name)).length || 0;
                               const bidReady = revenue > 0 ? 1 : 0;
                               const totalSteps = docsCount + 2; // +1 analysis, +1 bid amount
                               const completedSteps = uploadedCount + 1 + bidReady;
                               return Math.round((completedSteps / totalSteps) * 100);
                             })()}%` }}></div>
                        </div>
                     </div>
                     <ul className="space-y-3">
                       <li className="flex items-start gap-2">
                         <div className="mt-0.5"><CheckCircle className="w-5 h-5 text-emerald-500" /></div>
                         <div>
                            <p className="text-sm font-medium text-slate-700">Tender Analysis Reviewed</p>
                            <p className="text-xs text-slate-400">Completed automatically.</p>
                         </div>
                       </li>

                       {project.details?.required_documents_checklist?.map((docItem: any, idx: number) => {
                          // Check if uploaded
                          const isUploaded = uploadedFiles.some((f: any) => (f.name || "").toLowerCase().includes((docItem.document_name || "").toLowerCase()) || (f.type || "").toLowerCase().includes((docItem.document_name || "").toLowerCase()));
                          const isManuallyChecked = checkedItems.includes(docItem.document_name);
                          const isChecked = isUploaded || isManuallyChecked;
                          
                          return (
                            <li key={idx} className="flex items-start gap-2">
                              <button onClick={() => toggleCheckItem(docItem.document_name)} className="mt-0.5 cursor-pointer hover:opacity-80 transition-opacity">
                                 {isChecked ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <div className="w-5 h-5 rounded border-2 border-slate-300" />}
                              </button>
                              <div className="flex-1">
                                 <p className={`text-sm font-medium cursor-pointer ${isChecked ? 'text-slate-500 line-through' : 'text-slate-700'}`} onClick={() => toggleCheckItem(docItem.document_name)}>
                                   {docItem.document_name}
                                 </p>
                                 <p className={`text-xs ${isUploaded ? 'text-emerald-500' : (isManuallyChecked ? 'text-indigo-500' : (docItem.is_mandatory ? 'text-rose-500 font-semibold' : 'text-slate-400'))}`}>
                                    {isUploaded ? 'Uploaded & Verified' : (isManuallyChecked ? 'Marked complete' : (docItem.is_mandatory ? 'Missing - Mandatory' : 'Pending'))}
                                 </p>
                              </div>
                            </li>
                          )
                       })}

                       <li className="flex items-start gap-2">
                         <div className="mt-0.5">{revenue > 0 ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <div className="w-5 h-5 rounded border-2 border-slate-300" />}</div>
                         <div>
                            <p className={`text-sm font-medium ${revenue > 0 ? 'text-slate-500 line-through' : 'text-slate-700'}`}>Prepare Final Bid Amount</p>
                            <p className="text-xs text-slate-400">{revenue > 0 ? "Saved" : "Pending calculation"}</p>
                         </div>
                       </li>
                     </ul>

                     {/* Required Annexures List */}
                     {project.details?.required_annexures && project.details.required_annexures.length > 0 && (
                       <div className="mt-6 border-t border-slate-100 pt-4">
                         <h4 className="font-semibold text-slate-800 text-sm mb-3">Tender Required Annexures</h4>
                         <ul className="space-y-3">
                           {project.details.required_annexures.map((annex: any, idx: number) => (
                             <li key={idx} className="flex flex-col gap-1">
                               <div className="flex justify-between items-start">
                                 <p className="text-sm font-medium text-slate-700">{annex.annexure_name}</p>
                                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${annex.filling_complexity?.toLowerCase?.() === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                                  {annex.filling_complexity || 'Medium'}
                                 </span>
                               </div>
                               <p className="text-xs text-slate-500">{annex.purpose}</p>
                               <button 
                                 className="text-xs text-indigo-600 font-medium text-left hover:underline w-max"
                                 onClick={() => {
                                   setDocType(`Auto-Fill: ${annex.annexure_name}`);
                                   // We will just scroll to top smoothly
                                   window.scrollTo({ top: 0, behavior: 'smooth' });
                                 }}
                               >
                                 Generate Draft
                               </button>
                             </li>
                           ))}
                         </ul>
                       </div>
                     )}
                  </div>
               </div>

            </div>

            {/* Compliance Matrix */}
            {project?.details?.compliance_matrix && project.details.compliance_matrix.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-indigo-600" /> Compliance Matrix
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Key eligibility and technical requirements checked against your profile.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {project.details.compliance_matrix.map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-4 px-5 py-4">
                      <span className={`shrink-0 mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                        item.status === 'MET'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {item.status}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{item.requirement}</p>
                        {item.notes && <p className="text-xs text-slate-500 mt-0.5">{item.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strategy and Procedures */}
            {project.details?.application_roadmap && (
              <div className="flex flex-col gap-8 mt-8">
                <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm p-6 text-white h-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                     <Activity className="w-5 h-5 text-amber-400" />
                     Execution Strategy
                  </h3>
                  <div className="space-y-3">
                    {project.details.application_roadmap.winning_strategy_tips?.map((tip: string, i: number) => (
                      <div key={i} className="flex gap-3 text-sm text-slate-300">
                         <ChevronRight className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                         <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm p-6 h-full">
                   <h3 className="text-lg font-bold text-indigo-950 mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-indigo-600" />
                      Application Procedure & Road Map
                   </h3>
                   <div className="text-sm font-semibold text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded inline-block mb-4">
                     Portal: {project.details.application_roadmap.portal_source}
                   </div>
                   
                   <div className="space-y-4">
                     {project.details.application_roadmap.detailed_procedure_steps && project.details.application_roadmap.detailed_procedure_steps.length > 0 ? (
                       <div className="space-y-3">
                         {project.details.application_roadmap.detailed_procedure_steps.map((step: string, i: number) => (
                           <div key={i} className="flex gap-3 items-start">
                             <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
                             <p className="text-sm text-slate-700 leading-relaxed font-medium">{step}</p>
                           </div>
                         ))}
                       </div>
                     ) : (
                       <ul className="space-y-2">
                         {project.details.application_roadmap.next_immediate_steps?.map((step: string, i: number) => (
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
            )}
          </div>
        )}

        {/* Chatbot specific to this tender */}
        {activeTab === 'chat' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px] mt-8 mb-8">
               <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-indigo-700 to-blue-600 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold flex items-center gap-2">
                      <MessageSquare className="w-5 h-5" />
                      Project AI Assistant
                    </h3>
                    <span className="text-xs bg-white/20 px-2 py-1 rounded font-medium shadow-sm">TenderMaster Chat</span>
                  </div>
                  <button
                    onClick={() => {
                        if (messages.length > 0) {
                            setShowClearChatModal(true);
                        }
                    }}
                    className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1 bg-white/15 hover:bg-white/25 text-white"
                  >
                    <Trash2 className="w-3 h-3" /> Clear Chat
                  </button>
               </div>
               
               <div className="flex-1 p-4 overflow-y-auto bg-slate-50 flex flex-col gap-4">
                 {messages.length === 0 ? (
                   <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                      <MessageSquare className="w-12 h-12 mb-3 opacity-30 text-indigo-500" />
                      <p className="text-sm">Ask anything about this specific project.</p>
                      <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-sm">
                        <button onClick={() => setChatInput("What is the exact EMD amount and deadline?")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">EMD & Deadlines?</button>
                        <button onClick={() => setChatInput("Summarize the specific technical eligibility criteria.")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">Technical Eligibility?</button>
                      </div>
                   </div>
                 ) : (
                   messages.map((msg, i) => (
                     <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'}`}>
                          <div className={msg.role === 'user' ? "prose prose-sm prose-invert max-w-none" : "prose prose-sm max-w-none prose-blue"}>
                             <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                          </div>
                       </div>
                     </div>
                   ))
                 )}
                 {chatLoading && (
                   <div className="flex justify-start">
                      <div className="bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-bl-sm p-4 text-sm shadow-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Analyzing project docs...
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
                      className="flex-1 border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none text-sm resize-none"
                      placeholder="Message AI about this project..."
                      rows={2}
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={!chatInput.trim() || chatLoading}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white w-11 h-11 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      <Send className="w-5 h-5 -ml-0.5" />
                    </button>
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h2 className="text-lg font-bold text-slate-800 mb-4">Analysis Notes</h2>
              {!project?.remarks ? (
                <div className="text-slate-500 text-sm py-8 text-center">
                  No analysis notes available for this project.
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-slate-800">{project.remarks.totalFilesProvided}</div>
                      <div className="text-xs text-slate-500 mt-1">Files Provided</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-indigo-700">{project.remarks.filesAnalyzed}</div>
                      <div className="text-xs text-slate-500 mt-1">Files Analyzed</div>
                    </div>
                    <div className={`rounded-lg p-4 text-center ${project.remarks.filesSkipped?.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                      <div className={`text-2xl font-bold ${project.remarks.filesSkipped?.length > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{project.remarks.filesSkipped?.length ?? 0}</div>
                      <div className="text-xs text-slate-500 mt-1">Files Skipped</div>
                    </div>
                  </div>

                  {project.remarks.filesSkipped?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-2">Skipped Files</h3>
                      <ul className="space-y-1">
                        {project.remarks.filesSkipped.map((s: any, idx: number) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                            <span className="font-medium shrink-0">File {s.index + 1}:</span>
                            <span>{s.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {project.remarks.notes?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-2">Notes</h3>
                      <ul className="space-y-1">
                        {project.remarks.notes.map((note: string, idx: number) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                            <span className="text-indigo-400 mt-0.5">•</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {project.remarks.filesSkipped?.length === 0 && project.remarks.notes?.length === 0 && (
                    <p className="text-sm text-slate-500">All files were analyzed successfully with no issues detected.</p>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {showCompareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
             <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h2 className="text-lg font-bold text-slate-800">Tender Comparison Engine</h2>
                <button onClick={() => setShowCompareModal(false)} className="p-1 hover:bg-slate-200 rounded text-slate-500">
                  <X className="w-5 h-5"/>
                </button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-6">
                {comparing ? (
                  <div className="flex flex-col justify-center items-center h-64 text-indigo-600">
                     <Loader2 className="w-12 h-12 animate-spin mb-4" />
                     <p className="text-lg font-semibold animate-pulse">Running semantic comparison against original project baseline...</p>
                     <p className="text-sm text-slate-500 mt-2">Checking clauses, EMD, eligibility, and dates...</p>
                  </div>
                ) : comparisonResult ? (
                  <div className="space-y-6">
                     <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                        <h3 className="font-bold text-indigo-900 mb-2">Critical Changes Summary</h3>
                        <p className="text-sm text-indigo-800 leading-relaxed">{comparisonResult.critical_changes_summary}</p>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                           <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"/> Added Clauses</h4>
                           <ul className="space-y-2 text-sm text-slate-600">
                             {comparisonResult.added_clauses?.map((c: string, j: number) => <li key={j} className="p-2 bg-emerald-50 border-l-2 border-emerald-500 rounded">{c}</li>)}
                             {!comparisonResult.added_clauses?.length && <li className="text-slate-400 italic">No clauses added.</li>}
                           </ul>
                        </div>
                        <div>
                           <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-500"/> Removed Clauses</h4>
                           <ul className="space-y-2 text-sm text-slate-600">
                             {comparisonResult.removed_clauses?.map((c: string, j: number) => <li key={j} className="p-2 bg-rose-50 border-l-2 border-rose-500 rounded">{c}</li>)}
                             {!comparisonResult.removed_clauses?.length && <li className="text-slate-400 italic">No clauses removed.</li>}
                           </ul>
                        </div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
                           <p className="text-xs font-bold uppercase text-amber-700 tracking-wider mb-1">Changed Dates</p>
                           {comparisonResult.changed_dates?.map((d: string, j: number) => <p key={j} className="text-sm font-medium text-amber-900">{d}</p>)}
                           {!comparisonResult.changed_dates?.length && <p className="text-sm text-amber-600/50">unchanged</p>}
                        </div>
                        <div className="p-4 border border-indigo-200 bg-indigo-50 rounded-xl">
                           <p className="text-xs font-bold uppercase text-indigo-700 tracking-wider mb-1">Changed Eligibility</p>
                           {comparisonResult.changed_eligibility?.map((d: string, j: number) => <p key={j} className="text-sm font-medium text-indigo-900">{d}</p>)}
                           {!comparisonResult.changed_eligibility?.length && <p className="text-sm text-indigo-600/50">unchanged</p>}
                        </div>
                        <div className="p-4 border border-emerald-200 bg-emerald-50 rounded-xl">
                           <p className="text-xs font-bold uppercase text-emerald-700 tracking-wider mb-1">Changed EMD</p>
                           <p className="text-sm font-medium text-emerald-900">{comparisonResult.changed_emd || "unchanged"}</p>
                        </div>
                     </div>

                     <div className="border-t border-slate-200 pt-6 mt-6">
                        <h4 className="font-bold text-slate-800 mb-2">New Strategic Recommendation</h4>
                        <div className="prose prose-sm prose-blue max-w-none">
                           <Markdown remarkPlugins={[remarkGfm]}>{comparisonResult.new_recommendations}</Markdown>
                        </div>
                     </div>
                  </div>
                ) : (
                  <div className="flex justify-center items-center h-64 text-slate-500">
                     No comparison data found.
                  </div>
                )}
             </div>
             
             <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button onClick={() => setShowCompareModal(false)} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
             </div>
          </div>
        </div>
      )}

      {/* Re-Analyze Modal */}
      {showReanalyzeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Re-Analyze Project?</h3>
            <p className="text-slate-600 mb-6">
              Are you sure you want to re-analyze this project? This will re-evaluate the tender and run fresh risk calculations. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowReanalyzeModal(false)}
                className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleManualReanalyze}
                className="px-4 py-2 font-medium bg-gradient-to-br from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700 rounded-lg transition-colors shadow-sm"
              >
                Confirm Re-Analyze
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Delete Project?</h3>
            <p className="text-slate-600 mb-6">
              Are you sure you want to remove this project? All associated data, documents, and chat history will be permanently deleted.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleRemoveProject}
                className="px-4 py-2 font-medium bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Chat Modal */}
      {showClearChatModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Clear Chat History?</h3>
            <p className="text-slate-600 mb-6">
              Are you sure you want to clear this project's chat history? You will lose all your previous AI assistant interactions.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowClearChatModal(false)}
                className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleClearChat}
                className="px-4 py-2 font-medium bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Clear Chat
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </>
  );
}
