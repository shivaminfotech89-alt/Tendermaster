import React, { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Activity, BarChart3, TrendingUp, TrendingDown, Target, Building2, CheckCircle2, Clock, Calendar, Download, Filter } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

const financialData = [
  { name: 'Jan', bids: 4, won: 1, value: 45 },
  { name: 'Feb', bids: 6, won: 2, value: 80 },
  { name: 'Mar', bids: 8, won: 3, value: 120 },
  { name: 'Apr', bids: 5, won: 2, value: 90 },
  { name: 'May', bids: 9, won: 4, value: 160 },
  { name: 'Jun', bids: 12, won: 5, value: 210 },
  { name: 'Jul', bids: 10, won: 4, value: 190 },
];

const categoryData = [
  { name: 'Infrastructure', value: 400 },
  { name: 'IT Services', value: 300 },
  { name: 'Consulting', value: 200 },
  { name: 'Supply', value: 150 },
];

export default function Reports() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState('6m');
  
  if (!user) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-2 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Bid Intelligence & Reports</h1>
          <p className="text-slate-500 mt-1">Detailed performance analytics and tender success forecasting.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button 
              onClick={() => setTimeRange('3m')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${timeRange === '3m' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              3M
            </button>
            <button 
              onClick={() => setTimeRange('6m')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${timeRange === '6m' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              6M
            </button>
            <button 
              onClick={() => setTimeRange('1y')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${timeRange === '1y' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              1Y
            </button>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 relative overflow-hidden group hover:border-blue-200 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <Target className="w-16 h-16 text-blue-600" />
          </div>
          <div className="flex items-center justify-between text-slate-500 relative z-10">
             <span className="font-semibold text-sm">Win Rate</span>
          </div>
          <div className="flex items-end gap-3 relative z-10">
             <p className="text-4xl font-black text-slate-900">42%</p>
             <span className="text-sm text-emerald-600 font-bold flex items-center gap-1 mb-1 bg-emerald-50 px-2 py-0.5 rounded-full"><TrendingUp className="w-3 h-3" /> +5%</span>
          </div>
          <span className="text-xs text-slate-500 relative z-10">vs previous period (37%)</span>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 relative overflow-hidden group hover:border-indigo-200 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <BarChart3 className="w-16 h-16 text-indigo-600" />
          </div>
          <div className="flex items-center justify-between text-slate-500 relative z-10">
             <span className="font-semibold text-sm">Bids Submitted</span>
          </div>
          <div className="flex items-end gap-3 relative z-10">
             <p className="text-4xl font-black text-slate-900">54</p>
             <span className="text-sm text-emerald-600 font-bold flex items-center gap-1 mb-1 bg-emerald-50 px-2 py-0.5 rounded-full"><TrendingUp className="w-3 h-3" /> 12</span>
          </div>
          <span className="text-xs text-slate-500 relative z-10">14 pending evaluation</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 relative overflow-hidden group hover:border-emerald-200 transition-colors">
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <CheckCircle2 className="w-16 h-16 text-emerald-600" />
          </div>
          <div className="flex items-center justify-between text-slate-500 relative z-10">
             <span className="font-semibold text-sm">Compliance Score</span>
          </div>
          <div className="flex items-end gap-3 relative z-10">
             <p className="text-4xl font-black text-slate-900">98<span className="text-2xl text-slate-400 font-bold">/100</span></p>
          </div>
          <span className="text-xs text-slate-500 relative z-10">Average across technical bids</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2 relative overflow-hidden group hover:border-amber-200 transition-colors">
           <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <Building2 className="w-16 h-16 text-amber-600" />
          </div>
          <div className="flex items-center justify-between text-slate-500 relative z-10">
             <span className="font-semibold text-sm">Pipeline Value</span>
          </div>
          <div className="flex items-end gap-3 relative z-10">
             <p className="text-4xl font-black text-slate-900">₹8.4<span className="text-xl text-slate-500">Cr</span></p>
             <span className="text-sm text-red-500 font-bold flex items-center gap-1 mb-1 bg-red-50 px-2 py-0.5 rounded-full"><TrendingDown className="w-3 h-3" /> -2%</span>
          </div>
          <span className="text-xs text-slate-500 relative z-10">Estimated total project values</span>
        </div>
      </div>
      
      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Bid Volume & Success Over Time</h3>
                <p className="text-sm text-slate-500">Monthly breakdown of submitted vs won tenders</p>
              </div>
            </div>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={financialData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBids" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorWon" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#002b5b" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#002b5b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 500 }}/>
                  <Area type="monotone" dataKey="bids" name="Total Bids" stroke="#94a3b8" strokeWidth={2} fillOpacity={1} fill="url(#colorBids)" />
                  <Area type="monotone" dataKey="won" name="Won Bids" stroke="#002b5b" strokeWidth={3} fillOpacity={1} fill="url(#colorWon)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-slate-900">Bid Distribution</h3>
              <p className="text-sm text-slate-500">By category/sector</p>
            </div>
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 13, fontWeight: 500 }} width={90} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="value" fill="#0ea5e9" radius={[0, 6, 6, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
        </div>
      </div>
      
      {/* Detailed Analytics Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent Tender Outcomes</h3>
            <p className="text-sm text-slate-500">Detailed list of your most recent submissions</p>
          </div>
          <button className="p-2 text-slate-400 hover:text-slate-600 bg-white border border-slate-200 rounded-lg shadow-sm">
            <Filter className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Tender ID / Name</th>
                <th className="px-6 py-4 font-semibold">Submission Date</th>
                <th className="px-6 py-4 font-semibold">Value</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900">PWD/2023/MH/442</div>
                  <div className="text-slate-500 text-xs mt-0.5">Road Construction Phase II</div>
                </td>
                <td className="px-6 py-4 text-slate-600">12 Oct 2023</td>
                <td className="px-6 py-4 font-medium text-slate-700">₹1.2 Cr</td>
                <td className="px-6 py-4">
                  <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold">Evaluated</span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Won (L1)</span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900">GEM/2023/B/4122</div>
                  <div className="text-slate-500 text-xs mt-0.5">IT Hardware Supply</div>
                </td>
                <td className="px-6 py-4 text-slate-600">28 Sep 2023</td>
                <td className="px-6 py-4 font-medium text-slate-700">₹45 L</td>
                <td className="px-6 py-4">
                  <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold">Evaluated</span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-bold text-slate-500">Lost (L3)</span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900">MCD/EN/22-23/09</div>
                  <div className="text-slate-500 text-xs mt-0.5">Street Lighting Maintenance</div>
                </td>
                <td className="px-6 py-4 text-slate-600">15 Sep 2023</td>
                <td className="px-6 py-4 font-medium text-slate-700">₹80 L</td>
                <td className="px-6 py-4">
                  <span className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-xs font-bold">Under Review</span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-medium text-slate-400">-</span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-900">NHAI/HQ/2023/88</div>
                  <div className="text-slate-500 text-xs mt-0.5">Highway Toll Operations</div>
                </td>
                <td className="px-6 py-4 text-slate-600">02 Sep 2023</td>
                <td className="px-6 py-4 font-medium text-slate-700">₹3.5 Cr</td>
                <td className="px-6 py-4">
                  <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-bold">Tech Evaluation</span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-medium text-slate-400">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
