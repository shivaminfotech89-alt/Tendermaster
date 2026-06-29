import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Save, Loader2, Info, Sparkles } from "lucide-react";
import { toast } from "react-hot-toast";

export default function BusinessProfile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState<string | null>(null);
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
    experienceYears: "",
    certifications: "",
    majorClients: "",
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
       const response = await fetch("/api/enhance-text", {
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

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>;

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Business Profile</h1>
        <p className="text-slate-500 mt-1">Configure your corporate identity for accurate AI tender matching.</p>
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
               <label className="text-sm font-semibold text-slate-700">Annual Turnover (INR in Lakhs)</label>
               <input name="turnover" type="number" value={profile.turnover} onChange={handleChange} className="border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" min="0" />
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
