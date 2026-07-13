import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { doc, getDoc, setDoc, collection, query, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Save, Loader2, Info, Sparkles, Crown, Key, Upload, Trash2, ChevronDown, ChevronUp, Plus, X, FileText, CheckCircle } from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "../lib/api";
import { convertPdfToImage } from "../lib/pdfToImage";

const LARGE_FILE_BYTES = 20 * 1024 * 1024;

// ── Collapsible section wrapper ──────────────────────────────────────────────
function ProfileSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div>
          <span className="font-semibold text-slate-800 text-sm">{title}</span>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>
      {open && <div className="p-5 bg-white space-y-5">{children}</div>}
    </div>
  );
}

// ── Field helpers ────────────────────────────────────────────────────────────
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const inputCls =
  "border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full";
const selectCls =
  "border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full bg-white";

// ── Director row type ─────────────────────────────────────────────────────────
interface Director {
  name: string;
  designation: string;
  din: string;
  pan: string;
  residentialAddress: string;
}

const emptyDirector = (): Director => ({
  name: "",
  designation: "",
  din: "",
  pan: "",
  residentialAddress: "",
});

// ── Default profile ───────────────────────────────────────────────────────────
const defaultProfile = {
  // existing
  companyName: "",
  proprietorName: "",
  gstNumber: "",
  panNumber: "",
  udyamNumber: "",
  msmeStatus: "Not Registered",
  companyType: "Proprietorship",
  industryCategory: "",
  products: "",
  services: "",
  keywords: "",
  turnover: "",
  turnoverUnit: "Lakhs",
  experienceYears: "",
  certifications: "",
  majorClients: "",
  letterheadHeader: "",
  letterheadFooter: "",
  letterheadBackgroundImage: "",
  state: "",
  city: "",
  website: "",
  contactDetails: "",
  // new: firm identity
  dateOfIncorporation: "",
  cinLlpin: "",
  // new: contact
  registeredOfficeAddress: "",
  worksAddress: "",
  phone: "",
  fax: "",
  mobile: "",
  email: "",
  // new: statutory
  tanNumber: "",
  esicNumber: "",
  epfNumber: "",
  professionalTaxNumber: "",
  // new: financial
  turnoverYear1Label: "",
  turnoverYear1: "",
  turnoverYear2Label: "",
  turnoverYear2: "",
  turnoverYear3Label: "",
  turnoverYear3: "",
  netWorth: "",
  bankName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  // new: signatory
  authorizedSignatoryName: "",
  authorizedSignatoryDesignation: "",
  authorizedSignatoryDin: "",
  // new: experience
  registrationClass: "",
  vendorRegistrationNumbers: "",
  experienceSummary: "",
};

type ProfileState = typeof defaultProfile;

export default function BusinessProfile() {
  const { user, role, credits } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ProfileState>(defaultProfile);
  const [directors, setDirectors] = useState<Director[]>([]);

  // Track which sections are open (all open by default)
  const [open, setOpen] = useState<Record<string, boolean>>({
    identity: true,
    contact: true,
    statutory: true,
    financial: false,
    directors: false,
    signatory: false,
    activity: true,
    letterhead: false,
  });
  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Auto-fill from documents ───────────────────────────────────────────────
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [reviewData, setReviewData] = useState<Partial<ProfileState> | null>(null);

  // ── Letterhead upload ──────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      let base64Image = "";
      if (file.type === "application/pdf") {
        base64Image = await convertPdfToImage(file);
      } else if (file.type.startsWith("image/")) {
        base64Image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(file);
        });
      } else {
        toast.error("Unsupported file type. Please upload a PDF or an Image.");
        return;
      }
      setProfile((prev) => ({ ...prev, letterheadBackgroundImage: base64Image }));
      toast.success("Letterhead uploaded successfully!");
    } catch (err: any) {
      toast.error("Failed to process file. It may be too large or corrupted.");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      try {
        const docRef = doc(db, "business_profiles", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile((p) => ({
            ...p,
            ...data,
            products: data.products?.join(", ") || "",
            services: data.services?.join(", ") || "",
            keywords: data.keywords?.join(", ") || "",
            turnoverUnit: data.turnoverUnit || "Lakhs",
            certifications: data.certifications?.join(", ") || "",
            majorClients: data.majorClients?.join(", ") || "",
          }));
          if (Array.isArray(data.directors)) setDirectors(data.directors);
        }
      } catch (e) {
        console.error("Failed to load profile", e);
      }
      setLoading(false);
    }
    loadProfile();
  }, [user]);

  const [whatsappNumber, setWhatsappNumber] = useState("7990878248");
  const [upiId, setUpiId] = useState("7990878248@ybl");
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDocs(query(collection(db, "system_settings")));
        snap.forEach((d) => {
          if (d.id === "payments") {
            setWhatsappNumber(d.data().whatsapp_number || "7990878248");
            setUpiId(d.data().upi_id || "7990878248@ybl");
          }
        });
      } catch (e) {}
    };
    fetchSettings();
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const dataToSave = {
        ...profile,
        products: profile.products.split(",").map((s) => s.trim()).filter(Boolean),
        services: profile.services.split(",").map((s) => s.trim()).filter(Boolean),
        keywords: profile.keywords.split(",").map((s) => s.trim()).filter(Boolean),
        certifications: profile.certifications.split(",").map((s) => s.trim()).filter(Boolean),
        majorClients: profile.majorClients.split(",").map((s) => s.trim()).filter(Boolean),
        turnover: Number(profile.turnover) || 0,
        turnoverUnit: profile.turnoverUnit || "Lakhs",
        experienceYears: Number(profile.experienceYears) || 0,
        directors,
      };
      await setDoc(doc(db, "business_profiles", user.uid), dataToSave);
      toast.success("Profile updated successfully!");
    } catch (error) {
      console.error("Failed to save profile", error);
      toast.error("Failed to save profile.");
    }
    setSaving(false);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setProfile((p) => ({ ...p, [e.target.name]: e.target.value }));
  };

  // ── AI Enhance ─────────────────────────────────────────────────────────────
  const handleEnhance = async (field: keyof ProfileState, contextLabel: string) => {
    const val = profile[field];
    if (typeof val !== "string" || val.trim().length < 5) {
      toast.error("Please enter a few words first so the AI has something to enhance.");
      return;
    }
    setEnhancing(field);
    try {
      const response = await fetchWithAuth("/api/enhance-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: val,
          context: `This is the '${contextLabel}' section of a corporate business profile used for bidding on government and private tenders.`,
        }),
      });
      if (!response.ok) throw new Error("Enhancement failed");
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error("A server error occurred. Please try again.");
      }
      setProfile((p) => ({ ...p, [field]: data.enhanced }));
    } catch (err: any) {
      toast.error("Failed to enhance text.");
    } finally {
      setEnhancing(null);
    }
  };

  const enhanceBtn = (field: keyof ProfileState, label: string) => (
    <button
      type="button"
      onClick={() => handleEnhance(field, label)}
      disabled={enhancing === field}
      className="text-xs text-indigo-600 font-semibold flex items-center gap-1 hover:text-indigo-800 disabled:opacity-50 shrink-0"
    >
      {enhancing === field ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Sparkles className="w-3 h-3" />
      )}
      AI Enhance
    </button>
  );

  // ── Directors helpers ──────────────────────────────────────────────────────
  const updateDirector = (idx: number, field: keyof Director, value: string) =>
    setDirectors((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d))
    );

  // ── Extract profile data from uploaded certificates ───────────────────────
  const handleExtract = async () => {
    if (docFiles.length === 0) {
      toast.error("Please upload at least one certificate file.");
      return;
    }
    setExtracting(true);
    try {
      const results = await Promise.all(
        docFiles.map(async (file) => {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });
          const res = await fetchWithAuth("/api/extract-profile-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileBase64: base64, fileMimeType: file.type || "application/pdf" }),
          });
          if (!res.ok) return {};
          const data = await res.json();
          return (data.extracted || {}) as Partial<ProfileState>;
        })
      );

      // Merge: later files fill in gaps; never overwrite with an empty string
      const merged: Partial<ProfileState> = {};
      for (const result of results) {
        for (const [k, v] of Object.entries(result)) {
          if (v && typeof v === "string" && v.trim() !== "") {
            (merged as any)[k] = v.trim();
          }
        }
      }

      const fieldCount = Object.keys(merged).length;
      if (fieldCount === 0) {
        toast.error(
          "Couldn't read any data from the uploaded file(s). Please check the image quality and try again, or enter details manually."
        );
        return;
      }
      setReviewData(merged);
    } catch (err: any) {
      toast.error("Extraction failed: " + err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleApplyExtracted = () => {
    if (!reviewData) return;
    setProfile((p) => ({ ...p, ...reviewData }));
    setReviewData(null);
    setDocFiles([]);
    toast.success(
      `${Object.keys(reviewData).length} field(s) pre-filled — scroll down to verify, then click Save Profile.`
    );
  };

  // ── Activation ────────────────────────────────────────────────────────────
  const handleActivate = async () => {
    if (!activationCode.trim()) return toast.error("Please enter an activation code.");
    if (!user) return;
    setActivating(true);
    try {
      const response = await fetchWithAuth("/api/activate-code", {
        method: "POST",
        body: JSON.stringify({ code: activationCode }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to redeem code");
      }
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error("A server error occurred. Please try again.");
      }
      toast.success(data.message || "Premium activated! Please refresh.");
      setActivationCode("");
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      toast.error("Failed to activate code: " + err.message);
    } finally {
      setActivating(false);
    }
  };

  if (loading)
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );

  const isAdminRole = role === "admin" || role === "superadmin";
  const creditsLeft = credits.total - credits.used;

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("profile")}</h1>
        <p className="text-slate-500 mt-1">
          Configure your corporate identity for accurate AI tender matching and document generation.
        </p>
      </div>

      {/* Credits Status */}
      <div
        className={`mb-8 p-6 rounded-xl border ${
          isAdminRole
            ? "bg-slate-50 border-slate-200"
            : credits.hasCredits
            ? "bg-amber-50 border-amber-200"
            : "bg-rose-50 border-rose-200"
        } shadow-sm`}
      >
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown
                className={`w-6 h-6 ${
                  isAdminRole ? "text-slate-500" : credits.hasCredits ? "text-amber-500" : "text-rose-400"
                }`}
              />
              <h2 className="text-xl font-bold text-slate-900">
                {isAdminRole
                  ? t("superadmin_access")
                  : credits.hasCredits
                  ? `${creditsLeft} Credit${creditsLeft !== 1 ? "s" : ""} Remaining`
                  : "No Credits Remaining"}
              </h2>
            </div>
            {!isAdminRole && credits.hasCredits && (
              <p className="text-amber-800 text-sm font-medium">
                {credits.used} of {credits.total} used
                {credits.expiry && ` — valid until ${credits.expiry.toLocaleDateString()}`}
              </p>
            )}
            {!isAdminRole && !credits.hasCredits && (
              <div className="mt-2">
                <p className="text-rose-700 text-sm mb-3">
                  You have no credits remaining. Purchase credits to run new analyses and generate documents.
                </p>
                <Link
                  to="/dashboard/settings?tab=subscription"
                  className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  Buy Credits
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activation Code */}
      <div className="mb-8 bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-bold text-slate-800">Activation Code</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={activationCode}
            onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
            placeholder="Enter activation code"
            className={inputCls + " flex-1 font-mono tracking-wider"}
          />
          <button
            type="button"
            onClick={handleActivate}
            disabled={activating}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Activate
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-blue-800 mb-8 items-start">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm">
          <strong>Why is this important?</strong> The AI engine uses all fields below when
          auto-generating tender documents — the more you fill in, the fewer blanks appear in
          generated forms. Fields marked <span className="text-red-500 font-bold">*</span> are
          essential; all others are optional but improve output quality.
        </p>
      </div>

      {/* ── Auto-fill from documents ──────────────────────────────────── */}
      <div className="bg-white border border-indigo-200 rounded-xl shadow-sm overflow-hidden mb-4">
        <div className="p-5 border-b border-indigo-100 bg-indigo-50/60 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-indigo-900">Auto-fill from Documents</h2>
            <p className="text-xs text-indigo-700/70 mt-0.5">
              Upload certificates (GST, PAN, Udyam, CoI, etc.) — AI will read the details and pre-fill the form for you to review.
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Review panel — shown after extraction */}
          {reviewData ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                <span>
                  Found <strong>{Object.keys(reviewData).length} field(s)</strong>. Verify and correct below, then click <strong>Apply to Profile</strong>.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(
                  [
                    ["companyName", "Company Name"],
                    ["gstNumber", "GST Number"],
                    ["panNumber", "PAN Number"],
                    ["tanNumber", "TAN Number"],
                    ["udyamNumber", "Udyam / MSME Number"],
                    ["msmeStatus", "MSME Category"],
                    ["cinLlpin", "CIN / LLPIN"],
                    ["dateOfIncorporation", "Date of Incorporation"],
                    ["registeredOfficeAddress", "Registered Office Address"],
                    ["worksAddress", "Works Address"],
                    ["phone", "Phone"],
                    ["mobile", "Mobile"],
                    ["fax", "Fax"],
                    ["email", "Email"],
                    ["website", "Website"],
                    ["esicNumber", "ESIC Number"],
                    ["epfNumber", "EPF / PF Number"],
                    ["professionalTaxNumber", "Professional Tax Number"],
                    ["bankName", "Bank Name"],
                    ["bankAccountNumber", "Bank Account Number"],
                    ["bankIfsc", "IFSC Code"],
                    ["authorizedSignatoryName", "Signatory Name"],
                    ["authorizedSignatoryDesignation", "Signatory Designation"],
                    ["authorizedSignatoryDin", "Signatory DIN"],
                  ] as [keyof ProfileState, string][]
                )
                  .filter(([key]) => key in reviewData)
                  .map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-600">{label}</label>
                      <input
                        value={(reviewData[key] as string) ?? ""}
                        onChange={(e) =>
                          setReviewData((prev) => prev ? { ...prev, [key]: e.target.value } : prev)
                        }
                        className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  ))}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setReviewData(null)}
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-300 rounded-lg px-4 py-2 transition-colors"
                >
                  <X className="w-4 h-4" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyExtracted}
                  className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-5 py-2 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" /> Apply to Profile
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Upload zone */}
              {docFiles.length === 0 ? (
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-indigo-300 rounded-xl cursor-pointer bg-indigo-50/30 hover:bg-indigo-50 transition-colors">
                  <div className="flex flex-col items-center gap-1.5">
                    <Upload className="w-6 h-6 text-indigo-400" />
                    <span className="text-sm font-medium text-indigo-700">Click to upload certificates</span>
                    <span className="text-xs text-slate-400">PDF or image • multiple files allowed • max 20 MB each</span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      const tooBig = files.filter((f) => f.size > LARGE_FILE_BYTES);
                      if (tooBig.length > 0) {
                        toast.error(`${tooBig.map((f) => f.name).join(", ")} — over 20 MB, skipped.`);
                      }
                      const ok = files.filter((f) => f.size <= LARGE_FILE_BYTES);
                      if (ok.length > 0) setDocFiles((prev) => [...prev, ...ok]);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <div className="space-y-3">
                  {/* File chips */}
                  <div className="flex flex-wrap gap-2">
                    {docFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 text-xs text-indigo-800"
                      >
                        <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="max-w-[160px] truncate font-medium">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setDocFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-indigo-400 hover:text-red-500 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {/* Add more files */}
                    <label className="flex items-center gap-1.5 bg-white border border-dashed border-indigo-300 rounded-lg px-3 py-1.5 text-xs text-indigo-600 cursor-pointer hover:bg-indigo-50 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Add more
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          const ok = files.filter((f) => {
                            if (f.size > LARGE_FILE_BYTES) {
                              toast.error(`${f.name} is over 20 MB — skipped.`);
                              return false;
                            }
                            return true;
                          });
                          if (ok.length > 0) setDocFiles((prev) => [...prev, ...ok]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  {/* Extract button */}
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={extracting}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition-colors"
                  >
                    {extracting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {extracting
                      ? `Extracting from ${docFiles.length} file(s)…`
                      : `Extract & Pre-fill Profile`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        {/* ── 1. Firm Identity ──────────────────────────────────────────── */}
        <ProfileSection
          title="1. Firm Identity"
          subtitle="Legal name, constitution, and registration identifiers"
          open={open.identity}
          onToggle={() => toggle("identity")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Company / Firm Name" required>
              <input
                name="companyName"
                value={profile.companyName}
                onChange={handleChange}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Proprietor / Director Name">
              <input
                name="proprietorName"
                value={profile.proprietorName}
                onChange={handleChange}
                className={inputCls}
              />
            </Field>
            <Field label="Legal Constitution">
              <select
                name="companyType"
                value={profile.companyType}
                onChange={handleChange}
                className={selectCls}
              >
                <option>Proprietorship</option>
                <option>Partnership</option>
                <option>LLP</option>
                <option>Private Limited</option>
                <option>Public Limited</option>
              </select>
            </Field>
            <Field label="Date of Incorporation">
              <input
                type="date"
                name="dateOfIncorporation"
                value={profile.dateOfIncorporation}
                onChange={handleChange}
                className={inputCls}
              />
            </Field>
            <Field label="CIN / LLPIN" hint="Corporate Identity Number or LLP Identification Number">
              <input
                name="cinLlpin"
                value={profile.cinLlpin}
                onChange={handleChange}
                className={inputCls}
                placeholder="U12345XX2020PTC123456"
              />
            </Field>
            <Field label="Industry Category" required>
              <input
                name="industryCategory"
                value={profile.industryCategory}
                onChange={handleChange}
                className={inputCls}
                placeholder="e.g., IT Services, Civil Construction"
                required
              />
            </Field>
          </div>
        </ProfileSection>

        {/* ── 2. Contact Details ────────────────────────────────────────── */}
        <ProfileSection
          title="2. Contact Details"
          subtitle="Registered address, communication details"
          open={open.contact}
          onToggle={() => toggle("contact")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Registered Office Address" hint="Full address as per incorporation">
              <textarea
                name="registeredOfficeAddress"
                value={profile.registeredOfficeAddress}
                onChange={handleChange}
                rows={3}
                className={inputCls}
                placeholder="Plot No., Street, Area, City, State – PIN"
              />
            </Field>
            <Field label="Works / Operational Address" hint="Leave blank if same as registered">
              <textarea
                name="worksAddress"
                value={profile.worksAddress}
                onChange={handleChange}
                rows={3}
                className={inputCls}
                placeholder="Plot No., Street, Area, City, State – PIN"
              />
            </Field>
            <Field label="State">
              <input
                name="state"
                value={profile.state}
                onChange={handleChange}
                className={inputCls}
                placeholder="e.g., Gujarat, Maharashtra"
              />
            </Field>
            <Field label="City">
              <input
                name="city"
                value={profile.city}
                onChange={handleChange}
                className={inputCls}
              />
            </Field>
            <Field label="Phone (Landline)">
              <input
                name="phone"
                value={profile.phone}
                onChange={handleChange}
                className={inputCls}
                placeholder="0261-2XXXXXX"
              />
            </Field>
            <Field label="Fax">
              <input
                name="fax"
                value={profile.fax}
                onChange={handleChange}
                className={inputCls}
                placeholder="0261-2XXXXXX"
              />
            </Field>
            <Field label="Mobile">
              <input
                name="mobile"
                value={profile.mobile}
                onChange={handleChange}
                className={inputCls}
                placeholder="+91 XXXXX XXXXX"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                name="email"
                value={profile.email}
                onChange={handleChange}
                className={inputCls}
                placeholder="contact@company.com"
              />
            </Field>
            <Field label="Website">
              <input
                name="website"
                value={profile.website}
                onChange={handleChange}
                className={inputCls}
                placeholder="https://www.company.com"
              />
            </Field>
            <Field label="Other Contact Details">
              <input
                name="contactDetails"
                value={profile.contactDetails}
                onChange={handleChange}
                className={inputCls}
                placeholder="WhatsApp, helpdesk number, etc."
              />
            </Field>
          </div>
        </ProfileSection>

        {/* ── 3. Statutory & Tax ────────────────────────────────────────── */}
        <ProfileSection
          title="3. Statutory & Tax"
          subtitle="GST, PAN, TAN, MSME, ESIC, EPF registrations"
          open={open.statutory}
          onToggle={() => toggle("statutory")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="GST Number" required>
              <input
                name="gstNumber"
                value={profile.gstNumber}
                onChange={handleChange}
                className={inputCls + " uppercase"}
                placeholder="22AAAAA0000A1Z5"
                required
              />
            </Field>
            <Field label="PAN Number" required>
              <input
                name="panNumber"
                value={profile.panNumber}
                onChange={handleChange}
                className={inputCls + " uppercase"}
                placeholder="AAAAA0000A"
                required
              />
            </Field>
            <Field label="TAN Number" hint="Tax Deduction Account Number">
              <input
                name="tanNumber"
                value={profile.tanNumber}
                onChange={handleChange}
                className={inputCls + " uppercase"}
                placeholder="ABCD12345E"
              />
            </Field>
            <Field label="Udyam / MSME Registration Number">
              <input
                name="udyamNumber"
                value={profile.udyamNumber}
                onChange={handleChange}
                className={inputCls}
                placeholder="UDYAM-XX-XX-XXXXXXX"
              />
            </Field>
            <Field label="MSME Category">
              <select
                name="msmeStatus"
                value={profile.msmeStatus}
                onChange={handleChange}
                className={selectCls}
              >
                <option>Not Registered</option>
                <option>Micro</option>
                <option>Small</option>
                <option>Medium</option>
              </select>
            </Field>
            <Field label="ESIC Number" hint="Employee State Insurance Corporation">
              <input
                name="esicNumber"
                value={profile.esicNumber}
                onChange={handleChange}
                className={inputCls}
                placeholder="ESIC Employer Code"
              />
            </Field>
            <Field label="EPF / PF Number" hint="Employees' Provident Fund">
              <input
                name="epfNumber"
                value={profile.epfNumber}
                onChange={handleChange}
                className={inputCls}
                placeholder="GGNXX0000000000"
              />
            </Field>
            <Field label="Professional Tax Number">
              <input
                name="professionalTaxNumber"
                value={profile.professionalTaxNumber}
                onChange={handleChange}
                className={inputCls}
              />
            </Field>
          </div>
        </ProfileSection>

        {/* ── 4. Financial Details ──────────────────────────────────────── */}
        <ProfileSection
          title="4. Financial Details"
          subtitle="Turnover (last 3 years), net worth, bank details"
          open={open.financial}
          onToggle={() => toggle("financial")}
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Enter turnover for each of the last 3 financial years. These values are used in bid
              documents and financial eligibility declarations.
            </p>
            {/* Turnover table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="grid grid-cols-2 gap-0 bg-slate-50 border-b border-slate-200 px-4 py-2">
                <span className="text-xs font-semibold text-slate-500 uppercase">Financial Year</span>
                <span className="text-xs font-semibold text-slate-500 uppercase">Turnover (₹ Lakhs)</span>
              </div>
              {[
                { labelField: "turnoverYear1Label", valueField: "turnoverYear1", placeholder: "e.g. 2023-24" },
                { labelField: "turnoverYear2Label", valueField: "turnoverYear2", placeholder: "e.g. 2022-23" },
                { labelField: "turnoverYear3Label", valueField: "turnoverYear3", placeholder: "e.g. 2021-22" },
              ].map(({ labelField, valueField, placeholder }, i) => (
                <div
                  key={i}
                  className="grid grid-cols-2 gap-0 border-b last:border-b-0 border-slate-100"
                >
                  <div className="px-3 py-2 border-r border-slate-100">
                    <input
                      name={labelField}
                      value={(profile as any)[labelField]}
                      onChange={handleChange}
                      className="w-full text-sm outline-none bg-transparent text-slate-700"
                      placeholder={placeholder}
                    />
                  </div>
                  <div className="px-3 py-2">
                    <input
                      name={valueField}
                      value={(profile as any)[valueField]}
                      onChange={handleChange}
                      className="w-full text-sm outline-none bg-transparent text-slate-700"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-2">
              <Field label="Net Worth (₹ Lakhs)">
                <input
                  name="netWorth"
                  value={profile.netWorth}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Bank Name">
                <input
                  name="bankName"
                  value={profile.bankName}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="State Bank of India"
                />
              </Field>
              <Field label="Bank Account Number">
                <input
                  name="bankAccountNumber"
                  value={profile.bankAccountNumber}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="XXXXXXXXXXXXXXXX"
                />
              </Field>
              <Field label="IFSC Code">
                <input
                  name="bankIfsc"
                  value={profile.bankIfsc}
                  onChange={handleChange}
                  className={inputCls + " uppercase"}
                  placeholder="SBIN0001234"
                />
              </Field>
            </div>
          </div>
        </ProfileSection>

        {/* ── 5. Directors / Partners ───────────────────────────────────── */}
        <ProfileSection
          title="5. Directors / Partners"
          subtitle="Repeatable entries for each director, partner, or proprietor"
          open={open.directors}
          onToggle={() => toggle("directors")}
        >
          <div className="space-y-4">
            {directors.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">
                No directors/partners added yet.
              </p>
            )}
            {directors.map((dir, idx) => (
              <div
                key={idx}
                className="border border-slate-200 rounded-lg p-4 space-y-4 relative bg-slate-50/50"
              >
                <button
                  type="button"
                  onClick={() => setDirectors((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                  title="Remove"
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Director / Partner {idx + 1}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Full Name">
                    <input
                      value={dir.name}
                      onChange={(e) => updateDirector(idx, "name", e.target.value)}
                      className={inputCls}
                      placeholder="As per PAN / DIN"
                    />
                  </Field>
                  <Field label="Designation">
                    <input
                      value={dir.designation}
                      onChange={(e) => updateDirector(idx, "designation", e.target.value)}
                      className={inputCls}
                      placeholder="Director / Partner / Proprietor"
                    />
                  </Field>
                  <Field label="DIN" hint="Director Identification Number">
                    <input
                      value={dir.din}
                      onChange={(e) => updateDirector(idx, "din", e.target.value)}
                      className={inputCls}
                      placeholder="00000000"
                    />
                  </Field>
                  <Field label="PAN">
                    <input
                      value={dir.pan}
                      onChange={(e) => updateDirector(idx, "pan", e.target.value)}
                      className={inputCls + " uppercase"}
                      placeholder="AAAAA0000A"
                    />
                  </Field>
                  <Field label="Residential Address" hint="Optional — required by some tenders">
                    <textarea
                      value={dir.residentialAddress}
                      onChange={(e) => updateDirector(idx, "residentialAddress", e.target.value)}
                      rows={2}
                      className={inputCls}
                      placeholder="Full residential address"
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDirectors((prev) => [...prev, emptyDirector()])}
              className="flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-300 rounded-lg px-4 py-2 w-full justify-center hover:bg-indigo-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Director / Partner
            </button>
          </div>
        </ProfileSection>

        {/* ── 6. Authorized Signatory ───────────────────────────────────── */}
        <ProfileSection
          title="6. Authorized Signatory"
          subtitle="Person authorized to sign tender documents"
          open={open.signatory}
          onToggle={() => toggle("signatory")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Name">
              <input
                name="authorizedSignatoryName"
                value={profile.authorizedSignatoryName}
                onChange={handleChange}
                className={inputCls}
                placeholder="Full name as per authorization"
              />
            </Field>
            <Field label="Designation">
              <input
                name="authorizedSignatoryDesignation"
                value={profile.authorizedSignatoryDesignation}
                onChange={handleChange}
                className={inputCls}
                placeholder="Managing Director, CEO, Partner, etc."
              />
            </Field>
            <Field label="DIN" hint="Director Identification Number (if applicable)">
              <input
                name="authorizedSignatoryDin"
                value={profile.authorizedSignatoryDin}
                onChange={handleChange}
                className={inputCls}
                placeholder="00000000"
              />
            </Field>
          </div>
        </ProfileSection>

        {/* ── 7. Business Activity & Experience ────────────────────────── */}
        <ProfileSection
          title="7. Business Activity & Experience"
          subtitle="Products, services, keywords, certifications, and registration details"
          open={open.activity}
          onToggle={() => toggle("activity")}
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Products <span className="text-slate-400 font-normal">(comma separated)</span>
                </label>
                {enhanceBtn("products", "Products")}
              </div>
              <textarea
                name="products"
                value={profile.products}
                onChange={handleChange}
                rows={2}
                className={inputCls}
                placeholder="e.g., Laptops, Office Furniture, Medical Supplies"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Services <span className="text-slate-400 font-normal">(comma separated)</span>
                </label>
                {enhanceBtn("services", "Services")}
              </div>
              <textarea
                name="services"
                value={profile.services}
                onChange={handleChange}
                rows={2}
                className={inputCls}
                placeholder="e.g., Software Development, Facility Management, Manpower Supply"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Key Focus Areas / Keywords
                  <span className="text-slate-400 font-normal"> (comma separated)</span>
                </label>
                {enhanceBtn("keywords", "Key Focus Areas / Keywords")}
              </div>
              <textarea
                name="keywords"
                value={profile.keywords}
                onChange={handleChange}
                rows={3}
                className={inputCls}
                placeholder="e.g., Smart City Projects, Government IT infra, Biometric Systems"
              />
              <p className="text-xs text-slate-400">Crucial for matching against tender scope of work.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Years of Business / Experience">
                <input
                  type="number"
                  name="experienceYears"
                  value={profile.experienceYears}
                  onChange={handleChange}
                  className={inputCls}
                  min="0"
                />
              </Field>
              <Field
                label="Registration Class / Category"
                hint="Class-I Contractor, Cat-A, etc."
              >
                <input
                  name="registrationClass"
                  value={profile.registrationClass}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="e.g., Class-I Electrical Contractor"
                />
              </Field>
              <Field
                label="Vendor / Contractor Registration Numbers"
                hint="GFR, CPWD, PWD, GeM seller ID, etc."
              >
                <input
                  name="vendorRegistrationNumbers"
                  value={profile.vendorRegistrationNumbers}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="GeM Seller: XXXXXXX, CPWD: YYYY"
                />
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Certifications
                  <span className="text-slate-400 font-normal"> (comma separated)</span>
                </label>
                {enhanceBtn("certifications", "Certifications")}
              </div>
              <textarea
                name="certifications"
                value={profile.certifications}
                onChange={handleChange}
                rows={2}
                className={inputCls}
                placeholder="e.g., ISO 9001, CMMI Level 3, Startup India Recognized"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Major Clients / Past Work
                  <span className="text-slate-400 font-normal"> (comma separated)</span>
                </label>
                {enhanceBtn("majorClients", "Major Clients / Past Work")}
              </div>
              <textarea
                name="majorClients"
                value={profile.majorClients}
                onChange={handleChange}
                rows={2}
                className={inputCls}
                placeholder="e.g., ONGC, BHEL, State Transport Department"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-slate-700">
                  Relevant Experience Summary
                </label>
                {enhanceBtn("experienceSummary", "Relevant Experience Summary")}
              </div>
              <textarea
                name="experienceSummary"
                value={profile.experienceSummary}
                onChange={handleChange}
                rows={4}
                className={inputCls}
                placeholder="Brief narrative of your firm's relevant experience for tender submissions…"
              />
            </div>
          </div>
        </ProfileSection>

        {/* ── 8. Letterhead Settings ────────────────────────────────────── */}
        <ProfileSection
          title="8. Letterhead Settings"
          subtitle="Upload or configure the letterhead used when printing generated documents"
          open={open.letterhead}
          onToggle={() => toggle("letterhead")}
        >
          <div className="space-y-6">
            <div>
              <label className="text-sm font-semibold text-slate-700 block mb-3 pb-2 border-b">
                Option 1: Upload Letterhead (PDF or Image)
              </label>
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    {uploadingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {uploadingImage ? "Processing..." : "Upload Letterhead PDF / Image"}
                  </button>
                  <p className="text-xs text-slate-500 mt-2">
                    Uploading a PDF converts the first page to a high-quality image background for
                    printing.
                  </p>
                </div>
                {profile.letterheadBackgroundImage && (
                  <div className="w-24 h-32 border border-slate-200 rounded overflow-hidden bg-slate-50 flex items-center justify-center relative group">
                    <img
                      src={profile.letterheadBackgroundImage}
                      alt="Letterhead"
                      className="max-w-full max-h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setProfile((prev) => ({ ...prev, letterheadBackgroundImage: "" }))
                      }
                      className="absolute inset-0 bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-5 h-5 mb-1" />
                      <span className="text-[10px] font-medium">Remove</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="h-px bg-slate-200 flex-1" />
              <span className="text-xs font-semibold text-slate-400 uppercase">OR</span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>

            <div className="space-y-4">
              <label className="text-sm font-semibold text-slate-700 block pb-2 border-b">
                Option 2: Text / HTML Header & Footer
              </label>
              <Field label="Letterhead Header (HTML / Text)">
                <textarea
                  name="letterheadHeader"
                  value={profile.letterheadHeader || ""}
                  onChange={handleChange}
                  rows={4}
                  className={inputCls + " font-mono text-xs"}
                  placeholder="<div style='text-align:center; border-bottom: 2px solid black; padding-bottom: 10px;'><h1>YOUR COMPANY NAME</h1><p>123 Business Road, City, State - ZIP</p></div>"
                />
              </Field>
              <Field label="Letterhead Footer (HTML / Text)">
                <textarea
                  name="letterheadFooter"
                  value={profile.letterheadFooter || ""}
                  onChange={handleChange}
                  rows={4}
                  className={inputCls + " font-mono text-xs"}
                  placeholder="<div style='text-align:center; border-top: 1px solid black; padding-top: 10px;'><p>Contact: +91 9999999999 | Email: contact@company.com</p></div>"
                />
              </Field>
            </div>
          </div>
        </ProfileSection>

        {/* ── Save button ───────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-2.5 rounded-lg font-semibold shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
}
