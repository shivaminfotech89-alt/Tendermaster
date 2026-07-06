import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Activity, BarChart3, TrendingUp, TrendingDown, Target, Building2, CheckCircle2, Clock } from 'lucide-react';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useNavigate } from 'react-router-dom';

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tenders, setTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    
    const fetchTenders = async () => {
      try {
        const q = query(collection(db, "saved_tenders"), where("userId", "==", user.uid));
        const snapshot = await getDocs(q);
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs.sort((a, b) => (b as any).savedAt?.toMillis() - (a as any).savedAt?.toMillis());
        setTenders(docs);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchTenders();
  }, [user]);

  if (!user) return null;

  // Compute stats
  const totalProcessed = tenders.length;
  let totalBidValue = 0;
  let avgWinProb = 0;
  let l1Matches = 0;

  tenders.forEach(t => {
     // Extract total bid value roughly if possible, otherwise rely on revenue state if we had it
     const val = t.revenue || t.details?.financial_estimate?.total_estimated_cost;
     if (typeof val === 'number') totalBidValue += val;
     else if (typeof val === 'string') {
        const num = parseInt(val.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) totalBidValue += num;
     }

     if (t.details?.winning_probability?.score) {
         avgWinProb += t.details.winning_probability.score;
     }
     
     if (t.details?.compatibility?.score >= 80) l1Matches++;
  });

  if (totalProcessed > 0) {
      avgWinProb = Math.round(avgWinProb / totalProcessed);
  }

  const formatCurrency = (val: number) => {
     if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
     if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`;
     return `₹${val.toLocaleString()}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Bid Intelligence & Reports</h1>
        <p className="text-slate-500 mt-1">Detailed performance analytics and tender-wise success forecasting.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Avg Win Rate</span>
             <Target className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{avgWinProb}%</p>
          <span className="text-xs text-green-600 font-medium flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Average across projects</span>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Competitive Advantage</span>
             <BarChart3 className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{l1Matches > 0 ? 'High' : 'Moderate'}</p>
          <span className="text-xs text-slate-500">Based on L1 matches</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
           <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Tenders Processed</span>
             <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{totalProcessed}</p>
          <span className="text-xs text-slate-500 font-medium">L1 match rate: {totalProcessed > 0 ? Math.round((l1Matches/totalProcessed)*100) : 0}%</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
           <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Total Bid Value</span>
             <Building2 className="w-5 h-5 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{formatCurrency(totalBidValue)}</p>
          <span className="text-xs text-slate-500 font-medium">Estimated project values</span>
        </div>
      </div>
      
      <div className="mt-8">
        <h3 className="font-bold text-xl text-slate-900 mb-4">Tender-Wise Reports</h3>
        {loading ? (
            <div className="p-12 flex justify-center"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>
        ) : tenders.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-xl border border-slate-200">
               <Activity className="w-12 h-12 text-slate-300 mx-auto mb-4" />
               <p className="text-slate-500">No tenders analyzed yet. Save projects to see them here.</p>
            </div>
        ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
               <div className="overflow-x-auto">
                 <table className="w-full text-left text-sm border-collapse">
                   <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                       <th className="p-4 pl-6">Project Name</th>
                       <th className="p-4">Estimated Value</th>
                       <th className="p-4">Target Bid</th>
                       <th className="p-4">Projected Margin</th>
                       <th className="p-4">Win Prob</th>
                       <th className="p-4 pr-6 text-right">View</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                      {tenders.map(t => {
                         const val = t.revenue || t.details?.financial_estimate?.total_estimated_cost || t.details?.tender_simplified?.tender_value || 'N/A';
                         const estVal = typeof val === 'number' ? formatCurrency(val) : val;
                         const targetBid = t.details?.bid_recommendation?.recommended || '-';
                         
                         let marginDisplay = t.details?.bid_recommendation?.margin_range || '-';
                         if (t.revenue && t.materials && t.labour) {
                            const expenseTotal = t.materials.reduce((a:any, m:any) => a + (m.cost_num || 0), 0) + t.labour.reduce((a:any, l:any) => a + (l.cost_num || 0), 0);
                            const profit = t.revenue - expenseTotal;
                            marginDisplay = ((profit / t.revenue) * 100).toFixed(1) + '%';
                         }
                         
                         return (
                        <tr key={t.id} className="hover:bg-slate-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/dashboard/projects/${t.id}`)}>
                           <td className="p-4 pl-6 font-medium text-slate-900 max-w-xs">
                             <div className="line-clamp-2">{t.projectName || "Unnamed Project"}</div>
                             <div className="text-xs text-slate-500 mt-1">{t.details?.tender_simplified?.authority_name}</div>
                           </td>
                           <td className="p-4 text-slate-700">
                             {estVal}
                           </td>
                           <td className="p-4 font-bold text-blue-700">
                             {targetBid}
                           </td>
                           <td className="p-4 font-medium text-slate-700">
                             {marginDisplay}
                           </td>
                           <td className="p-4">
                              <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                 {t.details?.winning_probability?.score || 0}%
                              </span>
                           </td>
                           <td className="p-4 pr-6 text-right">
                             <button className="text-blue-600 hover:text-blue-800 font-medium text-xs uppercase tracking-wider">Details</button>
                           </td>
                        </tr>
                      )})}
                   </tbody>
                 </table>
               </div>
            </div>
        )}
      </div>
    </div>
  );
}
