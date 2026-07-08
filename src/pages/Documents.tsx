import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  collection, query, where, onSnapshot, addDoc, deleteDoc, doc,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "../lib/firebase";
import {
  Upload, FileText, File, FileImage, FileSpreadsheet, FileArchive,
  Download, Trash2, Search, X, Loader2, FolderOpen, Info, MoreVertical,
} from "lucide-react";
import toast from "react-hot-toast";

// ── Types & constants ─────────────────────────────────────────────────────────

const CATEGORIES = ["Compliance", "Financials", "Tenders", "Assets", "Reports"] as const;
type Category = typeof CATEGORIES[number];

interface DocRecord {
  id: string;
  name: string;
  category: Category;
  size: number;
  uploadedAt: any;
  storagePath: string;
  downloadURL: string;
  fileType: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileIcon({ ext, size = 5 }: { ext: string; size?: number }) {
  const c = `w-${size} h-${size} shrink-0`;
  if (ext === "pdf") return <FileText className={`${c} text-red-500`} />;
  if (["doc", "docx"].includes(ext)) return <FileText className={`${c} text-blue-500`} />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className={`${c} text-emerald-500`} />;
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return <FileImage className={`${c} text-purple-500`} />;
  if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) return <FileArchive className={`${c} text-amber-500`} />;
  return <File className={`${c} text-slate-400`} />;
}

const BADGE_CLS: Record<Category, string> = {
  Compliance: "bg-indigo-50 text-indigo-700",
  Financials: "bg-emerald-50 text-emerald-700",
  Tenders:    "bg-blue-50 text-blue-700",
  Assets:     "bg-amber-50 text-amber-700",
  Reports:    "bg-purple-50 text-purple-700",
};

function CatBadge({ cat }: { cat: Category }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${BADGE_CLS[cat]}`}>
      {cat}
    </span>
  );
}

// ── Upload modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onUpload: (file: File, category: Category, onProgress: (p: number) => void) => Promise<void>;
}

function UploadModal({ onClose, onUpload }: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<Category>("Compliance");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await onUpload(file, category, setProgress);
      onClose();
    } catch {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-lg">Upload Document</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-1 rounded-full hover:bg-slate-100 text-slate-400 disabled:opacity-40 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onClick={() => { if (!file) inputRef.current?.click(); }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              file
                ? "border-indigo-300 bg-indigo-50/60 cursor-default"
                : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileIcon ext={getExt(file.name)} size={9} />
                <p className="font-semibold text-slate-800 text-sm truncate max-w-xs">{file.name}</p>
                <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                {!uploading && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-xs text-red-500 hover:underline mt-0.5"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Upload className="w-9 h-9" />
                <div>
                  <p className="font-medium text-slate-600 text-sm">Drop a file or click to browse</p>
                  <p className="text-xs mt-1">PDF, Word, Excel, Images, ZIP — up to 50 MB</p>
                </div>
              </div>
            )}
          </div>

          {/* Category picker */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    category === cat
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Uploading…</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!file || uploading}
            className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Help banner data ──────────────────────────────────────────────────────────

const VAULT_TYPES = [
  {
    label: "Compliance Vault",
    desc: "Certifications, GST/PAN, MSME registration, labour licences, legal documents.",
  },
  {
    label: "Financial Documents",
    desc: "Audited statements, bank certificates, ITR proofs, turnover declarations.",
  },
  {
    label: "Tender Library",
    desc: "Past bid documents, boilerplate templates, EMD receipts, performance bonds.",
  },
  {
    label: "AI Outputs & Reports",
    desc: "Generated bid letters, analysis exports, strategic tender reports.",
  },
];

// ── Main page ─────────────────────────────────────────────────────────────────

type Filter = "All" | Category;
const FILTERS: Filter[] = ["All", ...CATEGORIES];

export default function Documents() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<Filter>("All");
  const [showUpload, setShowUpload] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Real-time document list
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "user_documents"), where("userId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocRecord));
        rows.sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0));
        setDocs(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [user]);

  const handleUpload = async (
    file: File,
    category: Category,
    onProgress: (p: number) => void
  ): Promise<void> => {
    if (!user) throw new Error("Not authenticated");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `users/${user.uid}/documents/${Date.now()}_${safeName}`;
    const fileRef = storageRef(storage, path);
    const task = uploadBytesResumable(fileRef, file);

    return new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) =>
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        (err) => {
          toast.error("Upload failed: " + err.message);
          reject(err);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(task.snapshot.ref);
            await addDoc(collection(db, "user_documents"), {
              userId: user.uid,
              name: file.name,
              category,
              size: file.size,
              uploadedAt: serverTimestamp(),
              storagePath: path,
              downloadURL,
              fileType: getExt(file.name),
            });
            toast.success(`"${file.name}" uploaded.`);
            resolve();
          } catch (err: any) {
            toast.error("Failed to save document record.");
            reject(err);
          }
        }
      );
    });
  };

  const handleDelete = async (d: DocRecord) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    setDeleting(d.id);
    try {
      try {
        await deleteObject(storageRef(storage, d.storagePath));
      } catch {
        // Storage file may already be gone — proceed anyway
      }
      await deleteDoc(doc(db, "user_documents", d.id));
      toast.success("Document deleted.");
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (d: DocRecord) => {
    const a = document.createElement("a");
    a.href = d.downloadURL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  // Filtered + searched list
  const filtered = docs.filter((d) => {
    const matchCat = activeFilter === "All" || d.category === activeFilter;
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="px-4 py-6 md:p-8 w-full max-w-7xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Document Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Securely store and organise all your tender documents.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-semibold text-sm shadow-sm transition-colors shrink-0 self-start sm:self-auto"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      {/* ── Help banner ── */}
      {showHelp && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-900 mb-2">What can I store here?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {VAULT_TYPES.map(({ label, desc }) => (
                <div key={label}>
                  <p className="text-xs font-bold text-indigo-700">{label}</p>
                  <p className="text-xs text-indigo-600/80 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            className="text-indigo-300 hover:text-indigo-600 shrink-0 self-start transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Filters + Search ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Category pills */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activeFilter === f
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
              }`}
            >
              {f}
              {f !== "All" && (
                <span className={`text-[10px] ${activeFilter === f ? "opacity-70" : "opacity-50"}`}>
                  {docs.filter((d) => d.category === f).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative sm:ml-auto w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full pl-9 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>

      ) : filtered.length === 0 ? (
        /* Empty state */
        <div className="bg-white rounded-xl border border-slate-200 py-16 flex flex-col items-center gap-4 text-center px-6">
          <FolderOpen className="w-14 h-14 text-slate-200" />
          {docs.length === 0 ? (
            <>
              <div>
                <p className="font-semibold text-slate-600">No documents yet</p>
                <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                  Upload your compliance certificates, financial statements, and tender
                  templates to keep everything in one place.
                </p>
              </div>
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload your first document
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="font-semibold text-slate-600">No documents match your search</p>
                <p className="text-sm text-slate-400 mt-1">Try a different filter or search term.</p>
              </div>
              <button
                onClick={() => { setSearch(""); setActiveFilter("All"); }}
                className="text-sm text-indigo-600 hover:underline font-medium"
              >
                Clear filters
              </button>
            </>
          )}
        </div>

      ) : (
        /* Document table */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Desktop column headers */}
          <div className="hidden md:grid grid-cols-[2.5rem_1fr_9rem_5.5rem_8rem_7rem] gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <div />
            <div>Name</div>
            <div>Category</div>
            <div>Size</div>
            <div>Uploaded</div>
            <div className="text-right">Actions</div>
          </div>

          <div className="divide-y divide-slate-100">
            {filtered.map((d) => {
              const isDeleting = deleting === d.id;
              return (
                <div
                  key={d.id}
                  className="group flex md:grid md:grid-cols-[2.5rem_1fr_9rem_5.5rem_8rem_7rem] gap-3 md:gap-4 items-start md:items-center px-5 py-4 hover:bg-slate-50 transition-colors"
                >
                  {/* File icon */}
                  <div className="mt-0.5 md:mt-0">
                    <FileIcon ext={d.fileType} size={5} />
                  </div>

                  {/* Name + mobile meta */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold text-slate-800 truncate leading-snug"
                      title={d.name}
                    >
                      {d.name}
                    </p>
                    {/* Mobile-only meta row */}
                    <div className="flex flex-wrap items-center gap-2 mt-1 md:hidden">
                      <CatBadge cat={d.category} />
                      <span className="text-xs text-slate-400">{formatBytes(d.size)}</span>
                      <span className="text-xs text-slate-400">{formatDate(d.uploadedAt)}</span>
                    </div>
                  </div>

                  {/* Category — desktop only */}
                  <div className="hidden md:flex items-center">
                    <CatBadge cat={d.category} />
                  </div>

                  {/* Size — desktop only */}
                  <div className="hidden md:block text-sm text-slate-500">
                    {formatBytes(d.size)}
                  </div>

                  {/* Date — desktop only */}
                  <div className="hidden md:block text-sm text-slate-500">
                    {formatDate(d.uploadedAt)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 md:justify-end shrink-0 mt-0.5 md:mt-0">
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 text-slate-300 animate-spin mx-2" />
                    ) : (
                      <>
                        <button
                          onClick={() => handleDownload(d)}
                          title="Download"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(d)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          title="More options"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Table footer */}
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
            {filtered.length} document{filtered.length !== 1 ? "s" : ""}
            {(activeFilter !== "All" || search) && ` (filtered from ${docs.length} total)`}
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
}
