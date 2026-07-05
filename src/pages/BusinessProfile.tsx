import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Save, Loader2, Info, Sparkles, Crown, Key, Upload, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "../lib/api";
import { convertPdfToImage } from "../lib/pdfToImage";

export default function BusinessProfile() {
  const { user, role, subscriptionExpiry } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [enhancing, setEnhancing] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      
      setProfile(prev => ({ ...prev, letterheadBackgroundImage: base64Image }));
      toast.success("Letterhead uploaded successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to process file. It may be too large or corrupted.");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const [profile, setProfile] = useState({
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
    majorClients: "", letterheadHeader: "", letterheadFooter: "", letterheadBackgroundImage: "",
    state: "",
    city: "",
    website: "",
    contactDetails: "",
  });

  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      try {
        const docRef = doc(db, "business_profiles", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile(p => ({
             ...p, 
             ...data,
             products: data.products?.join(", ") || "",
             services: data.services?.join(", ") || "",
             keywords: data.keywords?.join(", ") || "",
             turnoverUnit: data.turnoverUnit || "Lakhs",
             certifications: data.certifications?.join(", ") || "",
             majorClients: data.majorClients?.join(", ") || "",
          }));
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
        snap.forEach(d => {
          if (d.id === "payments") {
            setWhatsappNumber(d.data().whatsapp_number || "7990878248");
            setUpiId(d.data().upi_id || "7990878248@ybl");
          }
        });
      } catch (e) {}
    };
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const dataToSave = {
        ...profile,
        products: profile.products.split(",").map(s => s.trim()).filter(Boolean),
        services: profile.services.split(",").map(s => s.trim()).filter(Boolean),
        keywords: profile.keywords.split(",").map(s => s.trim()).filter(Boolean),
        certifications: profile.certifications.split(",").map(s => s.trim()).filter(Boolean),
        majorClients: profile.majorClients.split(",").map(s => s.trim()).filter(Boolean),
        turnover: Number(profile.turnover) || 0,
        turnoverUnit: profile.turnoverUnit || "Lakhs",
        experienceYears: Number(profile.experienceYears) || 0,
      };
      await setDoc(doc(db, "business_profiles", user.uid), dataToSave);
      toast.success("Profile updated successfully!");
    } catch (error) {
      console.error("Failed to save profile", error);
      toast.error("Failed to save profile.");
    }
    setSaving(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setProfile(p => ({ ...p, [e.target.name]: e.target.value }));
  };

  const handleEnhance = async (field: keyof typeof profile, contextLabel: string) => {
     if (!profile[field] || profile[field].trim().length < 5) {
        toast.error("Please enter a few words first so the AI has something to enhance.");
        return;
     }
     
     setEnhancing(field);
     try {
       const response = await fetchWithAuth("/api/enhance-text", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           text: profile[field],
           context: `This is the '${contextLabel}' section of a corporate business profile used for bidding on government and private tenders.`
         })
       });
       
       if (!response.ok) throw new Error("Enhancement failed");
       const data = await response.json();
       
       setProfile(p => ({ ...p, [field]: data.enhanced }));
     } catch (err: any) {
       console.error("AI Enhance Error:", err);
       toast.error("Failed to enhance text.");
     } finally {
       setEnhancing(null);
     }
  };

  const handleActivate = async () => {
    if (!activationCode.trim()) return toast.error("Please enter an activation code.");
    if (!user) return;
    
    setActivating(true);
    try {
      const response = await fetchWithAuth("/api/activate-code", {
        method: "POST",
        body: JSON.stringify({ code: activationCode })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to redeem code");
      }
      
      const data = await response.json();
      if (data.success && data.newExpiry) {
        const { doc, updateDoc, Timestamp } = await import('firebase/firestore');
        const { db } = await import('../lib/firebase');
        if (user) {
          await updateDoc(doc(db, 'users', user.uid), {
            role: 'premium',
            subscriptionExpiry: Timestamp.fromDate(new Date(data.newExpiry))
          });
        }
      }
      toast.success(data.message || "Premium activated! Please refresh.");
      setActivationCode("");
      setTimeout(() => {
         window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to activate code: " + err.message);
    } finally {
      setActivating(false);
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>;

  const daysRemaining = subscriptionExpiry ? Math.max(0, Math.ceil((subscriptionExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))) : 0;

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("profile")}</h1>
        <p className="text-slate-500 mt-1">Configure your corporate identity for accurate AI tender matching.</p>
      </div>

      {/* Subscription Status Block */}
      <div className={`mb-8 p-6 rounded-xl border ${role === 'premium' || role === 'superadmin' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'} shadow-sm`}>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className={`w-6 h-6 ${role === 'premium' || role === 'superadmin' ? 'text-amber-500' : 'text-slate-400'}`} />
              <h2 className="text-xl font-bold text-slate-900">
                {role === 'superadmin' ? t("superadmin_access") : role === 'premium' ? t("premium_plan") : t("free_plan")}
              </h2>
            </div>
            {role === 'premium' && (
              <p className="text-amber-800 text-sm font-medium">
                {t("days_remaining")}: <span className="font-bold">{daysRemaining}</span>
              </p>
            )}
            {role === 'free' && (
              <div className="mt-2">
                <p className="text-slate-600 text-sm mb-3">
                  {t("upgrade_to_premium")} to unlock full AI analysis, unlimited chats, and automatic document generation.
                </p>
                <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm text-sm">
                  <h4 className="font-bold text-slate-800 mb-2">How to upgrade:</h4>
                  <p className="text-slate-600">Please visit the Settings page to select a plan and upgrade your account.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-blue-800 mb-8 items-start">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm shadow-sm">
          <strong>Why is this important?</strong> The TenderMaster AI engine uses this data to cross-reference against complex eligibility criteria. Ensure your GST, turnover, and keywords accurately represent your latest operations.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 md:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Company Name</label>
               <input name="companyName" value={profile.companyName} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Proprietor / Director Name</label>
               <input name="proprietorName" value={profile.proprietorName} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>

            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Company Type</label>
               <select name="companyType" value={profile.companyType} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none">
                 <option>Proprietorship</option>
                 <option>Partnership</option>
                 <option>LLP</option>
                 <option>Private Limited</option>
                 <option>Public Limited</option>
               </select>
            </div>
            
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Industry Category</label>
               <input name="industryCategory" value={profile.industryCategory} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., IT Services, Civil Construction" required />
            </div>

            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">GST Number</label>
               <input name="gstNumber" value={profile.gstNumber} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none uppercase" />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">PAN Number</label>
               <input name="panNumber" value={profile.panNumber} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none uppercase" />
            </div>

            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">UDYAM Registration (MSME)</label>
               <input name="udyamNumber" value={profile.udyamNumber} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="UDYAM-XX-XX-XXXX" />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">MSME Status</label>
               <select name="msmeStatus" value={profile.msmeStatus} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none">
                 <option>Not Registered</option>
                 <option>Micro</option>
                 <option>Small</option>
                 <option>Medium</option>
               </select>
            </div>
            
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Annual Turnover</label>
               <div className="flex gap-2">
                 <input name="turnover" type="number" value={profile.turnover} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none flex-1" min="0" placeholder="Amount" />
                 <select name="turnoverUnit" value={profile.turnoverUnit} onChange={handleChange} className="border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 outline-none">
                   <option value="Lakhs">Lakhs</option>
                   <option value="Crores">Crores</option>
                 </select>
               </div>
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">Years of Experience</label>
               <input name="experienceYears" type="number" value={profile.experienceYears} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" min="0" />
            </div>

            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">State</label>
               <input name="state" value={profile.state} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g., Gujarat, Maharashtra" />
            </div>
            <div className="flex flex-col gap-2">
               <label className="text-sm font-semibold text-slate-700">City</label>
               <input name="city" value={profile.city} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>

          <div className="h-px bg-slate-200 my-4" />

          <div className="space-y-6">
            <div className="flex flex-col gap-2 relative group">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-semibold text-slate-700">Products (comma separated)</label>
                 <button type="button" onClick={() => handleEnhance('products', 'Products')} disabled={enhancing === 'products'} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-800 disabled:opacity-50">
                   {enhancing === 'products' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Enhance
                 </button>
               </div>
               <textarea name="products" value={profile.products} onChange={handleChange} rows={2} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., Laptops, Office Furniture, Medical Supplies" />
            </div>
            <div className="flex flex-col gap-2 relative group">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-semibold text-slate-700">Services (comma separated)</label>
                 <button type="button" onClick={() => handleEnhance('services', 'Services')} disabled={enhancing === 'services'} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-800 disabled:opacity-50">
                   {enhancing === 'services' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Enhance
                 </button>
               </div>
               <textarea name="services" value={profile.services} onChange={handleChange} rows={2} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., Software Development, Facility Management, Manpower Supply" />
            </div>
            <div className="flex flex-col gap-2 relative group">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-semibold text-slate-700">Key Focus Areas / Keywords (comma separated)</label>
                 <button type="button" onClick={() => handleEnhance('keywords', 'Key Focus Areas / Keywords')} disabled={enhancing === 'keywords'} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-800 disabled:opacity-50">
                   {enhancing === 'keywords' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Enhance
                 </button>
               </div>
               <textarea name="keywords" value={profile.keywords} onChange={handleChange} rows={3} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., Smart City Projects, Government IT infra, Biometric Systems" />
               <p className="text-xs text-slate-500">Crucial for matching against tender scope of work.</p>
            </div>
            <div className="flex flex-col gap-2">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-semibold text-slate-700">Certifications (comma separated)</label>
                 <button type="button" onClick={() => handleEnhance('certifications', 'Certifications')} disabled={enhancing === 'certifications'} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-800 disabled:opacity-50">
                   {enhancing === 'certifications' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Enhance
                 </button>
               </div>
               <textarea name="certifications" value={profile.certifications} onChange={handleChange} rows={2} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., ISO 9001, CMMI Level 3, Startup India Recognized" />
            </div>
            <div className="flex flex-col gap-2">
               <div className="flex justify-between items-center">
                 <label className="text-sm font-semibold text-slate-700">Major Clients / Past Work (comma separated)</label>
                 <button type="button" onClick={() => handleEnhance('majorClients', 'Major Clients / Past Work')} disabled={enhancing === 'majorClients'} className="text-xs text-blue-600 font-semibold flex items-center gap-1 hover:text-blue-800 disabled:opacity-50">
                   {enhancing === 'majorClients' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Enhance
                 </button>
               </div>
               <textarea name="majorClients" value={profile.majorClients} onChange={handleChange} rows={2} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400" placeholder="e.g., ONGC, BHEL, State Transport Department" />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-xl font-bold text-slate-800">Custom Letterhead Settings</h2>
            <p className="text-slate-500 text-sm mt-1">Configure your organization's letterhead to automatically apply when printing auto-generated tender drafts. You can either upload a PDF/Image of your existing letterhead, or type HTML/Text.</p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-4 md:col-span-2">
              <label className="text-sm font-semibold text-slate-700 border-b pb-2">Option 1: Upload Letterhead (PDF or Image)</label>
              
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
                     {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                     {uploadingImage ? "Processing..." : "Upload Letterhead PDF / Image"}
                   </button>
                   <p className="text-xs text-slate-500 mt-2">Uploading a PDF will convert the first page to a high-quality image background for printing.</p>
                </div>
                
                {(profile as any).letterheadBackgroundImage && (
                  <div className="w-24 h-32 border border-slate-200 rounded overflow-hidden bg-slate-50 flex items-center justify-center relative group">
                    <img src={(profile as any).letterheadBackgroundImage} alt="Letterhead" className="max-w-full max-h-full object-contain" />
                    <button 
                      type="button" 
                      onClick={() => setProfile(prev => ({ ...prev, letterheadBackgroundImage: "" }))}
                      className="absolute inset-0 bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-5 h-5 mb-1" />
                      <span className="text-[10px] font-medium">Remove</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="col-span-2">
              <div className="flex items-center gap-4 my-2">
                <div className="h-px bg-slate-200 flex-1"></div>
                <span className="text-xs font-semibold text-slate-400 uppercase">OR</span>
                <div className="h-px bg-slate-200 flex-1"></div>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
               <label className="text-sm font-semibold text-slate-700 border-b pb-2">Option 2: Text / HTML Header & Footer</label>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2 mt-[-10px]">
               <label className="text-xs font-semibold text-slate-600">Letterhead Header (HTML / Text)</label>
               <textarea name="letterheadHeader" value={profile.letterheadHeader || ""} onChange={handleChange} rows={4} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-mono text-xs" placeholder="<div style='text-align:center; border-bottom: 2px solid black; padding-bottom: 10px;'><h1>YOUR COMPANY NAME</h1><p>123 Business Road, City, State - ZIP</p></div>" />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
               <label className="text-xs font-semibold text-slate-600">Letterhead Footer (HTML / Text)</label>
               <textarea name="letterheadFooter" value={profile.letterheadFooter || ""} onChange={handleChange} rows={4} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-mono text-xs" placeholder="<div style='text-align:center; border-top: 1px solid black; padding-top: 10px;'><p>Contact: +91 9999999999 | Email: contact@company.com</p></div>" />
            </div>
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-6 flex justify-end">
          <button 
             type="submit" 
             disabled={saving}
             className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-lg font-semibold shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
}
