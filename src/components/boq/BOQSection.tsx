import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Edit2, Lock, RotateCcw,
} from 'lucide-react';
import type { BOQData, BidSnapshotRow, FinancialValueCandidate } from '../../lib/boq/types';
import { toIndianWords } from '../../lib/boq/indianWords';
import { netBidAmount, calcProfit, getBidWarnings, fmtINR } from '../../lib/boq/calculator';
import { detectBoqTypeFromAnalysis } from '../../lib/boq/detectBoqType';

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
  const [finalizing, setFinalizing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => {
    try { return localStorage.getItem('boq-section-expanded') !== 'false'; }
    catch { return true; }
  });
  const handleToggle = () => setIsExpanded(prev => {
    const next = !prev;
    try { localStorage.setItem('boq-section-expanded', String(next)); } catch {}
    return next;
  });

  const candidates: FinancialValueCandidate[] =
    boq.financialCandidates ?? analysisResult?.boq_details?.financial_values ?? [];
  const suggestedIdx: number =
    boq.suggestedCandidateIndex ??
    analysisResult?.boq_details?.suggested_estimated_index ?? 0;

  // ── Auto-init BOQ type and candidates from fresh analysis ─────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (!analysisResult) return;
    initializedRef.current = true;

    // API may return boq_details in future; fall back to client-side detection today
    const bd = (analysisResult as any)?.boq_details;

    const rawCandidates: FinancialValueCandidate[] = (bd?.financial_values ?? []).map((v: any) => ({
      label: v.label ?? '',
      valueRaw: v.value_raw ?? '',
      valueNumber: v.value_number ?? 0,
      page: v.page,
      clause: v.clause,
      sourceText: v.source_text,
    }));

    // When the API returns no boq_details (current state), preserve whatever candidates
    // and amount were already loaded from Firestore. Without this guard, re-initialising
    // with an empty rawCandidates array clears the pre-filled amount and disables the
    // confirm button even though the candidates are already visible on screen.
    const effectiveCandidates = rawCandidates.length > 0
      ? rawCandidates
      : (boq.financialCandidates ?? []);
    const effectiveIdx = rawCandidates.length > 0
      ? (bd?.suggested_estimated_index ?? 0)
      : (boq.suggestedCandidateIndex ?? 0);

    // Determine BOQ type: API field (future) > client detection > leave as-is.
    // Only auto-set on HIGH confidence to prevent false positives (e.g. Annual Rate Contract
    // tenders sharing generic "above the estimated amount" language).
    let detectedType = boq.boqType;
    let detectedConf = boq.boqTypeConfidence;
    let detectedReason = boq.boqTypeReason;
    let detectedScore  = boq.boqTypeScore;
    if (boq.boqType === 'unknown') {
      if (bd?.boq_type && bd?.boq_type_confidence === 'high') {
        detectedType   = bd.boq_type;
        detectedConf   = bd.boq_type_confidence;
      } else {
        const clientDetection = detectBoqTypeFromAnalysis(analysisResult);
        // Analysis-text detection is capped at LOW — never auto-selects; used only as a hint.
        if (clientDetection.confidence === 'high') {
          detectedType   = clientDetection.type;
          detectedConf   = clientDetection.confidence;
          detectedReason = clientDetection.reason;
          detectedScore  = clientDetection.score;
        }
      }
    }

    setBoq({
      ...boq,
      boqType: detectedType,
      boqTypeConfidence: detectedConf,
      boqTypeReason: detectedReason,
      boqTypeScore: detectedScore,
      financialCandidates: effectiveCandidates,
      suggestedCandidateIndex: effectiveIdx,
      // Pre-fill amount from suggested candidate (still requires confirm).
      // Falls back to the already-loaded boq.estimatedAmount so a 0/absent
      // valueNumber from the API never clears a valid saved amount.
      estimatedAmount:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmount
          : effectiveCandidates[effectiveIdx]?.valueNumber || boq.estimatedAmount || null,
      estimatedAmountPage:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountPage
          : effectiveCandidates[effectiveIdx]?.page ?? boq.estimatedAmountPage,
      estimatedAmountClause:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountClause
          : effectiveCandidates[effectiveIdx]?.clause ?? boq.estimatedAmountClause,
      estimatedAmountText:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountText
          : effectiveCandidates[effectiveIdx]?.sourceText ?? boq.estimatedAmountText,
    });
    // Pre-fill the amount input so the simplified single-field UI shows the suggested value.
    if (!boq.estimatedAmountConfirmed && !amountInput) {
      const prefilledAmount =
        effectiveCandidates[effectiveIdx]?.valueNumber || boq.estimatedAmount;
      if (prefilledAmount) setAmountInput(String(prefilledAmount));
    }
  }, [analysisResult]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAmountInputChange = (v: string) => {
    setAmountInput(v);
    const n = parseFloat(v.replace(/,/g, ''));
    if (isFinite(n)) {
      const orig = candidates[suggestedIdx]?.valueNumber ?? null;
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

    const suggested = candidates[suggestedIdx];
    const sourceNote = suggested
      ? suggested.page
        ? `Pre-filled from page ${suggested.page}${suggested.clause ? ` (${suggested.clause})` : ''} — verify against the tender document`
        : suggested.clause
        ? `Pre-filled from ${suggested.clause} — verify against the tender document`
        : suggested.label
        ? `Pre-filled from detected value — verify against the tender document`
        : null
      : null;

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-800">Estimated Amount Put to Tender (₹)</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Confirm before any calculation — a wrong base changes the entire bid.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-amber-300">
            <span className="text-slate-400 font-bold text-sm">₹</span>
            <input
              type="text"
              value={amountInput || (boq.estimatedAmount != null ? boq.estimatedAmount.toString() : '')}
              onChange={e => handleAmountInputChange(e.target.value)}
              placeholder="Type the amount here"
              className="flex-1 bg-transparent text-slate-900 font-semibold text-sm outline-none"
            />
          </div>
          {sourceNote && (
            <p className="text-[11px] text-amber-600 mt-1.5 italic">{sourceNote}</p>
          )}
          {boq.estimatedAmount != null && (
            <p className="text-xs text-amber-700 mt-1">{toIndianWords(boq.estimatedAmount)}</p>
          )}
        </div>

        <button
          onClick={handleConfirmAmount}
          disabled={!boq.estimatedAmount}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Confirm Estimated Amount
        </button>
        {!boq.estimatedAmount && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Type the amount above, then click to confirm
          </p>
        )}
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
      </div>
    );
  };

  // Always renders in the percentage_rate flow; disabled with reason when prereqs unmet.
  const renderFinalizeButton = () => {
    let disabledReason: string | null = null;
    if (!boq.estimatedAmountConfirmed) {
      disabledReason = 'Confirm the estimated amount to finalise';
    } else if (boq.percentage == null) {
      disabledReason = 'Enter your bid percentage to finalise';
    } else if (!onFinalize) {
      disabledReason = 'Save as a project to lock bid snapshots';
    } else if (warnings?.level === 'red') {
      disabledReason = 'Fix the cost error before finalizing';
    }
    const isDisabled = finalizing || disabledReason !== null;

    return (
      <div className="space-y-2">
        {onFinalize && totalCost <= 0 && !disabledReason && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Enter your cost estimate below to unlock profit analysis before finalizing.
          </p>
        )}
        <button
          onClick={handleFinalize}
          disabled={isDisabled}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {finalizing
            ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            : <Lock className="w-4 h-4" />}
          {finalizing ? 'Saving…' : 'Finalize Bid — Lock Snapshot'}
        </button>
        {disabledReason && !finalizing && (
          <p className="text-xs text-slate-500 text-center">{disabledReason}</p>
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
      {/* Header — click to collapse / expand */}
      <div
        className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-5 py-4 cursor-pointer select-none"
        onClick={handleToggle}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white">BOQ & Bid Pricing</h3>
            <p className="text-xs text-indigo-200 mt-0.5">Supported: Percentage Rate Tenders · Item Rate and EPC coming later</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {boq.boqType !== 'unknown' && boq.boqTypeConfidence && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${boq.boqTypeConfidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                title={boq.boqTypeReason}
              >
                {boq.boqType === 'percentage_rate' ? 'Percentage Rate'
                  : boq.boqType === 'item_rate' ? 'Item Rate'
                  : boq.boqType === 'lump_sum_epc' ? 'Lump Sum / EPC'
                  : boq.boqType}
                {boq.boqTypeScore != null
                  ? ` · ✓ Auto-detected (${boq.boqTypeScore}%)`
                  : ` · ${boq.boqTypeConfidence} conf.`}
              </span>
            )}
            {isExpanded
              ? <ChevronDown className="w-4 h-4 text-indigo-200" />
              : <ChevronRight className="w-4 h-4 text-indigo-200" />}
          </div>
        </div>
      </div>

      {isExpanded && (
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

          {import.meta.env.DEV && (
            <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] font-mono text-slate-500 break-all">
              {boq.boqTypeReason
                ? `Detection: ${boq.boqTypeReason}`
                : analysisResult
                ? `Detection (not auto-set — capped low from AI text): ${detectBoqTypeFromAnalysis(analysisResult).reason}`
                : 'Detection: waiting for analysis result'}
            </div>
          )}

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

              {/* Finalize button — always visible in percentage_rate flow */}
              {renderFinalizeButton()}

              {/* Revision history */}
              {renderHistory()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
