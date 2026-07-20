import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs, orderBy, writeBatch, serverTimestamp, arrayUnion, Timestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import { removeUndefined } from "../lib/firestore";
import { ArrowLeft, AlertCircle, Calculator, Building, Activity, Upload, FileText, Download, Loader2, Save, Plus, Target, CheckCircle, CheckCircle2, ListTodo, Calendar, MessageSquare, Send, X, Trash2, RefreshCw, Edit2, Check, ChevronRight, Info, IndianRupee, Wallet, Receipt, CreditCard, RotateCcw, BadgeCheck, Clock, Copy, ArrowUpRight, Scan } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import JSZip from "jszip";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { fetchWithAuth } from "../lib/api";
import { extractPdfText, textToBase64, arrayBufferToBase64 } from "../lib/pdfToImage";
import { useModeBFlow } from "../lib/modeb/useModeBFlow";
import ModeBReviewPanel from "../components/modeb/ModeBReviewPanel";
import { isTemplated, fillTemplate, saveCandidateTemplate } from "../lib/docTemplates";
import BOQSection from "../components/boq/BOQSection";
import BOQViewer from "../components/boq/BOQViewer";
import type { BOQData, BidSnapshotRow } from "../lib/boq/types";
import { INITIAL_BOQ } from "../lib/boq/types";

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
  if (/RESOURCE_EXHAUSTED|credits|analyses|quota/i.test(raw))
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

const LETTER_SENTINEL = '%%LETTER_DRAFT%%';

type PaymentType =
  | 'EMD' | 'Security Deposit' | 'Performance Security' | 'Retention Money'
  | 'Tender Fee' | 'Document Fee' | 'Processing Fee' | 'e-Portal Fee' | 'Stamp Duty' | 'Notary/DSC' | 'Other';
type PaymentMode = 'DD' | 'Bank Guarantee' | 'Online' | 'Cash';
type RefundStatus = 'Paid' | 'Pending Refund' | 'Refunded';

const REFUNDABLE_TYPES: PaymentType[] = ['EMD', 'Security Deposit', 'Performance Security', 'Retention Money'];

function isRefundableByDefault(type: PaymentType): boolean {
  return REFUNDABLE_TYPES.includes(type);
}

interface TenderPayment {
  id: string;
  userId: string;
  projectId: string;
  type: PaymentType;
  amount: number;
  datePaid: string;
  paymentMode: PaymentMode;
  referenceNumber: string;
  notes: string;
  receiptUrl?: string;
  refundable: boolean;
  refundStatus?: RefundStatus;
  refundDate?: string;
  expectedRefundDate?: string;
  createdAt: any;
}

interface PaymentFormState {
  type: PaymentType;
  amount: string;
  datePaid: string;
  paymentMode: PaymentMode;
  referenceNumber: string;
  notes: string;
  receiptUrl: string;
  refundable: boolean;
  expectedRefundDate: string;
}

const defaultPaymentForm: PaymentFormState = {
  type: 'EMD',
  amount: '',
  datePaid: new Date().toISOString().split('T')[0],
  paymentMode: 'Online',
  referenceNumber: '',
  notes: '',
  receiptUrl: '',
  refundable: true,
  expectedRefundDate: '',
};

interface SavedDoc {
  id: string;
  title: string;
  mode: "standard" | "exact_form" | "exact_form_overlay";
  content: string;
  isHtml: boolean;
  filledPdfUrl?: string;
  savedAt: any;
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
  const [docType, setDocType] = useState("Cover Letter");
  const [useLetterhead, setUseLetterhead] = useState(false);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [exactFormMode, setExactFormMode] = useState(false);
  const [exactFormFile, setExactFormFile] = useState<File | null>(null);
  const [formUploading, setFormUploading] = useState(false);
  const [generatedDocIsHtml, setGeneratedDocIsHtml] = useState(false);
  const [generatedFromTemplate, setGeneratedFromTemplate] = useState(false);
  const [boq, setBoqState] = useState<BOQData>({ ...INITIAL_BOQ });
  const [boqChangedSinceDocGen, setBoqChangedSinceDocGen] = useState(false);
  const [snapshots, setSnapshots] = useState<BidSnapshotRow[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [printWithoutLetterhead, setPrintWithoutLetterhead] = useState(false);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [savedDocsLoading, setSavedDocsLoading] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docSaved, setDocSaved] = useState(false);
  const [savedDocDownloadingId, setSavedDocDownloadingId] = useState<string | null>(null);
  const [savedDocDownloadingType, setSavedDocDownloadingType] = useState<'pdf' | 'docx' | null>(null);

  // Mode B Vision fill — onSave handler + state machine hook
  const handleModeBSave = async (blob: Blob, filename: string) => {
    if (!user || !projectId) return;
    const path = `users/${user.uid}/filled-forms/${Date.now()}-${filename}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, new Uint8Array(await blob.arrayBuffer()));
    const filledPdfUrl = await getDownloadURL(fileRef);
    const colRef = collection(db, 'saved_tenders', projectId, 'generated_docs');
    const docRef = await addDoc(colRef, {
      title: filename,
      mode: 'exact_form_overlay',
      content: '',
      isHtml: false,
      filledPdfUrl,
      savedAt: serverTimestamp(),
    });
    setSavedDocs(prev => [{ id: docRef.id, title: filename, mode: 'exact_form_overlay', content: '', isHtml: false, filledPdfUrl, savedAt: Timestamp.now() }, ...prev]);
  };

  const modeb = useModeBFlow({
    businessProfile,
    directors: businessProfile?.directors ?? [],
    tenderData: project?.details,
    onSave: handleModeBSave,
  });

  // Checked items for action center
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  // Uploaded docs
  const [uploadedFiles, setUploadedFiles] = useState<{name: string, size: string, type: string, bytes?: number}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boqSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chatbot state
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string, createdAt?: Date}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  
  // Comparison State
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [showCompareModal, setShowCompareModal] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'overview'|'docs'|'calculator'|'account'|'chat'|'saved_docs'|'notes'|'boq'>('overview');

  // Account tab — payments
  const [payments, setPayments] = useState<TenderPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [editingPayment, setEditingPayment] = useState<TenderPayment | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(defaultPaymentForm);
  const [savingPayment, setSavingPayment] = useState(false);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [extractingReceipt, setExtractingReceipt] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  
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

          if (data.boq) setBoqState(data.boq);
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

  useEffect(() => {
    if (!projectId || !user) return;
    const loadPayments = async () => {
      setPaymentsLoading(true);
      try {
        const q = query(collection(db, "tender_payments"), where("userId", "==", user.uid), where("projectId", "==", projectId));
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as TenderPayment));
        docs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setPayments(docs);
      } catch (e) {
        console.error("Failed to load payments:", e);
      } finally {
        setPaymentsLoading(false);
      }
    };
    loadPayments();
  }, [projectId, user]);

  useEffect(() => {
    if (!projectId || !user) return;
    const loadSnapshots = async () => {
      setSnapshotsLoading(true);
      try {
        const q = query(
          collection(db, 'saved_tenders', projectId, 'bid_snapshots'),
          orderBy('version', 'desc'),
        );
        const snap = await getDocs(q);
        setSnapshots(snap.docs.map(d => ({ id: d.id, ...d.data() } as BidSnapshotRow)));
      } catch (e) {
        console.error('Failed to load bid snapshots:', e);
      } finally {
        setSnapshotsLoading(false);
      }
    };
    loadSnapshots();
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

  const handleBoqChange = (updated: BOQData) => {
    setBoqState(updated);
    if (generatedDoc) setBoqChangedSinceDocGen(true);
    if (!projectId) return;
    if (boqSaveTimerRef.current) clearTimeout(boqSaveTimerRef.current);
    boqSaveTimerRef.current = setTimeout(() => {
      updateDoc(doc(db, 'saved_tenders', projectId), { boq: removeUndefined(updated) }).catch(console.error);
    }, 1000);
  };

  const handleFinalize = async (
    data: Omit<BidSnapshotRow, 'id' | 'createdAt' | 'createdBy' | 'version'>,
  ) => {
    if (!projectId || !user) return;
    const colRef = collection(db, 'saved_tenders', projectId, 'bid_snapshots');
    const nextVersion = (snapshots[0]?.version ?? 0) + 1;
    const docRef = await addDoc(colRef, removeUndefined({
      ...data,
      version: nextVersion,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    }));
    const newSnap: BidSnapshotRow = {
      id: docRef.id,
      ...data,
      version: nextVersion,
      createdAt: new Date(),
      createdBy: user.uid,
    };
    setSnapshots(prev => [newSnap, ...prev]);
    await updateDoc(doc(db, 'saved_tenders', projectId), {
      'boq.finalisedAt': serverTimestamp(),
    });
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
          language: i18n.language,
          projectId: projectId,
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
            language: i18n.language,
            projectId: projectId,
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
                   const shortName = filename.split('/').pop() || filename;
                   const arrayBuffer = await zipEntry.async("arraybuffer");
                   let dataUri: string;
                   try {
                     const extraction = await extractPdfText(arrayBuffer);
                     if (extraction.isDigital) {
                       console.log(`[PDF extraction] ${shortName} (ZIP) → TEXT (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
                       dataUri = `data:text/plain;base64,${textToBase64(extraction.text)}`;
                     } else {
                       console.log(`[PDF extraction] ${shortName} (ZIP) → IMAGE fallback (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
                       dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
                     }
                   } catch {
                     console.warn(`[PDF extraction] ${shortName} (ZIP) → IMAGE fallback (extraction error)`);
                     dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
                   }
                   pdfBase64Array.push(dataUri);
                   zipEntryNames.push(shortName);
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
             const arrayBuffer = await file.arrayBuffer();
             try {
               const extraction = await extractPdfText(arrayBuffer);
               if (extraction.isDigital) {
                 console.log(`[PDF extraction] ${file.name} → TEXT (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
                 contentToSend = `data:text/plain;base64,${textToBase64(extraction.text)}`;
               } else {
                 console.log(`[PDF extraction] ${file.name} → IMAGE fallback (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
                 contentToSend = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
               }
             } catch {
               console.warn(`[PDF extraction] ${file.name} → IMAGE fallback (extraction error)`);
               contentToSend = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
             }
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
               language: i18n.language,
               projectId: projectId,
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

  const loadSavedDocs = async () => {
    if (!projectId) return;
    setSavedDocsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "saved_tenders", projectId, "generated_docs"), orderBy("savedAt", "desc"))
      );
      setSavedDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedDoc)));
    } catch (e) {
      console.error("Failed to load saved docs", e);
    } finally {
      setSavedDocsLoading(false);
    }
  };

  useEffect(() => { loadSavedDocs(); }, [projectId]);

  const saveDocument = async () => {
    if (!projectId || !generatedDoc || generatedDoc === "Generating...") return;
    setSavingDoc(true);
    try {
      await addDoc(collection(db, "saved_tenders", projectId, "generated_docs"), {
        title: exactFormMode ? "Exact Form Fill" : docType,
        mode: exactFormMode ? "exact_form" : "standard",
        content: generatedDoc,
        isHtml: generatedDocIsHtml,
        savedAt: serverTimestamp(),
      });
      setDocSaved(true);
      toast.success("Document saved to project.");
      await loadSavedDocs();
    } catch (e: any) {
      toast.error("Failed to save document.");
    } finally {
      setSavingDoc(false);
    }
  };

  const deleteSavedDoc = async (docId: string) => {
    if (!projectId) return;
    try {
      const { deleteDoc: del, doc: docRef } = await import("firebase/firestore");
      await del(docRef(db, "saved_tenders", projectId, "generated_docs", docId));
      setSavedDocs(prev => prev.filter(d => d.id !== docId));
      toast.success("Saved document deleted.");
    } catch (e) {
      toast.error("Failed to delete.");
    }
  };

  const downloadSavedDocPdf = async (sd: SavedDoc) => {
    setSavedDocDownloadingId(sd.id);
    setSavedDocDownloadingType('pdf');
    try {
      // Vision-filled PDFs are already stored in Storage — fetch directly
      if (sd.mode === 'exact_form_overlay' && sd.filledPdfUrl) {
        const resp = await fetch(sd.filledPdfUrl);
        if (!resp.ok) throw new Error('Download failed');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sd.title.replace(/\s+/g, '_') + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      const res = await fetchWithAuth("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: sd.content,
          filename: sd.title,
          isMarkdown: !sd.isHtml,
          useUserLetterhead: sd.mode !== 'exact_form' && useLetterhead,
          letterheadImageBase64: (sd.mode !== 'exact_form' && useLetterhead) ? (businessProfile?.letterheadBackgroundImage ?? "") : "",
          letterheadHeaderHtml: (sd.mode !== 'exact_form' && useLetterhead) ? (businessProfile?.letterheadHeader ?? "") : "",
          letterheadFooterHtml: (sd.mode !== 'exact_form' && useLetterhead) ? (businessProfile?.letterheadFooter ?? "") : "",
        }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = sd.title.replace(/\s+/g, "_") + ".pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("PDF generation failed: " + e.message);
    } finally {
      setSavedDocDownloadingId(null);
      setSavedDocDownloadingType(null);
    }
  };

  const downloadSavedDocDocx = async (sd: SavedDoc) => {
    setSavedDocDownloadingId(sd.id);
    setSavedDocDownloadingType('docx');
    try {
      const res = await fetchWithAuth("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: sd.content, filename: sd.title, isMarkdown: !sd.isHtml }),
      });
      if (!res.ok) throw new Error("Word generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = sd.title.replace(/\s+/g, "_") + ".docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Word generation failed: " + e.message);
    } finally {
      setSavedDocDownloadingId(null);
      setSavedDocDownloadingType(null);
    }
  };

  const generateDocument = async () => {
    if (!project) return;
    if (exactFormMode && !exactFormFile) {
      toast.error("Please upload the blank form you want filled.");
      return;
    }
    setDocSaved(false);
    setGeneratingDoc(true);
    setGeneratedDoc("Generating...");
    setGeneratedDocIsHtml(false);
    setIsEditingDoc(false);
    setGeneratedFromTemplate(false);

    // ── Template path: instant generation, no API call ────────────────────────
    if (!exactFormMode && isTemplated(docType, project.details?.tender_simplified?.authority_name)) {
      const md = fillTemplate(docType, businessProfile, project.details, project.details?.tender_simplified?.authority_name, boq);
      if (md) {
        setGeneratedDoc(md);
        setGeneratedDocIsHtml(false);
        setGeneratedFromTemplate(true);
        setBoqChangedSinceDocGen(false);
        setGeneratingDoc(false);
        return;
      }
    }

    try {
      let exactFormUrl: string | undefined;
      let exactFormMimeType: string | undefined;
      if (exactFormMode && exactFormFile) {
        setFormUploading(true);
        const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
        const { storage } = await import("../lib/firebase");
        const storageRef = ref(storage, `users/${user?.uid}/form-uploads/${Date.now()}-${exactFormFile.name}`);
        await uploadBytes(storageRef, exactFormFile);
        exactFormUrl = await getDownloadURL(storageRef);
        exactFormMimeType = exactFormFile.type || "application/pdf";
        setFormUploading(false);
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
            ...(exactFormUrl ? { exactFormUrl, exactFormMimeType } : {}),
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
      if (data.format === "html") {
        setGeneratedDocIsHtml(true);
        setGeneratedDoc(data.document);
      } else {
        setGeneratedDocIsHtml(false);
        setGeneratedDoc(sanitizeDocOutput(data.document));
      }
      setBoqChangedSinceDocGen(false);
      // Save as candidate template for admin review (fire-and-forget)
      if (!exactFormMode) {
        saveCandidateTemplate(
          docType,
          data.document,
          project.details?.tender_simplified?.authority_name ?? null,
        );
      }
    } catch (e: any) {
      toast.error("Failed to generate: " + e.message);
    } finally {
      setGeneratingDoc(false);
      setFormUploading(false);
    }
  };

  const downloadPdf = async () => {
    if (!generatedDoc) return;
    setDownloadingPdf(true);
    try {
      const res = await fetchWithAuth("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: generatedDoc,
          filename: docType,
          isMarkdown: !generatedDocIsHtml,
          useUserLetterhead: exactFormMode ? false : useLetterhead,
          letterheadImageBase64: (!exactFormMode && useLetterhead) ? (businessProfile?.letterheadBackgroundImage ?? "") : "",
          letterheadHeaderHtml: (!exactFormMode && useLetterhead) ? (businessProfile?.letterheadHeader ?? "") : "",
          letterheadFooterHtml: (!exactFormMode && useLetterhead) ? (businessProfile?.letterheadFooter ?? "") : "",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generation failed" }));
        throw new Error(err.error || "PDF generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docType.replace(/\s+/g, "_") + ".pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("PDF generation failed: " + e.message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const downloadDocx = async () => {
    if (!generatedDoc) return;
    setDownloadingDocx(true);
    try {
      const res = await fetchWithAuth("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: generatedDoc,
          filename: docType,
          isMarkdown: !generatedDocIsHtml,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Word generation failed" }));
        throw new Error(err.error || "Word generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docType.replace(/\s+/g, "_") + ".docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Word generation failed: " + e.message);
    } finally {
      setDownloadingDocx(false);
    }
  };

  const openAddPayment = () => {
    setEditingPayment(null);
    setPaymentForm(defaultPaymentForm);
    setShowAddPayment(true);
  };

  const openEditPayment = (p: TenderPayment) => {
    setEditingPayment(p);
    setPaymentForm({
      type: p.type,
      amount: String(p.amount),
      datePaid: p.datePaid,
      paymentMode: p.paymentMode,
      referenceNumber: p.referenceNumber,
      notes: p.notes,
      receiptUrl: p.receiptUrl || '',
      refundable: p.refundable ?? isRefundableByDefault(p.type),
      expectedRefundDate: p.expectedRefundDate || '',
    });
    setShowAddPayment(true);
  };

  const handleSavePayment = async () => {
    if (!projectId || !user) return;
    const amt = Number(paymentForm.amount);
    if (!paymentForm.amount || isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!paymentForm.datePaid) { toast.error("Enter the payment date"); return; }
    setSavingPayment(true);
    try {
      const data: any = {
        userId: user.uid,
        projectId,
        type: paymentForm.type,
        amount: amt,
        datePaid: paymentForm.datePaid,
        paymentMode: paymentForm.paymentMode,
        referenceNumber: paymentForm.referenceNumber.trim(),
        notes: paymentForm.notes.trim(),
        receiptUrl: paymentForm.receiptUrl,
        refundable: paymentForm.refundable,
        expectedRefundDate: paymentForm.expectedRefundDate,
      };
      if (paymentForm.refundable) {
        const prevStatus = editingPayment?.refundStatus ?? (editingPayment as any)?.emdStatus;
        data.refundStatus = prevStatus ?? 'Paid';
        data.refundDate = editingPayment?.refundDate ?? '';
      }
      if (editingPayment) {
        await updateDoc(doc(db, "tender_payments", editingPayment.id), data);
        setPayments(prev => prev.map(p => p.id === editingPayment.id ? { ...p, ...data } : p));
        toast.success("Payment updated");
      } else {
        data.createdAt = serverTimestamp();
        const ref = await addDoc(collection(db, "tender_payments"), data);
        setPayments(prev => [{ id: ref.id, ...data } as TenderPayment, ...prev]);
        toast.success("Payment added");
      }
      setShowAddPayment(false);
      setEditingPayment(null);
      setPaymentForm(defaultPaymentForm);
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDeletePayment = async (id: string) => {
    setDeletingPaymentId(id);
    try {
      await deleteDoc(doc(db, "tender_payments", id));
      setPayments(prev => prev.filter(p => p.id !== id));
      toast.success("Payment deleted");
    } catch (e: any) {
      toast.error("Failed to delete: " + e.message);
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const handleRefundStatusChange = async (payment: TenderPayment, newStatus: RefundStatus) => {
    try {
      const update: any = { refundStatus: newStatus };
      if (newStatus === 'Refunded') update.refundDate = new Date().toISOString().split('T')[0];
      else update.refundDate = '';
      await updateDoc(doc(db, "tender_payments", payment.id), update);
      setPayments(prev => prev.map(p => p.id === payment.id ? { ...p, ...update } : p));
      toast.success(`Marked as ${newStatus}`);
    } catch (e: any) {
      toast.error("Failed to update refund status");
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = '';

    setReceiptUploading(true);
    let downloadUrl = '';
    try {
      const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
      const { storage } = await import("../lib/firebase");
      const storageRef = ref(storage, `users/${user.uid}/receipts/${Date.now()}-${file.name}`);
      await uploadBytes(storageRef, file);
      downloadUrl = await getDownloadURL(storageRef);
      setPaymentForm(prev => ({ ...prev, receiptUrl: downloadUrl }));
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
      setReceiptUploading(false);
      return;
    }
    setReceiptUploading(false);

    setExtractingReceipt(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetchWithAuth("/api/extract-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptBase64: base64, mimeType: file.type || 'application/pdf' }),
      });
      if (res.ok) {
        const data = await res.json();
        setPaymentForm(prev => ({
          ...prev,
          amount: data.amount ? String(data.amount) : prev.amount,
          datePaid: data.datePaid || prev.datePaid,
          referenceNumber: data.referenceNumber || prev.referenceNumber,
          paymentMode: (data.paymentMode as PaymentMode) || prev.paymentMode,
        }));
        toast.success("Receipt scanned — please verify the pre-filled values");
      }
    } catch {
      // extraction failure is non-fatal
    } finally {
      setExtractingReceipt(false);
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
          language: i18n.language,
          paymentRecords: payments.length > 0 ? payments.map(p => ({
            type: p.type, amount: p.amount, datePaid: p.datePaid,
            paymentMode: p.paymentMode, referenceNumber: p.referenceNumber,
            notes: p.notes, refundable: p.refundable, refundStatus: p.refundStatus,
            expectedRefundDate: p.expectedRefundDate,
          })) : undefined,
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
         <button onClick={() => setActiveTab('account')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'account' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Payments</button>
         <button onClick={() => setActiveTab('chat')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'chat' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Chat AI</button>
         <button onClick={() => setActiveTab('saved_docs')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${activeTab === 'saved_docs' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
           Saved Documents
           {savedDocs.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{savedDocs.length}</span>}
         </button>
         <button onClick={() => setActiveTab('notes')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'notes' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Analysis Notes</button>
         <button onClick={() => setActiveTab('boq')} className={`px-6 py-3 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'boq' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>BOQ</button>
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

           {boqChangedSinceDocGen && boq.quotedAmount != null && (
             <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
               <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
               BOQ has been updated since this document was generated. Regenerate to include the latest bid figures.
             </div>
           )}

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
                    onClick={() => { setExactFormMode(false); setExactFormFile(null); setGeneratedDoc(""); setGeneratedDocIsHtml(false); setIsEditingDoc(false); }}
                    className={`flex-1 py-2 transition-colors ${!exactFormMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}
                  >
                    Generate from tender data
                  </button>
                  <button
                    onClick={() => { setExactFormMode(true); setGeneratedDoc(""); setGeneratedDocIsHtml(false); setIsEditingDoc(false); }}
                    className={`flex-1 py-2 transition-colors ${exactFormMode ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}
                  >
                    Fill My Exact Tender Form
                  </button>
                </div>

                {!exactFormMode ? (
                <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                <select
                  value={docType}
                  onChange={e => setDocType(e.target.value)}
                  className="flex-1 bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
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
                {isTemplated(docType, project.details?.tender_simplified?.authority_name) && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold whitespace-nowrap shrink-0">
                    ⚡ Instant
                  </span>
                )}
                </div>
                </div>
                ) : (
                <div>
                  <p className="text-xs text-indigo-700/80 mb-2">Upload the exact blank form or annexure issued by the tender authority (PDF). Vision AI detects every field and fills your business details — you review and confirm before the PDF is generated.</p>
                  {!modeb.formFile ? (
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-indigo-300 rounded-lg cursor-pointer bg-white hover:bg-indigo-50 transition-colors">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Upload className="w-5 h-5 text-indigo-400" />
                        <span className="text-xs text-indigo-600 font-medium">Click to upload blank form</span>
                        <span className="text-[10px] text-slate-400">PDF • max 20 MB</span>
                      </div>
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          if (f && f.size > LARGE_FILE_BYTES) {
                            toast.error("File is over 20 MB — please use a smaller file or a single page.");
                            return;
                          }
                          modeb.selectFile(f);
                        }}
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 bg-white border border-indigo-200 rounded-lg px-3 py-2.5">
                      <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="text-xs text-indigo-900 font-medium truncate flex-1">{modeb.formFile.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{formatFileSize(modeb.formFile.size)}</span>
                      <button onClick={() => modeb.selectFile(null)} className="text-slate-400 hover:text-red-500 shrink-0 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                )}

                {!exactFormMode && (
                <input
                  type="text"
                  placeholder="Optional: Enter specific details or instructions for this document..."
                  value={extraInstructions}
                  onChange={(e) => setExtraInstructions(e.target.value)}
                  className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                />
                )}
                <button
                  onClick={exactFormMode ? () => modeb.startFlow(user!.uid) : generateDocument}
                  disabled={exactFormMode
                    ? (!modeb.formFile || modeb.stage === 'uploading' || modeb.stage === 'probing')
                    : (generatingDoc || formUploading)
                  }
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center flex items-center justify-center gap-2 transition-colors"
                >
                  {exactFormMode ? (
                    modeb.stage === 'uploading' ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading form…</> :
                    modeb.stage === 'probing'   ? <><Loader2 className="w-4 h-4 animate-spin" /> Detecting fields…</> :
                    modeb.stage === 'done'      ? <><CheckCircle2 className="w-4 h-4" /> Done — fill another?</> :
                                                  <><Scan className="w-4 h-4" /> Start Vision Fill</>
                  ) : (
                    <>
                      {(generatingDoc || formUploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                      {formUploading ? "Uploading form…" : generatingDoc ? "Drafting..." : "Generate Draft"}
                    </>
                  )}
                </button>
                {exactFormMode && modeb.error && (
                  <p className="text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {modeb.error}
                  </p>
                )}
                {exactFormMode && modeb.stage === 'done' && (
                  <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">PDF filled and saved</p>
                      <p className="text-xs text-emerald-600 mt-0.5">Download started automatically. The filled form has been saved to your Saved Documents.</p>
                    </div>
                  </div>
                )}

                {generatedDoc && (
                   <div className="mt-6">
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-900 uppercase">Generated Output</span>
                          {generatedFromTemplate && (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">⚡ Instant — from template</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                           {!exactFormMode && (
                             <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                               <input type="checkbox" checked={useLetterhead} onChange={(e) => setUseLetterhead(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                               Use Letterhead
                             </label>
                           )}
                           {exactFormMode && (
                             <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                               <input type="checkbox" checked={printWithoutLetterhead} onChange={(e) => setPrintWithoutLetterhead(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                               Print without letterhead
                             </label>
                           )}
                           {generatedDocIsHtml ? (
                             <button onClick={() => {
                               if (isEditingDoc) { toast("Click 'Preview' to apply your edits before printing.", { icon: "✏️" }); return; }
                               const pw = window.open('', '', 'width=900,height=1100');
                               if (!pw) return;
                               const htmlToPrint = (exactFormMode && printWithoutLetterhead)
                                 ? generatedDoc.replace('<body>', '<body class="no-letterhead">')
                                 : generatedDoc;
                               pw.document.write(htmlToPrint);
                               pw.document.close();
                               pw.focus();
                               setTimeout(() => { pw.print(); pw.close(); }, 500);
                             }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium">
                               <FileText className="w-3 h-3" /> Print
                             </button>
                           ) : (
                             <button onClick={() => {
                               if (isEditingDoc) { toast("Click 'Preview' to apply your edits before printing.", { icon: "✏️" }); return; }
                               const printWindow = window.open('', '', 'width=800,height=900');
                               if (!printWindow) return;
                               const content = document.getElementById('generated-doc-content')?.innerHTML || '';
                               let headerHtml = ''; let footerHtml = ''; let bgImageHtml = '';
                               let pageMargin = '20mm'; let bodyPadding = '0';
                               if (useLetterhead && businessProfile) {
                                 if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = `<img src="${businessProfile.letterheadBackgroundImage}" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;object-fit:cover;" />`;
                                   pageMargin = '0'; bodyPadding = '0 20mm';
                                   headerHtml = `<div style="height:45mm;width:100%;"></div>`;
                                   footerHtml = `<div style="height:45mm;width:100%;"></div>`;
                                 } else {
                                   headerHtml = businessProfile.letterheadHeader || `<div style="text-align:center;padding-bottom:5mm;border-bottom:2px solid #000;margin-bottom:5mm;"><h2>${businessProfile.companyName || 'Company Name'}</h2><p>${businessProfile.contactDetails || ''}</p></div>`;
                                   footerHtml = businessProfile.letterheadFooter || `<div style="text-align:center;padding-top:5mm;border-top:1px solid #000;margin-top:5mm;font-size:12px;"><p>${businessProfile.website || ''}</p></div>`;
                                 }
                               }
                               printWindow.document.write(`<html><head><title>Print - ${docType}</title><style>@page{size:A4;margin:${pageMargin}}body{font-family:system-ui,sans-serif;color:#111827;margin:0;padding:${bodyPadding};box-sizing:border-box}.content{font-size:11pt;line-height:1.6}table.layout-table{width:100%;border-collapse:collapse;border:none;margin:0;padding:0;table-layout:fixed}table.layout-table>thead{display:table-header-group}table.layout-table>tfoot{display:table-footer-group}table.layout-table td{border:none;padding:0}table:not(.layout-table){width:100%;border-collapse:collapse;margin:10px 0 20px;page-break-inside:auto}table:not(.layout-table) tr{page-break-inside:avoid}table:not(.layout-table) th,table:not(.layout-table) td{border:1px solid #d1d5db;padding:8px 12px;text-align:left;overflow-wrap:break-word}table:not(.layout-table) th{background:#f3f4f6}h1,h2,h3,h4,h5{margin-top:15px;margin-bottom:10px;page-break-after:avoid}p{margin-bottom:10px}ul,ol{margin-bottom:10px;padding-left:20px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${bgImageHtml}<table class="layout-table"><thead><tr><td>${headerHtml}</td></tr></thead><tbody><tr><td><div class="content">${content}</div></td></tr></tbody><tfoot><tr><td>${footerHtml}</td></tr></tfoot></table></body></html>`);
                               printWindow.document.close();
                               printWindow.focus();
                               setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
                             }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium">
                               <FileText className="w-3 h-3" /> Print
                             </button>
                           )}
                           {!exactFormMode && (
                             <button onClick={downloadPdf} disabled={downloadingPdf}
                               className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium transition-colors disabled:opacity-50">
                               {downloadingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                               {downloadingPdf ? "Generating…" : "PDF"}
                             </button>
                           )}
                           <button onClick={downloadDocx} disabled={downloadingDocx}
                             className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium transition-colors disabled:opacity-50">
                             {downloadingDocx ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                             {downloadingDocx ? "Generating…" : "Word"}
                           </button>
                           <button onClick={() => {
                               const blob = new Blob([generatedDoc], {type: "text/plain"});
                               const url = URL.createObjectURL(blob);
                               const a = document.createElement("a");
                               a.href = url;
                               a.download = docType.replace(/\s+/g, "_") + ".txt";
                               a.click();
                             }} className="text-xs flex items-center gap-1 text-slate-500 hover:text-slate-700 font-medium transition-colors">
                               <Download className="w-3 h-3" /> .txt
                             </button>
                           <button onClick={() => { navigator.clipboard.writeText(generatedDoc); toast.success("Copied to clipboard!"); }}
                               className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                               <FileText className="w-3 h-3" /> Copy
                             </button>
                           <button onClick={() => setIsEditingDoc(!isEditingDoc)} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                             <Edit2 className="w-3 h-3" /> {isEditingDoc ? "Preview" : generatedDocIsHtml ? "Edit HTML" : "Edit"}
                           </button>
                           <button
                             onClick={saveDocument}
                             disabled={savingDoc || docSaved}
                             className={`text-xs flex items-center gap-1 font-medium transition-colors disabled:opacity-50 ${docSaved ? 'text-emerald-600' : 'text-emerald-700 hover:text-emerald-900'}`}
                           >
                             {savingDoc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                             {docSaved ? "Saved" : "Save Generated Document"}
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
                      {generatedDocIsHtml ? (
                        isEditingDoc ? (
                          <textarea
                            value={generatedDoc}
                            onChange={(e) => setGeneratedDoc(e.target.value)}
                            className="w-full bg-slate-950 text-green-300 p-3 rounded-lg border border-indigo-200 font-mono text-xs resize-none focus:ring-2 focus:ring-indigo-300"
                            style={{ height: '520px' }}
                          />
                        ) : (
                          <iframe
                            sandbox=""
                            srcDoc={generatedDoc}
                            className="w-full rounded-lg border border-indigo-200 bg-white"
                            style={{ height: '520px' }}
                            title="Generated Document Preview"
                          />
                        )
                      ) : (
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
                      )}
                   </div>
                )}
             </div>
           </div>

        </div>
        )}

        {/* Right Column: Financial Calculation */}
        {activeTab === 'calculator' && (
        <div className="lg:col-span-2 space-y-8">

           <BOQSection
             analysisResult={project.details}
             boq={boq}
             setBoq={handleBoqChange}
             totalCost={totalExpense}
             onRevenueSync={(amount) => setRevenue(amount)}
             onFinalize={handleFinalize}
             snapshots={snapshots}
             snapshotsLoading={snapshotsLoading}
           />

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
                      <p className="text-sm">Ask anything about this project, or ask me to draft a letter.</p>
                      <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-md">
                        <button onClick={() => setChatInput("What is the exact EMD amount and deadline?")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">EMD & Deadlines?</button>
                        <button onClick={() => setChatInput("Summarize the specific technical eligibility criteria.")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">Technical Eligibility?</button>
                        <button onClick={() => setChatInput("Draft an EMD refund request letter to the department.")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">Draft EMD refund request</button>
                        <button onClick={() => setChatInput("Write a letter requesting an extension of the bid submission deadline.")} className="text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-100">Draft deadline extension letter</button>
                      </div>
                   </div>
                 ) : (
                   messages.map((msg, i) => {
                     const isLetter = msg.role === 'model' && msg.text.startsWith(LETTER_SENTINEL);
                     const displayText = isLetter ? msg.text.slice(LETTER_SENTINEL.length).trimStart() : msg.text;
                     return (
                       <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                         {isLetter && (
                           <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-t-lg rounded-br-lg mb-0.5 self-start">
                             <FileText className="w-3.5 h-3.5" /> Letter Draft
                           </div>
                         )}
                         <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'} ${isLetter ? 'rounded-tl-none' : ''}`}>
                           <div className={msg.role === 'user' ? "prose prose-sm prose-invert max-w-none" : "prose prose-sm max-w-none prose-blue"}>
                             <Markdown remarkPlugins={[remarkGfm]}>{displayText}</Markdown>
                           </div>
                         </div>
                         {isLetter && (
                           <div className="flex gap-2 mt-1.5">
                             <button
                               onClick={() => {
                                 navigator.clipboard.writeText(displayText).then(() => toast.success("Letter copied to clipboard"));
                               }}
                               className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                             >
                               <Copy className="w-3.5 h-3.5" /> Copy
                             </button>
                             <button
                               onClick={() => {
                                 setExactFormMode(false);
                                 setGeneratedDoc(displayText);
                                 setGeneratedDocIsHtml(false);
                                 setDocType("Letter (Chat Draft)");
                                 setIsEditingDoc(false);
                                 setActiveTab('docs');
                                 toast.success("Letter loaded in Doc Generator — print or download from the toolbar above.");
                               }}
                               className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                             >
                               <ArrowUpRight className="w-3.5 h-3.5" /> Open in Doc Generator
                             </button>
                           </div>
                         )}
                       </div>
                     );
                   })
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

          {activeTab === 'account' && (() => {
            const refundableLocked = payments.filter(p => (p.refundable ?? isRefundableByDefault(p.type)) && (p.refundStatus ?? (p as any).emdStatus) !== 'Refunded').reduce((s, p) => s + p.amount, 0);
            const nonRefundableSpent = payments.filter(p => !(p.refundable ?? isRefundableByDefault(p.type))).reduce((s, p) => s + p.amount, 0);
            const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

            const refundStatusColor: Record<RefundStatus, string> = {
              'Paid': 'bg-amber-100 text-amber-800',
              'Pending Refund': 'bg-blue-100 text-blue-800',
              'Refunded': 'bg-green-100 text-green-800',
            };
            const typeColor: Partial<Record<PaymentType, string>> = {
              'EMD': 'bg-purple-100 text-purple-800',
              'Security Deposit': 'bg-violet-100 text-violet-800',
              'Performance Security': 'bg-fuchsia-100 text-fuchsia-800',
              'Retention Money': 'bg-pink-100 text-pink-800',
              'Tender Fee': 'bg-indigo-100 text-indigo-800',
              'Processing Fee': 'bg-cyan-100 text-cyan-800',
              'Document Fee': 'bg-teal-100 text-teal-800',
              'e-Portal Fee': 'bg-sky-100 text-sky-800',
              'Stamp Duty': 'bg-orange-100 text-orange-800',
              'Notary/DSC': 'bg-yellow-100 text-yellow-800',
              'Other': 'bg-slate-100 text-slate-700',
            };

            return (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
                    <div className="bg-indigo-50 rounded-lg p-3"><IndianRupee className="w-6 h-6 text-indigo-600" /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Total Paid</div>
                      <div className="text-2xl font-bold text-slate-800">₹{totalPaid.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-5 flex items-center gap-4">
                    <div className="bg-amber-50 rounded-lg p-3"><Wallet className="w-6 h-6 text-amber-600" /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Refundable — locked up</div>
                      <div className="text-2xl font-bold text-amber-700">₹{refundableLocked.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-red-100 shadow-sm p-5 flex items-center gap-4">
                    <div className="bg-red-50 rounded-lg p-3"><CreditCard className="w-6 h-6 text-red-500" /></div>
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Non-refundable — spent</div>
                      <div className="text-2xl font-bold text-red-600">₹{nonRefundableSpent.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>

                {/* Payment Records Panel */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-indigo-600" /> Payment Records
                    </h3>
                    {!showAddPayment && (
                      <button onClick={openAddPayment} className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
                        <Plus className="w-4 h-4" /> Add Payment
                      </button>
                    )}
                  </div>

                  {/* Add / Edit Form */}
                  {showAddPayment && (
                    <div className="p-5 border-b border-indigo-100 bg-indigo-50/40">
                      <h4 className="text-sm font-semibold text-indigo-800 mb-4">{editingPayment ? 'Edit Payment' : 'New Payment'}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Type */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Payment Type</label>
                          <select value={paymentForm.type} onChange={e => {
                            const t = e.target.value as PaymentType;
                            setPaymentForm(f => ({ ...f, type: t, refundable: isRefundableByDefault(t) }));
                          }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                            <optgroup label="Refundable">
                              {(['EMD','Security Deposit','Performance Security','Retention Money'] as PaymentType[]).map(t => <option key={t}>{t}</option>)}
                            </optgroup>
                            <optgroup label="Non-refundable">
                              {(['Tender Fee','Document Fee','Processing Fee','e-Portal Fee','Stamp Duty','Notary/DSC','Other'] as PaymentType[]).map(t => <option key={t}>{t}</option>)}
                            </optgroup>
                          </select>
                        </div>
                        {/* Amount */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Amount (₹)</label>
                          <input type="number" min="0" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                            placeholder="e.g. 50000"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        {/* Date Paid */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Date Paid</label>
                          <input type="date" value={paymentForm.datePaid} onChange={e => setPaymentForm(f => ({ ...f, datePaid: e.target.value }))}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        {/* Payment Mode */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Payment Mode</label>
                          <select value={paymentForm.paymentMode} onChange={e => setPaymentForm(f => ({ ...f, paymentMode: e.target.value as PaymentMode }))}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                            {(['DD','Bank Guarantee','Online','Cash'] as PaymentMode[]).map(m => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        {/* Reference Number */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Reference / DD / UTR Number</label>
                          <input type="text" value={paymentForm.referenceNumber} onChange={e => setPaymentForm(f => ({ ...f, referenceNumber: e.target.value }))}
                            placeholder="Transaction ID, DD no., UTR..."
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        {/* Refundable toggle + expected refund date */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-2">Refundable?</label>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                              <input type="checkbox" checked={paymentForm.refundable}
                                onChange={e => setPaymentForm(f => ({ ...f, refundable: e.target.checked }))}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                              <span className={paymentForm.refundable ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                                {paymentForm.refundable ? 'Yes — refundable' : 'No — sunk cost'}
                              </span>
                            </label>
                          </div>
                          {paymentForm.refundable && (
                            <div className="mt-2">
                              <label className="block text-xs text-slate-500 mb-1">Expected refund date (optional)</label>
                              <input type="date" value={paymentForm.expectedRefundDate}
                                onChange={e => setPaymentForm(f => ({ ...f, expectedRefundDate: e.target.value }))}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            </div>
                          )}
                        </div>
                        {/* Receipt Upload */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Receipt (optional — AI will pre-fill fields)</label>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => receiptInputRef.current?.click()}
                              disabled={receiptUploading || extractingReceipt}
                              className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                              {receiptUploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> :
                               extractingReceipt ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning…</> :
                               <><Upload className="w-3.5 h-3.5" /> Upload Receipt</>}
                            </button>
                            {paymentForm.receiptUrl && (
                              <a href={paymentForm.receiptUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-indigo-600 underline">View</a>
                            )}
                          </div>
                          <input ref={receiptInputRef} type="file" className="hidden" accept="image/*,application/pdf" onChange={handleReceiptUpload} />
                        </div>
                        {/* Notes — full width */}
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                          <textarea value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                            rows={2} placeholder="Any additional details..."
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button onClick={handleSavePayment} disabled={savingPayment}
                          className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                          {savingPayment ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Payment</>}
                        </button>
                        <button onClick={() => { setShowAddPayment(false); setEditingPayment(null); setPaymentForm(defaultPaymentForm); }}
                          className="text-sm font-medium text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Payment List */}
                  <div className="p-5">
                    {paymentsLoading ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
                    ) : payments.length === 0 ? (
                      <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
                        <IndianRupee className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-500 font-medium">No payments recorded yet</p>
                        <p className="text-xs text-slate-400 mt-1">Track EMD, security deposits, tender fees, and other payments for this project.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {payments.map(p => {
                          const isRefundable = p.refundable ?? isRefundableByDefault(p.type);
                          const status: RefundStatus | undefined = p.refundStatus ?? (p as any).emdStatus;
                          return (
                            <div key={p.id} className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                              <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                                {/* Left: type + amount */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColor[p.type] ?? 'bg-slate-100 text-slate-700'}`}>{p.type}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${isRefundable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                      {isRefundable ? 'Refundable' : 'Non-refundable'}
                                    </span>
                                    {isRefundable && status && (
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${refundStatusColor[status]}`}>
                                        {status === 'Paid' && <Clock className="w-3 h-3" />}
                                        {status === 'Pending Refund' && <RotateCcw className="w-3 h-3" />}
                                        {status === 'Refunded' && <BadgeCheck className="w-3 h-3" />}
                                        {status}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xl font-bold text-slate-800">₹{p.amount.toLocaleString('en-IN')}</div>
                                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                    <span><Calendar className="w-3 h-3 inline mr-0.5" />{new Date(p.datePaid).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    <span><CreditCard className="w-3 h-3 inline mr-0.5" />{p.paymentMode}</span>
                                    {p.referenceNumber && <span className="font-mono">Ref: {p.referenceNumber}</span>}
                                    {p.expectedRefundDate && status !== 'Refunded' && <span className="text-blue-600">Exp. refund: {new Date(p.expectedRefundDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                                    {p.refundDate && <span className="text-green-700">Refunded: {new Date(p.refundDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                                  </div>
                                  {p.notes && <p className="text-xs text-slate-500 mt-1 italic">{p.notes}</p>}
                                </div>
                                {/* Right: actions */}
                                <div className="flex flex-col gap-1.5 shrink-0">
                                  {isRefundable && (
                                    <div className="flex flex-wrap gap-1">
                                      {status !== 'Pending Refund' && status !== 'Refunded' && (
                                        <button onClick={() => handleRefundStatusChange(p, 'Pending Refund')}
                                          className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-1">
                                          <RotateCcw className="w-3 h-3" /> Refund Pending
                                        </button>
                                      )}
                                      {status !== 'Refunded' && (
                                        <button onClick={() => handleRefundStatusChange(p, 'Refunded')}
                                          className="text-xs px-2 py-1 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors flex items-center gap-1">
                                          <BadgeCheck className="w-3 h-3" /> Mark Refunded
                                        </button>
                                      )}
                                      {status === 'Refunded' && (
                                        <button onClick={() => handleRefundStatusChange(p, 'Paid')}
                                          className="text-xs px-2 py-1 rounded border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                                          Undo
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  <div className="flex gap-1 justify-end">
                                    {p.receiptUrl && (
                                      <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer"
                                        className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1">
                                        <Receipt className="w-3 h-3" /> Receipt
                                      </a>
                                    )}
                                    <button onClick={() => openEditPayment(p)}
                                      className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1">
                                      <Edit2 className="w-3 h-3" /> Edit
                                    </button>
                                    <button onClick={() => handleDeletePayment(p.id)} disabled={deletingPaymentId === p.id}
                                      className="text-xs px-2 py-1 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center gap-1 disabled:opacity-50">
                                      {deletingPaymentId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Locked-up refundable callout */}
                {refundableLocked > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <Wallet className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-amber-800">₹{refundableLocked.toLocaleString('en-IN')} locked up in refundable deposits</div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        {payments.filter(p => (p.refundable ?? isRefundableByDefault(p.type)) && (p.refundStatus ?? (p as any).emdStatus) !== 'Refunded').length} payment{payments.filter(p => (p.refundable ?? isRefundableByDefault(p.type)) && (p.refundStatus ?? (p as any).emdStatus) !== 'Refunded').length !== 1 ? 's' : ''} awaiting refund.
                        Mark them as refunded once your bank confirms receipt.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {activeTab === 'saved_docs' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <Save className="w-4 h-4 text-slate-500" /> Saved Documents
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Documents you have saved from the Auto-Generate Documents tab.</p>
              </div>
              {savedDocsLoading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
              ) : savedDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                  <FileText className="w-10 h-10 mb-3 opacity-40" />
                  <p className="font-semibold text-slate-600 mb-1">No saved documents yet</p>
                  <p className="text-sm text-slate-400">Generate a document and click "Save Generated Document" to keep it here.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {savedDocs.map(sd => {
                    const isPdfLoading = savedDocDownloadingId === sd.id && savedDocDownloadingType === 'pdf';
                    const isDocxLoading = savedDocDownloadingId === sd.id && savedDocDownloadingType === 'docx';
                    return (
                      <div key={sd.id} className="p-4 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                        <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{sd.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sd.mode === 'exact_form' ? 'bg-violet-100 text-violet-700' : sd.mode === 'exact_form_overlay' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                              {sd.mode === 'exact_form' ? 'Exact Form' : sd.mode === 'exact_form_overlay' ? 'Vision Fill' : 'Standard'}
                            </span>
                            <span className="text-[10px] text-slate-400">{sd.savedAt?.toDate ? sd.savedAt.toDate().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {sd.mode !== 'exact_form_overlay' && (
                            <button
                              onClick={() => { setGeneratedDoc(sd.content); setGeneratedDocIsHtml(sd.isHtml); setDocSaved(true); setDocType(sd.title); setIsEditingDoc(false); setActiveTab('docs'); }}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                            >Open</button>
                          )}
                          {sd.mode !== 'exact_form' && (
                            <button
                              onClick={() => downloadSavedDocPdf(sd)}
                              disabled={savedDocDownloadingId === sd.id}
                              className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium disabled:opacity-50 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                            >
                              {isPdfLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                              PDF
                            </button>
                          )}
                          {sd.mode !== 'exact_form_overlay' && (
                            <button
                              onClick={() => downloadSavedDocDocx(sd)}
                              disabled={savedDocDownloadingId === sd.id}
                              className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium disabled:opacity-50 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                            >
                              {isDocxLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                              Word
                            </button>
                          )}
                          <button
                            onClick={() => deleteSavedDoc(sd.id)}
                            className="text-xs text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                          ><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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

          {activeTab === 'boq' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <BOQViewer
                projectId={projectId!}
                onProceedToPricing={() => setActiveTab('calculator')}
              />
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

      {/* Mode B — Vision Fill review modal */}
      {(modeb.stage === 'reviewing' || modeb.stage === 'exporting') && modeb.mappedFields && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
          <ModeBReviewPanel
            mappedFields={modeb.mappedFields}
            pageW={modeb.pageW}
            pageH={modeb.pageH}
            pageCount={modeb.pageCount}
            formName={modeb.formFile?.name}
            exporting={modeb.stage === 'exporting'}
            onExport={modeb.confirmExport}
            onCancel={modeb.reset}
          />
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
