import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Edit2, Lock, RotateCcw,
} from 'lucide-react';
import type { BOQData, BidSnapshotRow, FinancialValueCandidate } from '../../lib/boq/types';
import { toIndianWords } from '../../lib/boq/indianWords';
import { netBidAmount, calcProfit, getBidWarnings, fmtINR } from '../../lib/boq/calculator';

interface BOQSectionProps {
  analysisResult: any;
  boq: BOQData;
  setBoq: (b: BOQData) => void;
  totalCost: number;
  onRevenueSync: (amount: number) => void;
  // Optional — ProjectDetails only
  onFinalize?: (data: Omit<BidSnapshotRow, 'id' | 'createdAt' | 'createdBy' | 'version'>) => Promise<void>;
  snapshots?: BidSnapshotRow[];
  snapshotsLoading?: boolean;
}

const INR_RE = /₹?\s*[\d,]+(?:\.\d+)?/;

function parseRaw(raw: string): number | null {
  const s = raw.replace(/[₹,\s]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-IN');
}

function snapDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN');
}

export default function BOQSection({
  analysisResult, boq, setBoq, totalCost,
  onRevenueSync, onFinalize, snapshots = [], snapshotsLoading = false,
}: BOQSectionProps) {
  // ── Local UI state ─────────────────────────────────────────────────────────
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const candidates: FinancialValueCandidate[] =
    boq.financialCandidates ?? analysisResult?.boq_details?.financial_values ?? [];
  const suggestedIdx: number =
    boq.suggestedCandidateIndex ??
    analysisResult?.boq_details?.suggested_estimated_index ?? 0;

  // ── Auto-init BOQ type and candidates from fresh analysis ─────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    const bd = analysisResult?.boq_details;
    if (!bd) return;
    initializedRef.current = true;

    const rawCandidates: FinancialValueCandidate[] = (bd.financial_values ?? []).map((v: any) => ({
      label: v.label ?? '',
      valueRaw: v.value_raw ?? '',
      valueNumber: v.value_number ?? 0,
      page: v.page,
      clause: v.clause,
      sourceText: v.source_text,
    }));

    setBoq({
      ...boq,
      // Only auto-set type if the user hasn't already chosen
      boqType:
        boq.boqType === 'unknown' && bd.boq_type_confidence === 'high'
          ? bd.boq_type
          : boq.boqType,
      boqTypeConfidence: bd.boq_type_confidence,
      financialCandidates: rawCandidates,
      suggestedCandidateIndex: bd.suggested_estimated_index ?? 0,
      // Pre-fill amount from suggested candidate (still requires confirm)
      estimatedAmount:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmount
          : rawCandidates[bd.suggested_estimated_index ?? 0]?.valueNumber ?? null,
      estimatedAmountPage:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountPage
          : rawCandidates[bd.suggested_estimated_index ?? 0]?.page,
      estimatedAmountClause:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountClause
          : rawCandidates[bd.suggested_estimated_index ?? 0]?.clause,
      estimatedAmountText:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountText
          : rawCandidates[bd.suggested_estimated_index ?? 0]?.sourceText,
    });
    if (selectedCandidateIdx === null) setSelectedCandidateIdx(bd.suggested_estimated_index ?? 0);
  }, [analysisResult]);

  // ── Computed values ────────────────────────────────────────────────────────
  const canCompute =
    boq.estimatedAmountConfirmed &&
    boq.estimatedAmount != null &&
    boq.percentage != null;

  const quotedAmount = canCompute
    ? netBidAmount(boq.estimatedAmount!, boq.percentage!, boq.aboveBelow)
    : null;

  const words = quotedAmount != null ? toIndianWords(quotedAmount) : null;

  const metrics =
    quotedAmount != null && totalCost > 0
      ? calcProfit(quotedAmount, totalCost)
      : null;

  const warnings =
    quotedAmount != null && boq.percentage != null
      ? getBidWarnings(quotedAmount, totalCost, boq.percentage, metrics ?? {
          grossProfit: 0, profitPercent: 0, marginPercent: 0,
        })
      : null;

  // Sync computed values into boq state and parent revenue
  const prevQuotedRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (quotedAmount === prevQuotedRef.current) return;
    prevQuotedRef.current = quotedAmount;
    setBoq({
      ...boq,
      quotedAmount,
      quotedAmountWords: words,
      grossProfit: metrics?.grossProfit ?? null,
      profitPercent: metrics?.profitPercent ?? null,
      marginPercent: metrics?.marginPercent ?? null,
      boqLastChangedAt: Date.now(),
    });
    if (quotedAmount != null) onRevenueSync(quotedAmount);
  }, [quotedAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute metrics when totalCost changes independently
  const prevCostRef = useRef<number>(totalCost);
  useEffect(() => {
    if (totalCost === prevCostRef.current || boq.quotedAmount == null) return;
    prevCostRef.current = totalCost;
    const m = calcProfit(boq.quotedAmount, totalCost);
    setBoq({
      ...boq,
      grossProfit: m.grossProfit,
      profitPercent: m.profitPercent,
      marginPercent: m.marginPercent,
      boqLastChangedAt: Date.now(),
    });
  }, [totalCost]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectCandidate = (idx: number | null) => {
    setSelectedCandidateIdx(idx);
    if (idx === null) {
      // "Enter manually" — clear prefilled amount
      setBoq({ ...boq, estimatedAmount: null, estimatedAmountConfirmed: false, estimatedAmountEdited: false, estimatedAmountPage: undefined, estimatedAmountClause: undefined, estimatedAmountText: undefined });
    } else {
      const c = candidates[idx]!;
      setAmountInput(c.valueNumber.toString());
      setBoq({ ...boq, estimatedAmount: c.valueNumber, estimatedAmountConfirmed: false, estimatedAmountEdited: false, estimatedAmountPage: c.page, estimatedAmountClause: c.clause, estimatedAmountText: c.sourceText });
    }
  };

  const handleAmountInputChange = (v: string) => {
    setAmountInput(v);
    const n = parseFloat(v.replace(/,/g, ''));
    if (isFinite(n)) {
      const orig = selectedCandidateIdx !== null ? (candidates[selectedCandidateIdx]?.valueNumber ?? null) : null;
      setBoq({ ...boq, estimatedAmount: n, estimatedAmountEdited: orig !== null && n !== orig, estimatedAmountConfirmed: false });
    }
  };

  const handleConfirmAmount = () => {
    if (!boq.estimatedAmount) return;
    setBoq({ ...boq, estimatedAmountConfirmed: true, boqLastChangedAt: Date.now() });
    setEditingAmount(false);
  };

  const handleReconfirm = () => {
    setBoq({ ...boq, estimatedAmountConfirmed: false });
    setAmountInput(boq.estimatedAmount?.toString() ?? '');
    setEditingAmount(true);
  };

  const handlePctChange = (v: string) => {
    const n = parseFloat(v);
    const pct = isFinite(n) ? Math.max(0, n) : null;
    setBoq({ ...boq, percentage: pct, boqLastChangedAt: Date.now() });
  };

  const handleFinalize = async () => {
    if (!onFinalize || !canCompute || !quotedAmount || !words) return;
    setFinalizing(true);
    try {
      await onFinalize({
        boqType: boq.boqType,
        estimatedAmount: boq.estimatedAmount!,
        estimatedAmountConfirmed: true,
        estimatedAmountEdited: boq.estimatedAmountEdited,
        estimatedAmountClause: boq.estimatedAmountClause,
        estimatedAmountText: boq.estimatedAmountText,
        aboveBelow: boq.aboveBelow,
        percentage: boq.percentage!,
        quotedAmount,
        quotedAmountWords: words,
        totalCost: totalCost || 0,
        grossProfit: metrics?.grossProfit ?? 0,
        profitPercent: metrics?.profitPercent ?? 0,
        marginPercent: metrics?.marginPercent ?? 0,
        remarks: boq.remarks,
      });
    } finally {
      setFinalizing(false);
    }
  };

  // ── Sub-renders ────────────────────────────────────────────────────────────

  const renderAmountStep = () => {
    if (boq.estimatedAmountConfirmed) {
      return (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-emerald-800">{fmtINR(boq.estimatedAmount!)} Confirmed</span>
            {boq.estimatedAmountClause && (
              <span className="ml-2 text-xs text-emerald-600">{boq.estimatedAmountClause}{boq.estimatedAmountPage ? ` · Page ${boq.estimatedAmountPage}` : ''}</span>
            )}
            {boq.estimatedAmountEdited && (
              <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Edited</span>
            )}
          </div>
          <button onClick={handleReconfirm} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1 shrink-0">
            <RotateCcw className="w-3 h-3" /> Re-confirm
          </button>
        </div>
      );
    }

    const hasMultiple = candidates.length > 1;
    const hasSingle   = candidates.length === 1;
    const hasNone     = candidates.length === 0;

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-800">
              {hasMultiple ? 'Multiple financial values found — select the Estimated Amount Put to Tender' : 'Confirm the Estimated Amount Put to Tender'}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Always confirm before any calculation — a wrong base changes the entire bid.
            </p>
          </div>
        </div>

        {/* Multi-candidate picker */}
        {hasMultiple && (
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <label key={i} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedCandidateIdx === i ? 'bg-white border-amber-400 ring-1 ring-amber-300' : 'bg-amber-50/60 border-amber-200 hover:border-amber-300'}`}>
                <input type="radio" name="candidatePick" checked={selectedCandidateIdx === i} onChange={() => handleSelectCandidate(i)} className="mt-0.5 accent-amber-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{c.valueRaw}</span>
                    <span className="text-xs text-slate-500">{c.label}</span>
                    {i === suggestedIdx && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">Suggested</span>
                    )}
                  </div>
                  {c.sourceText && <p className="text-xs text-slate-500 mt-1 italic truncate">"{c.sourceText}"</p>}
                  {(c.clause || c.page) && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {c.clause}{c.page ? ` · Page ${c.page}` : ''}
                    </p>
                  )}
                </div>
              </label>
            ))}
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedCandidateIdx === null ? 'bg-white border-amber-400 ring-1 ring-amber-300' : 'bg-amber-50/60 border-amber-200 hover:border-amber-300'}`}>
              <input type="radio" name="candidatePick" checked={selectedCandidateIdx === null} onChange={() => handleSelectCandidate(null)} className="accent-amber-500" />
              <span className="text-sm text-slate-600">None of the above — I'll enter the amount manually</span>
            </label>
          </div>
        )}

        {/* Single candidate info */}
        {hasSingle && candidates[0] && (
          <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-1">
            <p className="text-sm font-semibold text-slate-800">{candidates[0].valueRaw} — {candidates[0].label}</p>
            {candidates[0].sourceText && <p className="text-xs text-slate-500 italic">"{candidates[0].sourceText}"</p>}
            {(candidates[0].clause || candidates[0].page) && (
              <p className="text-[10px] text-slate-400">
                {candidates[0].clause}{candidates[0].page ? ` · Page ${candidates[0].page}` : ''}
              </p>
            )}
          </div>
        )}

        {/* Amount input */}
        <div>
          <label className="block text-xs font-semibold text-amber-800 mb-1">
            {hasNone || selectedCandidateIdx === null ? 'Enter Estimated Amount (₹)' : 'Verify Amount (₹)'}
          </label>
          <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-amber-300">
            <span className="text-slate-400 font-bold">₹</span>
            <input
              type="text"
              value={amountInput || (boq.estimatedAmount != null ? boq.estimatedAmount.toString() : '')}
              onChange={e => handleAmountInputChange(e.target.value)}
              placeholder="e.g. 12500000"
              className="flex-1 bg-transparent text-slate-900 font-semibold text-sm outline-none"
            />
          </div>
          {boq.estimatedAmount != null && (
            <p className="text-xs text-amber-700 mt-1">{toIndianWords(boq.estimatedAmount)}</p>
          )}
        </div>

        <button
          onClick={handleConfirmAmount}
          disabled={!boq.estimatedAmount}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Yes, this is the estimated amount put to tender
        </button>
      </div>
    );
  };

  const renderPricingStep = () => {
    if (!boq.estimatedAmountConfirmed) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Step 2 — Bid Percentage</h4>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
            {(['above', 'below'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setBoq({ ...boq, aboveBelow: opt, boqLastChangedAt: Date.now() })}
                className={`px-4 py-2 capitalize transition-colors ${boq.aboveBelow === opt ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-indigo-300">
            <input
              type="number"
              min="0"
              step="0.01"
              value={boq.percentage ?? ''}
              onChange={e => handlePctChange(e.target.value)}
              placeholder="0.00"
              className="w-24 text-slate-900 font-bold text-lg bg-transparent outline-none"
            />
            <span className="text-slate-400 font-bold">%</span>
          </div>
          <span className="text-sm text-slate-500">the Estimated Amount</span>
        </div>

        {warnings?.messages.some(m => m.includes('20%')) && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            {warnings!.messages.find(m => m.includes('20%'))}
          </div>
        )}

        {quotedAmount != null && (
          <div className="bg-slate-50 rounded-lg p-3 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs font-semibold text-slate-500 uppercase">Net Bid Amount</span>
              <span className="text-xl font-black text-slate-900">{fmtINR(quotedAmount)}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{words}</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Remarks (optional)</label>
          <input
            type="text"
            value={boq.remarks}
            onChange={e => setBoq({ ...boq, remarks: e.target.value, boqLastChangedAt: Date.now() })}
            placeholder="Any remarks to include on the bid form"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-300 outline-none"
          />
        </div>
      </div>
    );
  };

  const renderSummaryCard = () => {
    if (!boq.estimatedAmountConfirmed || quotedAmount == null) return null;

    const missingCost = totalCost <= 0;

    const warnColor = warnings?.level === 'red'
      ? 'bg-red-50 border-red-200 text-red-800'
      : warnings?.level === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-emerald-50 border-emerald-200 text-emerald-800';

    const warnIcon = warnings?.level === 'red'
      ? <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
      : warnings?.level === 'amber'
      ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
      : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;

    const warnText = warnings?.messages.length
      ? warnings.messages.join(' · ')
      : 'Healthy margin';

    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="bg-slate-900 px-5 py-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <h4 className="text-sm font-bold text-white uppercase tracking-widest">Financial Summary</h4>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            ['BOQ Type', 'Percentage Rate'],
            ['Estimated Amount', `${fmtINR(boq.estimatedAmount!)} ✓${boq.estimatedAmountClause ? ` · ${boq.estimatedAmountClause}` : ''}${boq.estimatedAmountPage ? ` · Page ${boq.estimatedAmountPage}` : ''}`],
            ['Bid Direction', `${boq.aboveBelow === 'above' ? '↑ Above' : '↓ Below'} Estimated Amount`],
            ['Percentage Quoted', `${boq.percentage}%`],
            ['Final Quoted Amount', fmtINR(quotedAmount)],
            ['Amount in Words', words ?? '—'],
            ...(totalCost > 0 ? [
              ['Total Estimated Cost', fmtINR(totalCost)],
              ['Gross Profit', metrics ? `${fmtINR(metrics.grossProfit)} (${metrics.profitPercent.toFixed(2)}% of quoted)` : '—'],
              ['Margin on Cost', metrics ? `${metrics.marginPercent.toFixed(2)}%` : '—'],
            ] : [['Total Estimated Cost', '— (enter costs in the calculator below)']]),
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[180px_1fr] gap-2 px-5 py-2.5">
              <span className="text-xs font-semibold text-slate-500">{k}</span>
              <span className={`text-sm text-slate-800 ${k === 'Amount in Words' ? 'italic text-xs' : 'font-medium'}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className={`mx-5 my-3 flex items-center gap-2 rounded-lg px-3 py-2 border text-xs font-medium ${warnColor}`}>
          {warnIcon}
          {warnText}
        </div>

        {onFinalize && (
          <div className="px-5 pb-5">
            {missingCost && (
              <p className="text-xs text-amber-700 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Enter your cost estimate below to unlock profit analysis before finalizing.
              </p>
            )}
            <button
              onClick={handleFinalize}
              disabled={finalizing || warnings?.level === 'red'}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {finalizing ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {finalizing ? 'Saving…' : 'Finalize Bid — Lock Snapshot'}
            </button>
            {warnings?.level === 'red' && (
              <p className="text-xs text-red-600 text-center mt-2">Fix the cost error before finalizing.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderHistory = () => {
    if (!onFinalize) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowHistory(h => !h)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
        >
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
            Bid Revisions ({snapshotsLoading ? '…' : snapshots.length})
          </span>
          {showHistory ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {showHistory && (
          <div className="divide-y divide-slate-100">
            {snapshotsLoading ? (
              <p className="text-center text-slate-400 text-sm py-6">Loading…</p>
            ) : snapshots.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-6">No finalized bids yet.</p>
            ) : (
              snapshots.map(s => (
                <div key={s.id} className="px-5 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-800">Version {s.version}</span>
                    <span className="text-xs text-slate-400">{snapDate(s.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
                    <span>{fmtINR(s.quotedAmount)}</span>
                    <span className="capitalize">{s.aboveBelow} {s.percentage}%</span>
                    {s.totalCost > 0 && <span>Margin {s.marginPercent.toFixed(1)}%</span>}
                  </div>
                  <p className="text-[10px] text-slate-400 italic">{s.quotedAmountWords}</p>
                  {s.remarks && <p className="text-xs text-slate-500">"{s.remarks}"</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white">BOQ & Bid Pricing</h3>
            <p className="text-xs text-indigo-200 mt-0.5">Supported: Percentage Rate Tenders · Item Rate and EPC coming later</p>
          </div>
          {analysisResult?.boq_details?.boq_type_confidence && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${analysisResult.boq_details.boq_type_confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {analysisResult.boq_details.boq_type} · {analysisResult.boq_details.boq_type_confidence} conf.
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* BOQ Type selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">BOQ / Contract Type</label>
          <select
            value={boq.boqType}
            onChange={e => setBoq({ ...boq, boqType: e.target.value as any, boqLastChangedAt: Date.now() })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
          >
            <option value="unknown">— Select BOQ type —</option>
            <option value="percentage_rate">Percentage Rate</option>
            <option value="item_rate" disabled>Item Rate (coming soon)</option>
            <option value="lump_sum_epc" disabled>Lump Sum / EPC (coming soon)</option>
            <option value="hybrid" disabled>Hybrid (coming soon)</option>
          </select>
        </div>

        {boq.boqType !== 'percentage_rate' && boq.boqType !== 'unknown' && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
            <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
            {boq.boqType === 'item_rate' ? 'Item Rate' : 'Lump Sum / EPC'} BOQ entry is coming in a future update.
          </div>
        )}

        {boq.boqType === 'percentage_rate' && (
          <>
            {/* Step 1: Confirm amount */}
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-widest">Step 1 — Estimated Amount</p>
              {renderAmountStep()}
            </div>

            {/* Step 2: Pricing */}
            {renderPricingStep()}

            {/* Financial Summary Card */}
            {renderSummaryCard()}

            {/* Revision history */}
            {renderHistory()}
          </>
        )}
      </div>
    </div>
  );
}
