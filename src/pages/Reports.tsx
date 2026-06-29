import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Activity, BarChart3, TrendingUp, TrendingDown, Target, Building2, CheckCircle2, Clock } from 'lucide-react';

export default function Reports() {
  const { user } = useAuth();
  
  if (!user) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Bid Intelligence & Reports</h1>
        <p className="text-slate-500 mt-1">Detailed performance analytics and tender success forecasting.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Win Rate Projection</span>
             <Target className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">42%</p>
          <span className="text-xs text-green-600 font-medium flex items-center gap-1"><TrendingUp className="w-3 h-3" /> +5% this quarter</span>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Competitive Advantage</span>
             <BarChart3 className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">High</p>
          <span className="text-xs text-slate-500">Based on MSME status & experience</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
           <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Tenders Processed</span>
             <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">14</p>
          <span className="text-xs text-slate-500 font-medium">L1 match rate: 30%</span>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
           <div className="flex items-center justify-between text-slate-500">
             <span className="font-medium text-sm">Total Bid Value</span>
             <Building2 className="w-5 h-5 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900">₹4.2 Cr</p>
          <span className="text-xs text-slate-500 font-medium">Estimated project values</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-96 flex items-center justify-center flex-col gap-4 text-center">
            <Activity className="w-16 h-16 text-slate-200" />
            <div>
              <h3 className="font-semibold text-slate-900">Financial Growth Forecast</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">Visualizations for your bidding history and projected revenue are being prepared. This requires a connected data source or sufficient bid history.</p>
            </div>
            <button className="mt-2 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-colors">
               Connect Data Sources
            </button>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-96 overflow-y-auto">
            <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-4 mb-4">Recent Milestones</h3>
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
              {/* Timeline Item 1 */}
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-indigo-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                   <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between space-x-2 mb-1">
                    <div className="font-bold text-slate-900 text-sm">GeM Profile Configured</div>
                    <time className="text-xs text-slate-500">2 days ago</time>
                  </div>
                  <div className="text-slate-500 text-xs text-balance">Successfully analyzed and indexed 4 categories for your MSME registration.</div>
                </div>
              </div>

               {/* Timeline Item 2 */}
               <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-200 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                   <Clock className="w-5 h-5" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between space-x-2 mb-1">
                    <div className="font-bold text-slate-900 text-sm">Tender ID: IND-8821 Analysis</div>
                    <time className="text-xs text-slate-500">Pending</time>
                  </div>
                  <div className="text-slate-500 text-xs text-balance">Awaiting final financial review before EMD payment deadline.</div>
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
