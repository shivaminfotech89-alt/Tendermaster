import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAnalyzerStore } from "../context/AnalyzerContext";
import { Upload, X, Loader2, Sparkles, AlertCircle, FileText, CheckCircle2, ChevronRight, Activity, CalendarDays, File, MessageSquare, Send, Calculator, Building, Target, Download, Edit2, Trash2, Plus, Minus, ArrowLeft, Info, Save, Scan } from "lucide-react";
import { collection, getDocs, query, addDoc, orderBy, serverTimestamp, doc, updateDoc, setDoc, Timestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "../lib/api";
import { useNavigationGuard } from "../hooks/useNavigationGuard";
import { UnsavedChangesModal } from "../components/UnsavedChangesModal";
import { countPdfPages, extractPdfText, textToBase64, arrayBufferToBase64 } from "../lib/pdfToImage";
import { useModeBFlow } from "../lib/modeb/useModeBFlow";
import ModeBReviewPanel from "../components/modeb/ModeBReviewPanel";
import { isTemplated, fillTemplate, saveCandidateTemplate } from "../lib/docTemplates";
import BOQSection from "../components/boq/BOQSection";
import type { BOQData } from "../lib/boq/types";
import { INITIAL_BOQ } from "../lib/boq/types";
import { detectBoqTypeFromText } from "../lib/boq/detectBoqType";
import { removeUndefined } from "../lib/firestore";
import { extractBoqWithFallback } from "../services/boqExtractionOrchestrator";

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

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function dataUriToBlob(dataUri: string): Blob {
  const [header = '', b64 = ''] = dataUri.split(',');
  const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

interface SavedDoc {
  id: string;
  title: string;
  mode: "standard" | "exact_form" | "exact_form_overlay";
  content: string;
  isHtml: boolean;
  filledPdfUrl?: string;
  savedAt: any;
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

// ── BOQ candidate scoring ──────────────────────────────────────────────────
// All PDFs within this byte cap are retained as BOQ candidates.
// Score from scoreBOQCandidate orders extraction attempts; verification score selects the winner.
const BOQ_BUFFER_CAP_BYTES = 100 * 1024 * 1024; // 100 MB total across all candidates

function scoreBOQCandidate(filename: string, text: string): number {
  let score = 0;
  if (/\bboq\b|b\.o\.q\.|bill.of.quant/i.test(filename)) score += 50;
  else if (/\bschedule\b|\bprice[\s_-]?(?:bid|list)?\b|\bquantit/i.test(filename)) score += 30;
  const s = text.slice(0, 3000);
  if (/\bboq\b|bill\s+of\s+quant|schedule\s+of\s+(?:rates?|quantit)/i.test(s)) score += 40;
  if (/sr\.?\s*no\.?\b|item\s*no\.?\b|sl\.?\s*no\.?\b/i.test(s)) score += 20;
  if (/\bquantit/i.test(s)) score += 10;
  if (/\bunit\s*rate\b|\best(?:imated)?\s*rate\b/i.test(s)) score += 10;
  if (/\bamount\b/i.test(s)) score += 5;
  return score;
}

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

export default function TenderAnalyzer() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation();
  
  const { analyzing, progress, analysisResult, payloadContext, savedProjectId, setAnalyzing, setProgress, setAnalysisResult, setPayloadContext, setSavedProjectId, clearAnalysis } = useAnalyzerStore();

  const [inputType, setInputType] = useState<'pdf' | 'zip'>('pdf');
  const [tenderPdfBase64, setTenderPdfBase64] = useState<string | string[]>("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfFileNames, setPdfFileNames] = useState<string[]>([]);
  const [pdfFileSize, setPdfFileSize] = useState(0);
  const [zipFilesData, setZipFilesData] = useState<string[]>([]);
  const [zipFileName, setZipFileName] = useState("");
  const [zipFileNames, setZipFileNames] = useState<string[]>([]);
  const [zipFileSize, setZipFileSize] = useState(0);
  
  const [error, setError] = useState("");
  const [processingFile, setProcessingFile] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [analyzeStage, setAnalyzeStage] = useState<'uploading' | 'analyzing' | ''>('');

  const [analyzedPayload, setAnalyzedPayload] = useState<any>(null);
  const [docExported, setDocExported] = useState(false);
  
  // Chat state
  const [activeTab, setActiveTab] = useState<'overview'|'docs'|'calculator'|'chat'|'saved_docs'|'notes'>('overview');
  const [analysisRemarks, setAnalysisRemarks] = useState<any>(null);
  const [analyzedPayloadNames, setAnalyzedPayloadNames] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [pageChecking, setPageChecking] = useState(false);

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
  const [exactFormMode, setExactFormMode] = useState(false);
  const [exactFormFile, setExactFormFile] = useState<File | null>(null);
  const [formUploading, setFormUploading] = useState(false);
  const [generatedDocIsHtml, setGeneratedDocIsHtml] = useState(false);
  const [generatedFromTemplate, setGeneratedFromTemplate] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // BOQ state (session only — not persisted for TenderAnalyzer)
  const [boq, setBoq] = useState<BOQData>({ ...INITIAL_BOQ });
  const [boqChangedSinceDocGen, setBoqChangedSinceDocGen] = useState(false);
  // Accumulates raw PDF text during upload for client-side BOQ type detection
  const rawExtractedTextRef = useRef<string>('');
  // BOQ-candidate buffers retained during upload; released immediately after extraction starts
  const boqPdfCandidatesRef = useRef<Array<{name: string; buffer: ArrayBuffer; score: number; pageCount: number}>>([]);
  // Raw PDF bytes for digital-PDF BOQ candidates; parallel to the file list (null = not a candidate or image PDF)
  const boqRawPdfBuffersRef = useRef<(ArrayBuffer | null)[]>([]);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [printWithoutLetterhead, setPrintWithoutLetterhead] = useState(false);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docSaved, setDocSaved] = useState(false);
  const [savedDocDownloadingId, setSavedDocDownloadingId] = useState<string | null>(null);
  const [savedDocDownloadingType, setSavedDocDownloadingType] = useState<'pdf' | 'docx' | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);

  const handleBoqChange = (updated: BOQData) => {
    setBoq(updated);
    if (generatedDoc) setBoqChangedSinceDocGen(true);
  };

  // Mode B Vision fill — onSave handler + state machine hook
  const handleModeBSave = async (blob: Blob, filename: string) => {
    if (!user || !savedProjectId) return;
    const path = `users/${user.uid}/filled-forms/${Date.now()}-${filename}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, new Uint8Array(await blob.arrayBuffer()));
    const filledPdfUrl = await getDownloadURL(fileRef);
    const colRef = collection(db, 'saved_tenders', savedProjectId, 'generated_docs');
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
    tenderData: analysisResult,
    onSave: savedProjectId ? handleModeBSave : undefined,
  });
  const [pendingProjectName, setPendingProjectName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Navigation guards — analysis (credit spent, not yet persisted) and unsaved generated doc
  const analysisDirty = !!analysisResult && !savedProjectId;
  const docDirty = !!generatedDoc && generatedDoc !== "Generating..." && !docExported;
  useNavigationGuard(analysisDirty || docDirty); // beforeunload guard for tab/browser close

  const [showNavModal, setShowNavModal] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const guardedAction = (action: () => void) => {
    if (analysisDirty || docDirty) {
      pendingActionRef.current = action;
      setShowNavModal(true);
    } else {
      action();
    }
  };

  // Callback to mark a generated doc as exported (downloaded or copied)
  const markDocExported = useCallback(() => setDocExported(true), []);

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
    setPdfFileNames(files.map(f => f.name));
    setPdfFileSize(files.reduce((acc, f) => acc + f.size, 0));
    setProcessingFile(true);

    rawExtractedTextRef.current = '';
    boqPdfCandidatesRef.current = [];
    boqRawPdfBuffersRef.current = [];
    try {
      for (const [, file] of files.entries()) {
        const arrayBuffer = await file.arrayBuffer();
        let dataUri: string;
        let extractedText = '';
        let pageCount = 0;
        let isDigital = false;
        try {
          const extraction = await extractPdfText(arrayBuffer);
          extractedText = extraction.text;
          pageCount = extraction.pageCount;
          isDigital = extraction.isDigital;
          if (extraction.isDigital) {
            console.log(`[PDF extraction] ${file.name} → TEXT (${extraction.charsExtracted} non-ws chars across ${extraction.pagesChecked} sampled pages of ${extraction.pageCount})`);
            dataUri = `data:text/plain;base64,${textToBase64(extraction.text)}`;
            rawExtractedTextRef.current += extraction.text + ' ';
          } else {
            console.log(`[PDF extraction] ${file.name} → IMAGE fallback (${extraction.charsExtracted} non-ws chars across ${extraction.pagesChecked} sampled pages of ${extraction.pageCount})`);
            dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
          }
        } catch {
          // pdfjs failed — fall back to sending raw PDF bytes
          console.warn(`[PDF extraction] ${file.name} → IMAGE fallback (extraction error)`);
          dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
        }
        // Single-file uploads always qualify; multi-file uploads are score-gated.
        // Image PDFs can't be text-scored (no extractable text) so they bypass the threshold —
        // the parser will attempt extraction and the verification score determines selection.
        const score = files.length === 1 ? 100 : scoreBOQCandidate(file.name, extractedText);
        const totalCandidateBytes = boqPdfCandidatesRef.current.reduce((s, c) => s + c.buffer.byteLength, 0);
        const underCap = totalCandidateBytes + arrayBuffer.byteLength <= BOQ_BUFFER_CAP_BYTES;
        // Score ranks extraction order only — never used to exclude candidates.
        // Verification score (post-extraction) is the only reliable selector.
        const isBoqCandidate = underCap;
        console.log(`[BOQ] candidate eval: ${file.name}`, { score, isDigital, pageCount, isBoqCandidate });
        if (isBoqCandidate) {
          boqPdfCandidatesRef.current.push({ name: file.name, buffer: arrayBuffer, score, pageCount });
        }
        // For digital PDFs, retain the raw bytes for parallel Storage upload so manual
        // re-extraction can fetch actual PDF bytes (not the text-extracted substitute).
        // Image PDFs are already stored as PDF bytes in payloadRef — no raw upload needed.
        boqRawPdfBuffersRef.current.push(isBoqCandidate && isDigital ? arrayBuffer : null);
        base64Files.push(dataUri);
      }
      setTenderPdfBase64(base64Files as any);
    } finally {
      setProcessingFile(false);
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 30 * 1024 * 1024) {
      setError("ZIP size must be less than 30MB");
      return;
    }
    
    setZipFileName(file.name);
    setZipFileSize(file.size);
    setProcessingFile(true);
    rawExtractedTextRef.current = '';
    boqPdfCandidatesRef.current = [];
    boqRawPdfBuffersRef.current = [];
    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);
      const fileDataArray: string[] = [];
      const fileNameArray: string[] = [];

      for (const [filename, zipEntry] of Object.entries(contents.files)) {
        if (zipEntry.dir) continue;

        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.endsWith('.pdf')) {
          const shortName = filename.split('/').pop() || filename;
          const arrayBuffer = await zipEntry.async("arraybuffer");
          let dataUri: string;
          let zipEntryText = '';
          let zipEntryPageCount = 0;
          let isZipDigital = false;
          try {
            const extraction = await extractPdfText(arrayBuffer);
            zipEntryText = extraction.text;
            zipEntryPageCount = extraction.pageCount;
            isZipDigital = extraction.isDigital;
            if (extraction.isDigital) {
              console.log(`[PDF extraction] ${shortName} (ZIP) → TEXT (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
              dataUri = `data:text/plain;base64,${textToBase64(extraction.text)}`;
              rawExtractedTextRef.current += extraction.text + ' ';
            } else {
              console.log(`[PDF extraction] ${shortName} (ZIP) → IMAGE fallback (${extraction.charsExtracted} chars / ${extraction.pageCount} pages)`);
              dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
            }
          } catch {
            console.warn(`[PDF extraction] ${shortName} (ZIP) → IMAGE fallback (extraction error)`);
            dataUri = `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`;
          }
          // Image PDFs bypass the text-score gate — the parser attempts extraction and
          // the verification score determines which candidate wins.
          const boqScore = scoreBOQCandidate(shortName, zipEntryText);
          const boqTotalBytes = boqPdfCandidatesRef.current.reduce((s, c) => s + c.buffer.byteLength, 0);
          const zipUnderCap = boqTotalBytes + arrayBuffer.byteLength <= BOQ_BUFFER_CAP_BYTES;
          // Score ranks extraction order only — never used to exclude candidates.
          const isZipBoqCandidate = zipUnderCap;
          console.log(`[BOQ] candidate eval: ${shortName} (ZIP)`, { boqScore, isZipDigital, zipEntryPageCount, isZipBoqCandidate });
          if (isZipBoqCandidate) {
            boqPdfCandidatesRef.current.push({ name: shortName, buffer: arrayBuffer, score: boqScore, pageCount: zipEntryPageCount });
          }
          boqRawPdfBuffersRef.current.push(isZipBoqCandidate && isZipDigital ? arrayBuffer : null);
          fileDataArray.push(dataUri);
          fileNameArray.push(shortName);
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
            fileNameArray.push(filename.split('/').pop() || filename);
            boqRawPdfBuffersRef.current.push(null); // spreadsheets never need raw PDF upload
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
      setZipFileNames(fileNameArray);
    } catch (err) {
      setError("Failed to extract ZIP file.");
      console.error(err);
    } finally {
      setProcessingFile(false);
    }
  };

  const clearPdf = () => {
    setPdfFileName("");
    setPdfFileNames([]);
    setPdfFileSize(0);
    setTenderPdfBase64("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearZip = () => {
    setZipFileName("");
    setZipFileNames([]);
    setZipFileSize(0);
    setZipFilesData([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAnalyze = async () => {
    let payload: string | string[] = "";
    
    if (inputType === 'pdf') {
      if (!tenderPdfBase64 || tenderPdfBase64.length === 0) return setError("Please upload a PDF document.");
      payload = tenderPdfBase64;
    } else if (inputType === 'zip') {
      if (!zipFilesData || zipFilesData.length === 0) return setError("Please upload a ZIP folder containing PDF documents.");
      payload = zipFilesData;
    }
    
    setError("");

    // Page-count pre-check — reject uploads that exceed the 1000-page server limit
    setPageChecking(true);
    try {
      const dataUris: string[] = Array.isArray(payload) ? payload : [payload as string];
      let totalPages = 0;
      for (const uri of dataUris) {
        if (!uri.startsWith('data:application/pdf')) continue;
        try {
          totalPages += await countPdfPages(uri);
        } catch {
          // unparseable PDF — let the server enforce the limit
        }
      }
      if (totalPages > 1000) {
        setError(
          `These documents total ${totalPages} pages, over the 1000-page analysis limit. ` +
          `Tip: analyze your main documents first (main tender + eligibility docs), then open the ` +
          `saved project and use "Add document / re-analyze" to include the remaining files in ` +
          `smaller batches, keeping each batch under 1000 pages.`
        );
        return;
      }
    } catch {
      // counting failed entirely — proceed and let the server enforce the limit
    } finally {
      setPageChecking(false);
    }

    setAnalyzing(true);
    setAnalysisResult(null);
    setSavedProjectId(null);
    setDocExported(false);

    try {
      const { doc: firestoreDoc, getDoc: fGetDoc } = await import("firebase/firestore");
      const { db: firestoreDb } = await import("../lib/firebase");
      
      const userRef = firestoreDoc(firestoreDb, "business_profiles", user!.uid);
      const userSnap = await fGetDoc(userRef);
      const profile = userSnap.exists() ? userSnap.data() : { turnover: 0, experienceYears: 0 };
      setBusinessProfile(userSnap.exists() ? userSnap.data() : null);


      const { ref, uploadBytesResumable, getDownloadURL } = await import("firebase/storage");
      const { storage } = await import("../lib/firebase");

      let processedPayload = payload;
      let finalTenderType: string = inputType;
      const rawPdfUploadedUrls: string[] = [];

      if (inputType === 'pdf' || inputType === 'zip') {
        const dataUris = Array.isArray(payload) ? payload : [payload];
        const uploadedUrls: string[] = [];
        const nameSource = inputType === 'pdf' ? pdfFileNames : zipFileNames;
        const blobs = dataUris.map(dataUriToBlob);
        const totalBytes = blobs.reduce((sum, b) => sum + b.size, 0);
        let completedBytes = 0;

        setAnalyzeStage('uploading');
        setUploadPercent(0);

        for (let i = 0; i < blobs.length; i++) {
          const blob = blobs[i]!;
          const fileRef = ref(storage, `users/${user?.uid || 'anon'}/tenders/${Date.now()}_${i}`);
          const url = await new Promise<string>((resolve, reject) => {
            const task = uploadBytesResumable(fileRef, blob, { contentType: blob.type });
            task.on('state_changed',
              (snapshot) => {
                const pct = Math.min(99, ((completedBytes + snapshot.bytesTransferred) / totalBytes) * 100);
                setUploadPercent(pct);
              },
              reject,
              async () => {
                completedBytes += blob.size;
                setUploadPercent(Math.min(100, (completedBytes / totalBytes) * 100));
                try { resolve(await getDownloadURL(task.snapshot.ref)); }
                catch (e) { reject(e); }
              },
            );
          });
          uploadedUrls.push(url);
        }

        // Upload raw PDF bytes for digital BOQ candidates alongside the text-extracted versions.
        // payloadRef stores text (for Gemini cost savings); payloadRefRaw stores the original PDF
        // bytes so manual re-extraction can pass real PDF data to pdf.js instead of text.
        for (let i = 0; i < boqRawPdfBuffersRef.current.length; i++) {
          const buf = boqRawPdfBuffersRef.current[i];
          if (!buf) continue;
          try {
            const rawFileRef = storageRef(storage, `users/${user?.uid || 'anon'}/tenders/${Date.now()}_${i}_raw`);
            await uploadBytes(rawFileRef, new Uint8Array(buf), { contentType: 'application/pdf' });
            rawPdfUploadedUrls.push(await getDownloadURL(rawFileRef));
            console.log(`[BOQ] raw PDF uploaded for slot ${i} (${buf.byteLength} bytes)`);
          } catch (e) {
            console.warn(`[BOQ] raw PDF upload failed for slot ${i}:`, e);
          }
        }

        setAnalyzeStage('analyzing');
        setAnalyzedPayloadNames(nameSource.length === dataUris.length ? nameSource : dataUris.map((_, i) => `Document ${i + 1}`));
        processedPayload = uploadedUrls;
        finalTenderType = 'storage_urls';
      }
      
      setAnalyzedPayload(processedPayload);

      const nameSource = inputType === 'pdf' ? pdfFileNames : inputType === 'zip' ? zipFileNames : [];

      const response = await fetchWithAuth("/api/analyze-tender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderType: finalTenderType,
          tenderContent: processedPayload,
          userProfile: JSON.stringify(profile),
          language: i18n.language,
          fileNames: nameSource,
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
      setAnalysisRemarks(data.remarks || null);
      setPayloadContext(payload);

      // Detect BOQ type from raw PDF text (more reliable than analysis text fields).
      // Only fires when raw text was extracted (digital PDFs); image PDFs fall back to
      // BOQSection's analysis-text detection.
      // Only auto-sets on HIGH confidence — medium/low never override the user's Unknown state.
      if (rawExtractedTextRef.current) {
        const detection = detectBoqTypeFromText(rawExtractedTextRef.current);
        if (detection.confidence === 'high') {
          setBoq(prev =>
            prev.boqType === 'unknown'
              ? {
                  ...prev,
                  boqType: detection.type,
                  boqTypeConfidence: detection.confidence,
                  boqTypeReason: detection.reason,
                  boqTypeScore: detection.score,
                }
              : prev,
          );
          // Persist so ProjectDetails reads the detected type on first load.
          // Guard: boq.boqType is 'unknown' here (INITIAL_BOQ, TenderAnalyzer never
          // loads from Firestore), so we only write when this is a fresh analysis.
          if (data.projectId && boq.boqType === 'unknown') {
            updateDoc(doc(db, 'saved_tenders', data.projectId), removeUndefined({
              'boq.boqType': detection.type,
              'boq.boqTypeConfidence': detection.confidence,
              'boq.boqTypeReason': detection.reason,
              'boq.boqTypeScore': detection.score,
            })).catch(console.error);
          }
        }
        rawExtractedTextRef.current = '';
      }
      if (data.projectId) {
        setSavedProjectId(data.projectId);
        setPendingProjectName(data.analysis?.tender_simplified?.tender_name || "Untitled Tender");
        setShowNameDialog(true);

        // Persist raw PDF Storage URLs so ProjectDetails can use them for manual re-extraction.
        // These are only present for digital PDFs above the BOQ threshold — image PDFs and
        // non-candidate files have their payloadRef URL pointing to actual PDF bytes already.
        if (rawPdfUploadedUrls.length > 0) {
          updateDoc(doc(db, 'saved_tenders', data.projectId), {
            payloadRefRaw: rawPdfUploadedUrls,
          }).catch(console.error);
        }

        // Trigger BOQ extraction for all upload types when candidates were retained.
        // Always writes back a status — never silently fails.
        if (boqPdfCandidatesRef.current.length > 0) {
          const projectId = data.projectId;
          const currentUserId = user?.uid ?? null;
          // Capture and immediately release the ref so buffers can be GC'd after extraction
          const candidates = boqPdfCandidatesRef.current;
          boqPdfCandidatesRef.current = [];
          (async () => {
            const latestRef = doc(db, 'saved_tenders', projectId, 'boq_extraction', 'latest');
            try {
              await setDoc(latestRef, removeUndefined({ status: 'running', startedAt: serverTimestamp() }));

              // Run on all candidates; keep the result with the highest verification score.
              // Candidates are pre-sorted by BOQ content score but the FINAL selector is
              // verification score — a well-structured BOQ beats a high filename score.
              let best: Awaited<ReturnType<typeof extractBoqWithFallback>> | null = null;
              let bestCandidateName = '';
              for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
                try {
                  const result = await extractBoqWithFallback(candidate.buffer);
                  console.log(`[BOQ] extracted from ${candidate.name}`, {
                    items: result.extraction.items.length,
                    verificationScore: result.verification.score,
                    verificationPass: result.verification.pass,
                    criticalFailures: result.verification.criticalFailures,
                    candidateScore: candidate.score,
                  });
                  if (result.extraction.items.length > 0 &&
                      (!best || result.verification.score > best.verification.score)) {
                    best = result;
                    bestCandidateName = candidate.name;
                  }
                } catch (e) {
                  console.warn(`[BOQ] extraction failed for ${candidate.name}:`, e);
                }
              }

              if (!best) {
                await setDoc(latestRef, removeUndefined({ status: 'no_boq_found', updatedAt: serverTimestamp() }));
                return;
              }

              console.log(`[BOQ] selected candidate: ${bestCandidateName}`, {
                items: best.extraction.items.length,
                verificationScore: best.verification.score,
                verificationPass: best.verification.pass,
              });

              const { extraction, verification, telemetry } = best;
              const visionPageCap = 20;
              const maxPageCount = candidates.reduce((m, c) => Math.max(m, c.pageCount), 0);

              // Never display a failed-verification result — it means the extracted data is
              // untrustworthy (score 0 = critical check failed, e.g. reconciliation mismatch).
              if (!verification.pass) {
                if (maxPageCount > visionPageCap) {
                  await setDoc(latestRef, removeUndefined({
                    status: 'failed',
                    reason: `Document has ${maxPageCount} pages, which exceeds the ${visionPageCap}-page AI verification limit.`,
                    updatedAt: serverTimestamp(),
                  }));
                } else {
                  // Within the Vision page cap but Vision isn't implemented yet — report as
                  // failed with a clear message rather than showing untrustworthy data.
                  await setDoc(latestRef, removeUndefined({
                    status: 'failed',
                    reason: `Could not reliably extract the BOQ from this document (verification score: ${verification.score}/100, failures: ${verification.criticalFailures.join(', ')}). Click Retry to try again.`,
                    updatedAt: serverTimestamp(),
                  }));
                }
                addDoc(collection(db, 'activity_logs'), removeUndefined({
                  userId: currentUserId,
                  projectId,
                  event: 'boq_verification_failed',
                  reason: `score=${verification.score} failures=${verification.criticalFailures.join(',')} maxPages=${maxPageCount}`,
                  verificationScore: verification.score,
                  createdAt: serverTimestamp(),
                })).catch(console.error);
                return;
              }

              const totalAmount = extraction.items.reduce((s, it) => s + (it.amount ?? 0), 0);
              await setDoc(latestRef, removeUndefined({
                status: 'done',
                items: extraction.items,
                itemCount: extraction.items.length,
                totalAmount,
                engine: telemetry.engine,
                visionUsed: telemetry.engine === 'vision',
                verificationScore: verification.score,
                parserDurationMs: telemetry.parserDurationMs,
                updatedAt: serverTimestamp(),
              }));
            } catch (err: any) {
              setDoc(latestRef, removeUndefined({
                status: 'failed',
                reason: err?.message ?? 'BOQ extraction failed.',
                updatedAt: serverTimestamp(),
              })).catch(() => {});
            }
          })();
        }
      }

    } catch (err: any) {
      setError(friendlyAnalysisError(err.message));
    } finally {
      setAnalyzing(false);
      setAnalyzeStage('');
      setUploadPercent(0);
    }
  };


  const loadSavedDocs = async (projectId: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, "saved_tenders", projectId, "generated_docs"), orderBy("savedAt", "desc"))
      );
      setSavedDocs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedDoc)));
    } catch (e) {
      console.error("Failed to load saved docs", e);
    }
  };

  useEffect(() => { if (savedProjectId) loadSavedDocs(savedProjectId); }, [savedProjectId]);

  const saveDocument = async () => {
    if (!savedProjectId || !generatedDoc || generatedDoc === "Generating...") return;
    setSavingDoc(true);
    try {
      await addDoc(collection(db, "saved_tenders", savedProjectId, "generated_docs"), {
        title: exactFormMode ? "Exact Form Fill" : docType,
        mode: exactFormMode ? "exact_form" : "standard",
        content: generatedDoc,
        isHtml: generatedDocIsHtml,
        savedAt: serverTimestamp(),
      });
      setDocSaved(true);
      markDocExported();
      toast.success("Document saved to project.");
      await loadSavedDocs(savedProjectId);
    } catch (e: any) {
      toast.error("Failed to save document.");
    } finally {
      setSavingDoc(false);
    }
  };

  const deleteSavedDoc = async (docId: string) => {
    if (!savedProjectId) return;
    try {
      const { deleteDoc, doc: docRef } = await import("firebase/firestore");
      await deleteDoc(docRef(db, "saved_tenders", savedProjectId, "generated_docs", docId));
      setSavedDocs(prev => prev.filter(d => d.id !== docId));
      toast.success("Saved document deleted.");
    } catch (e) {
      toast.error("Failed to delete.");
    }
  };

  const handleConfirmProjectName = async () => {
    const name = pendingProjectName.trim();
    setShowNameDialog(false);
    if (!savedProjectId || !name) return;
    try {
      await updateDoc(doc(db, "saved_tenders", savedProjectId), { projectName: name });
    } catch (e) {
      console.error("[NameDialog] updateDoc failed", e);
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
    if (!analysisResult) return;
    if (exactFormMode && !exactFormFile) {
      toast.error("Please upload the blank form you want filled.");
      return;
    }
    setDocSaved(false);
    setGeneratingDoc(true);
    setGeneratedDoc("Generating...");
    setGeneratedDocIsHtml(false);
    setIsEditingDoc(false);
    setDocExported(false);
    setGeneratedFromTemplate(false);
    setBoqChangedSinceDocGen(false);

    // ── Template path: instant generation, no API call ────────────────────────
    if (!exactFormMode && isTemplated(docType, analysisResult?.tender_simplified?.authority_name)) {
      const md = fillTemplate(docType, businessProfile, analysisResult, analysisResult?.tender_simplified?.authority_name, boq);
      if (md) {
        setGeneratedDoc(md);
        setGeneratedDocIsHtml(false);
        setGeneratedFromTemplate(true);
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
            tenderDetails: analysisResult,
            userProfile: businessProfile,
            extraInstructions,
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
      // Save as candidate template for admin review (fire-and-forget)
      if (!exactFormMode) {
        saveCandidateTemplate(
          docType,
          data.document,
          analysisResult?.tender_simplified?.authority_name ?? null,
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
      markDocExported();
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
      markDocExported();
    } catch (e: any) {
      toast.error("Word generation failed: " + e.message);
    } finally {
      setDownloadingDocx(false);
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

  const navModalTitle = analysisDirty ? "Unsaved analysis" : "Leave without saving your document?";
  const navModalMessage = analysisDirty
    ? "This analysis hasn't been saved to your projects yet. Leave without saving?"
    : "You have a generated document that hasn't been downloaded or copied yet.";
  const navModalStayLabel = analysisDirty ? "Stay on Page" : "Stay & Download";

  return (
    <>
    <UnsavedChangesModal
      isOpen={showNavModal}
      title={navModalTitle}
      message={navModalMessage}
      stayLabel={navModalStayLabel}
      leaveLabel="Discard"
      onLeave={() => { pendingActionRef.current?.(); pendingActionRef.current = null; setShowNavModal(false); }}
      onStay={() => { pendingActionRef.current = null; setShowNavModal(false); }}
    />
    {showNameDialog && (
      <div
        className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={() => setShowNameDialog(false)}
      >
        <div
          className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95"
          onClick={e => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold text-slate-900 mb-1">Name Your Project</h3>
          <p className="text-sm text-slate-500 mb-4">Give this analysis a memorable name. You can always rename it later from the project view.</p>
          <input
            type="text"
            value={pendingProjectName}
            onChange={e => setPendingProjectName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pendingProjectName.trim()) handleConfirmProjectName(); if (e.key === 'Escape') setShowNameDialog(false); }}
            autoFocus
            placeholder="e.g. ONGC Solar Panels Q3 2025"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none mb-4"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowNameDialog(false)}
              className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleConfirmProjectName}
              disabled={!pendingProjectName.trim()}
              className="px-4 py-2 font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
            >
              Save Name
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="p-6 md:p-8 max-w-6xl mx-auto pb-24 relative">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("analyzer")}</h1>
          <p className="text-slate-500 mt-1">Cross-match GeM/eProcure documents against your business constraints.</p>
        </div>
      </div>

      {!analysisResult && (
        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-opacity ${analyzing || pageChecking ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="p-0 border-b border-slate-100 flex items-center bg-slate-50 overflow-x-auto">
            <button
              onClick={() => setInputType('pdf')}
              className={`flex-1 py-4 px-6 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 whitespace-nowrap ${inputType === 'pdf' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <File className="w-4 h-4" /> Attach PDF Files
            </button>
            <button
              onClick={() => setInputType('zip')}
              className={`flex-1 py-4 px-6 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 whitespace-nowrap ${inputType === 'zip' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <Upload className="w-4 h-4" /> ZIP Folder (PDF, Excel, CSV)
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
                    className={`border-2 border-dashed border-slate-300 rounded-xl p-8 md:p-12 text-center cursor-pointer hover:bg-indigo-50/40 hover:border-indigo-400 transition-all ${analyzing ? 'opacity-50' : ''}`}
                  >
                    <File className="w-10 h-10 text-indigo-500 mx-auto mb-4" />
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
                         <p className="text-sm text-slate-500">{formatFileSize(pdfFileSize)}</p>
                         {pdfFileSize > LARGE_FILE_BYTES && (
                           <p className="text-xs text-amber-600 mt-0.5">Large file — may take longer or exceed analysis limits.</p>
                         )}
                       </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {analyzing ? (
                        <div className="flex flex-col gap-2 min-w-[180px]">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
                            <span>
                              {analyzeStage === 'uploading'
                                ? `Uploading… ${Math.round(uploadPercent)}%`
                                : pageChecking
                                ? 'Checking pages…'
                                : 'Analyzing tender…'}
                            </span>
                          </div>
                          {analyzeStage === 'uploading' && (
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                style={{ width: `${uploadPercent}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ) : processingFile ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          <span>Reading file…</span>
                        </div>
                      ) : (
                        <>
                          <button onClick={clearPdf} className="text-slate-500 hover:text-red-500 p-2">
                            <Trash2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={handleAnalyze}
                            disabled={pageChecking}
                            className="bg-gradient-to-br from-indigo-700 to-blue-600 hover:from-indigo-800 hover:to-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
                          >
                            {pageChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : 'Analyze Document'}
                          </button>
                        </>
                      )}
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
                     className={`border-2 border-dashed border-slate-300 rounded-xl p-8 md:p-12 text-center cursor-pointer hover:bg-indigo-50/40 hover:border-indigo-400 transition-all ${analyzing ? 'opacity-50' : ''}`}
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
                          <p className="text-sm text-slate-500">
                            {processingFile
                              ? 'Extracting documents…'
                              : `${zipFilesData.length} document${zipFilesData.length !== 1 ? 's' : ''} · ${formatFileSize(zipFileSize)}`}
                          </p>
                          {!processingFile && zipFileSize > LARGE_FILE_BYTES && (
                            <p className="text-xs text-amber-600 mt-0.5">Large file — may take longer or exceed analysis limits.</p>
                          )}
                        </div>
                     </div>
                     <div className="flex items-center gap-3 shrink-0">
                       {analyzing ? (
                         <div className="flex flex-col gap-2 min-w-[180px]">
                           <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                             <Loader2 className="w-4 h-4 animate-spin text-indigo-500 shrink-0" />
                             <span>
                               {analyzeStage === 'uploading'
                                 ? `Uploading… ${Math.round(uploadPercent)}%`
                                 : pageChecking
                                 ? 'Checking pages…'
                                 : 'Analyzing tender…'}
                             </span>
                           </div>
                           {analyzeStage === 'uploading' && (
                             <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                               <div
                                 className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                 style={{ width: `${uploadPercent}%` }}
                               />
                             </div>
                           )}
                         </div>
                       ) : processingFile ? (
                         <div className="flex items-center gap-2 text-sm text-slate-500">
                           <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                           <span>Reading ZIP…</span>
                         </div>
                       ) : (
                         <>
                           <button onClick={clearZip} className="text-slate-500 hover:text-red-500 p-2">
                             <Trash2 className="w-5 h-5" />
                           </button>
                           <button
                             onClick={handleAnalyze}
                             disabled={pageChecking}
                             className="bg-gradient-to-br from-indigo-700 to-blue-600 hover:from-indigo-800 hover:to-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
                           >
                             {pageChecking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : 'Analyze ZIP'}
                           </button>
                         </>
                       )}
                     </div>
                   </div>
                 )}
                 <input type="file" ref={fileInputRef} className="hidden" accept=".zip,application/zip" onChange={(e) => (inputType as string) === 'pdf' ? handlePdfUpload(e) : handleZipUpload(e)} />
               </div>
            )}

          </div>
        </div>
      )}

      {analysisResult && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 border-l-4 border-l-indigo-600 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
            <div>
               <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                 <Target className="w-5 h-5 text-emerald-600" />
                 Analysis Complete
               </h2>
               <p className="text-sm text-slate-500 mt-1">Review the AI generated breakdown below.</p>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
               <button onClick={() => guardedAction(clearAnalysis)} className="text-slate-500 hover:text-slate-800 font-semibold text-sm flex items-center gap-2">
                 <ArrowLeft className="w-4 h-4" /> New Analysis
               </button>
               <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                 {savedProjectId ? (
                   <a
                     href={`/dashboard/projects/${savedProjectId}`}
                     className="text-white bg-gradient-to-br from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 shrink-0 transition-all shadow-sm"
                   >
                     <CheckCircle2 className="w-4 h-4" /> View Saved Project
                   </a>
                 ) : (
                   <span className="text-xs text-slate-400 italic">Saving project…</span>
                 )}
               </div>
            </div>
          </div>

          <div className="flex border-b border-slate-200 mb-6 bg-white rounded-xl shadow-sm overflow-x-auto print:hidden">

                <button onClick={() => setActiveTab('overview')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'overview' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Overview</button>
                <button onClick={() => setActiveTab('docs')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'docs' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Auto-Generate Documents</button>
                <button onClick={() => setActiveTab('calculator')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'calculator' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Bid Engine & Profit Calculator</button>
                <button onClick={() => setActiveTab('chat')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'chat' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tender Chat AI</button>
                <button onClick={() => setActiveTab('saved_docs')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${activeTab === 'saved_docs' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  Saved Documents
                  {savedDocs.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{savedDocs.length}</span>}
                </button>
                <button onClick={() => setActiveTab('notes')} className={`px-6 py-4 font-semibold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'notes' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Analysis Notes</button>
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
                 {analysisResult?.tender_simplified?.scope_of_work}
              </p>
            </div>
            )}

            {/* Part 1: Match with Profile */}
            {analysisResult?.compatibility && (
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
            )}
            </>
            )}

            {/* Bid Engine & Profit Calculator */}
            {activeTab === 'calculator' && role === 'free' && <LockedOverlay />}
            {activeTab === 'calculator' && role !== 'free' && (
              <div className="space-y-6">
                {/* BOQ & Bid Pricing */}
                <BOQSection
                  analysisResult={analysisResult}
                  boq={boq}
                  setBoq={handleBoqChange}
                  totalCost={totalExpense}
                  onRevenueSync={(amount) => setRevenue(amount)}
                />

                {/* AI Bid Recommendation — shown only when the field is present */}
                {analysisResult?.bid_recommendation ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
                  <div className="p-6 md:w-2/3">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
                      <Target className="w-5 h-5 text-indigo-600" /> AI Risk & Bid Calculator
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-xs text-slate-500 mb-1">Estimated Value</p>
                        <p className="font-bold text-slate-800">{analysisResult.bid_recommendation?.estimated_value || '₹ -'}</p>
                      </div>
                      <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                        <p className="text-xs text-blue-600 font-semibold mb-1">Target Bid</p>
                        <p className="font-black text-blue-700">{analysisResult.bid_recommendation?.recommended || '₹ -'}</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-xs text-slate-500 mb-1">Safe Range</p>
                        <p className="font-semibold text-slate-700 text-sm overflow-hidden text-ellipsis whitespace-nowrap" title={analysisResult.bid_recommendation?.safe_range}>{analysisResult.bid_recommendation?.safe_range || '₹ -'}</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-xs text-slate-500 mb-1">Risk Level</p>
                        <p className="font-bold text-slate-800">{analysisResult.bid_recommendation?.risk_level || '-'}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-600 border border-slate-100">
                      <span className="font-semibold text-slate-700">Rationale: </span>
                      {analysisResult.bid_recommendation?.rationale || '-'}
                    </div>
                  </div>

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
                ) : (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
                  <span>AI bid recommendation isn't available for this analysis — you can still calculate manually below.</span>
                </div>
                )}

                {/* Manual Profit Calculator — always shown for premium users */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-slate-900 p-5 flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-emerald-400" /> Expense & Profit Calculator
                      </h3>
                      <p className="text-sm text-slate-400 mt-0.5">Adjust estimates to calculate your profit margin.</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-6 bg-slate-50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white p-4 rounded-xl border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 uppercase">Bid Value / Revenue</p>
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
                        <div className="mt-2 text-2xl font-bold text-rose-600">₹{totalExpense.toLocaleString()}</div>
                      </div>
                      <div className={`p-4 rounded-xl border ${estimatedProfit > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                        <p className="text-xs font-bold uppercase opacity-70">Projected Profit / Loss</p>
                        <div className="mt-2 text-2xl font-bold">₹{estimatedProfit.toLocaleString()}</div>
                        {revenue > 0 && (
                          <p className="text-sm font-medium mt-1 opacity-80">{((estimatedProfit / revenue) * 100).toFixed(1)}% Margin</p>
                        )}
                      </div>
                    </div>
                    {analysisResult?.financial_estimate ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-white rounded-xl border border-slate-200">
                        <div className="p-6">
                          <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Building className="w-4 h-4 text-slate-400" /> Material Costs</h4>
                          {materials.length > 0 ? (
                            <ul className="space-y-4">
                              {materials.map((mc: any, i: number) => (
                                <li key={i} className="flex justify-between items-start gap-4">
                                  <div>
                                    <p className="font-semibold text-slate-900">{mc.item}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{mc.rationale}</p>
                                  </div>
                                  <span className="font-mono text-sm font-bold text-slate-700 bg-slate-50 px-2 py-1 rounded">{mc.estimated_cost}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-400">No material cost data available.</p>
                          )}
                        </div>
                        <div className="p-6">
                          <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-slate-400" /> Labor Costs</h4>
                          {labour.length > 0 ? (
                            <ul className="space-y-4">
                              {labour.map((lc: any, i: number) => (
                                <li key={i} className="flex justify-between items-start gap-4">
                                  <div>
                                    <p className="font-semibold text-slate-900">{lc.role}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{lc.rationale}</p>
                                  </div>
                                  <span className="font-mono text-sm font-bold text-slate-700 bg-slate-50 px-2 py-1 rounded">{lc.estimated_cost}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-400">No labor cost data available.</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-4">Cost breakdown isn't available for this analysis. Enter your bid value above to calculate profit manually.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'overview' && (
              <>
              {analysisResult?.tender_simplified && (
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
                   {analysisResult.tender_simplified.pros?.length > 0 && (
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
                   )}
                   {analysisResult.tender_simplified.cons_and_risks?.length > 0 && (
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
                   )}
                 </div>
              </div>
</CollapsibleSection>
              )}

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
                      <span className="text-sm font-bold text-slate-900">{analysisResult?.timeline_and_milestones?.pre_bid_meeting}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-500">Clarification Closes</span>
                      <span className="text-sm font-bold text-slate-900">{analysisResult?.timeline_and_milestones?.clarification_deadline}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-500">Submission Deadline</span>
                      <span className="text-sm font-bold text-slate-900 text-red-600">{analysisResult?.timeline_and_milestones?.submission_deadline}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm font-semibold text-slate-500">Contract Duration</span>
                      <span className="text-sm font-bold text-slate-900">{analysisResult?.timeline_and_milestones?.execution_duration}</span>
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
                    {analysisResult?.application_roadmap?.winning_strategy_tips?.map((tip: string, i: number) => (
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
                     Portal: {analysisResult?.application_roadmap?.portal_source}
                   </div>
                   
                   <div className="space-y-4">
                     {analysisResult?.application_roadmap?.detailed_procedure_steps && analysisResult.application_roadmap.detailed_procedure_steps.length > 0 ? (
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
                         {analysisResult?.application_roadmap?.next_immediate_steps?.map((step: string, i: number) => (
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
                      {analysisResult?.required_documents_checklist?.map((doc: any, i: number) => (
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

             {analysisResult?.compliance_matrix && analysisResult.compliance_matrix.length > 0 && (
               <CollapsibleSection title="Part 5: Compliance Matrix">
                 <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-2">
                   <div className="divide-y divide-slate-100">
                     {analysisResult.compliance_matrix.map((item: any, i: number) => (
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
               </CollapsibleSection>
             )}

             </>
             )}

             </>
             )}

             {/* Generate Documents */}
             {activeTab === 'docs' && role === 'free' && <LockedOverlay />}
             {activeTab === 'docs' && role !== 'free' && (
             <>
             {boqChangedSinceDocGen && boq.quotedAmount != null && (
               <div className="flex items-center gap-2 mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
                 <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                 BOQ has been updated since this document was generated. Regenerate to include the latest bid figures.
               </div>
             )}
             <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 shadow-sm overflow-hidden mb-6">
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
                    className="flex-1 bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
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
                  {isTemplated(docType, analysisResult?.tender_simplified?.authority_name) && (
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
                    className="w-full bg-white border border-indigo-200 text-indigo-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
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
                             }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium transition-colors">
                               <FileText className="w-3 h-3" /> Print
                             </button>
                           ) : (
                             <button onClick={() => {
                               if (isEditingDoc) { toast("Click 'Preview' to apply your edits before printing.", { icon: "✏️" }); return; }
                               const printWindow = window.open('', '', 'width=800,height=900');
                               if (!printWindow) return;
                               const content = document.getElementById('generated-doc-content-analyzer')?.innerHTML || '';
                               let headerHtml = ''; let footerHtml = ''; let bgImageHtml = '';
                               let pageMargin = '20mm'; let bodyPadding = '0';
                               if (useLetterhead && businessProfile) {
                                 if (businessProfile.letterheadBackgroundImage) {
                                   bgImageHtml = `<img src="${businessProfile.letterheadBackgroundImage}" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;object-fit:cover;" />`;
                                   pageMargin = '0'; bodyPadding = '0 20mm';
                                   headerHtml = `<div style="height:35mm;width:100%;"></div>`;
                                   footerHtml = `<div style="height:30mm;width:100%;"></div>`;
                                 } else {
                                   headerHtml = businessProfile.letterheadHeader || `<div style="text-align:center;padding-bottom:5mm;border-bottom:2px solid #000;margin-bottom:5mm;"><h2>${businessProfile.companyName || 'Company Name'}</h2><p>${businessProfile.contactDetails || ''}</p></div>`;
                                   footerHtml = businessProfile.letterheadFooter || `<div style="text-align:center;padding-top:5mm;border-top:1px solid #000;margin-top:5mm;font-size:12px;"><p>${businessProfile.website || ''}</p></div>`;
                                 }
                               }
                               printWindow.document.write(`<html><head><title>Print - ${docType}</title><style>@page{size:A4;margin:${pageMargin}}body{font-family:system-ui,sans-serif;color:#111827;margin:0;padding:${bodyPadding};box-sizing:border-box}.content{font-size:11pt;line-height:1.6}table.layout-table{width:100%;border-collapse:collapse;border:none;margin:0;padding:0;table-layout:fixed}table.layout-table>thead{display:table-header-group}table.layout-table>tfoot{display:table-footer-group}table.layout-table td{border:none;padding:0}table:not(.layout-table){width:100%;border-collapse:collapse;margin:10px 0 20px;page-break-inside:auto}table:not(.layout-table) tr{page-break-inside:avoid}table:not(.layout-table) th,table:not(.layout-table) td{border:1px solid #d1d5db;padding:8px 12px;text-align:left;overflow-wrap:break-word}table:not(.layout-table) th{background:#f3f4f6}h1,h2,h3,h4,h5{margin-top:15px;margin-bottom:10px;page-break-after:avoid}p{margin-bottom:10px}ul,ol{margin-bottom:10px;padding-left:20px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${bgImageHtml}<table class="layout-table"><thead><tr><td>${headerHtml}</td></tr></thead><tbody><tr><td><div class="content">${content}</div></td></tr></tbody><tfoot><tr><td>${footerHtml}</td></tr></tfoot></table></body></html>`);
                               printWindow.document.close();
                               printWindow.focus();
                               setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
                             }} className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-800 font-medium transition-colors">
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
                               markDocExported();
                             }} className="text-xs flex items-center gap-1 text-slate-500 hover:text-slate-700 font-medium transition-colors">
                               <Download className="w-3 h-3" /> .txt
                             </button>
                           <button onClick={() => { navigator.clipboard.writeText(generatedDoc); toast.success("Copied to clipboard!"); markDocExported(); }}
                               className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                               <FileText className="w-3 h-3" /> Copy
                             </button>
                           <button onClick={() => setIsEditingDoc(!isEditingDoc)} className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                             <Edit2 className="w-3 h-3" /> {isEditingDoc ? "Preview" : generatedDocIsHtml ? "Edit HTML" : "Edit"}
                           </button>
                           {savedProjectId && (
                             <button
                               onClick={saveDocument}
                               disabled={savingDoc || docSaved}
                               className={`text-xs flex items-center gap-1 font-medium transition-colors disabled:opacity-50 ${docSaved ? 'text-emerald-600' : 'text-emerald-700 hover:text-emerald-900'}`}
                             >
                               {savingDoc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                               {docSaved ? "Saved" : "Save Generated Document"}
                             </button>
                           )}
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
                        )}
                     </div>
                  )}
               </div>
             </div>
             </>
             )}

             {/* Integrated Chatbot for active tender */}
             {activeTab === 'chat' && role === 'free' && <LockedOverlay />}
             {activeTab === 'chat' && role !== 'free' && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: '500px' }}>
                <div className="p-4 border-b border-indigo-800/30 bg-gradient-to-r from-indigo-700 to-blue-600 text-white flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <h3 className="font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" />
                        Ask Questions About This Tender
                      </h3>
                      <span className="text-xs bg-white/20 px-2 py-1 rounded font-medium">TenderMaster AI</span>
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
                     className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1 shrink-0 ${confirmClearChat ? 'bg-red-500 hover:bg-red-600 text-white font-bold' : 'bg-white/15 hover:bg-white/25 text-white'}`}
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
                       className="bg-indigo-600 hover:bg-indigo-700 text-white w-11 h-11 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 transition-colors"
                     >
                       <Send className="w-5 h-5 -ml-0.5" />
                     </button>
                   </div>
                </div>
             </div>
             )}

            {activeTab === 'saved_docs' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <Save className="w-4 h-4 text-slate-500" /> Saved Documents
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Documents you have saved from the Auto-Generate Documents tab.</p>
                </div>
                {savedDocs.length === 0 ? (
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
                        <div key={sd.id} className="p-4 flex items-center gap-3 group hover:bg-slate-50/50 transition-colors">
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
                {!analysisRemarks ? (
                  <div className="text-slate-500 text-sm py-8 text-center">
                    No analysis notes available. Notes are generated when files are uploaded via ZIP or multiple PDFs.
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-slate-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-slate-800">{analysisRemarks.totalFilesProvided}</div>
                        <div className="text-xs text-slate-500 mt-1">Files Provided</div>
                      </div>
                      <div className="bg-indigo-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-indigo-700">{analysisRemarks.filesAnalyzed}</div>
                        <div className="text-xs text-slate-500 mt-1">Files Analyzed</div>
                      </div>
                      <div className={`rounded-lg p-4 text-center ${analysisRemarks.filesSkipped?.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                        <div className={`text-2xl font-bold ${analysisRemarks.filesSkipped?.length > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{analysisRemarks.filesSkipped?.length ?? 0}</div>
                        <div className="text-xs text-slate-500 mt-1">Files Skipped</div>
                      </div>
                    </div>

                    {analysisRemarks.filesSkipped?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-2">Skipped Files</h3>
                        <ul className="space-y-1">
                          {analysisRemarks.filesSkipped.map((s: any, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                              <span className="font-medium shrink-0">File {s.index + 1}:</span>
                              <span>{s.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysisRemarks.notes?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-2">Notes</h3>
                        <ul className="space-y-1">
                          {analysisRemarks.notes.map((note: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                              <span className="text-indigo-400 mt-0.5">•</span>
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysisRemarks.filesSkipped?.length === 0 && analysisRemarks.notes?.length === 0 && (
                      <p className="text-sm text-slate-500">All files were analyzed successfully with no issues detected.</p>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      )}
    </div>

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
    </>
  );
}