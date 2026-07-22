import { useState, useEffect, useMemo, useCallback } from "react";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { BoqItem } from "../../types/boq";
import type { BOQType, BOQData } from "../../lib/boq/types";
import * as XLSX from "xlsx";
import {
  Loader2, AlertCircle, Search, Download, ArrowRight,
  ChevronDown, ChevronUp, RefreshCw, FileText, Sparkles, XCircle, Check,
} from "lucide-react";
import BoqPricingGrid, { type EditableField, type PricingGridLabels } from "./BoqPricingGrid";
import usePricingAutosave from "../../hooks/usePricingAutosave";
import {
  buildPricingKeys, findDuplicateItemNos, validateItemPricing,
  computeQuotedAmount, sumItemRateTotals,
} from "../../lib/boq/itemPricing";

type ExtractionStatus = 'loading' | 'running' | 'done' | 'failed' | 'no_boq_found' | 'not_attempted';
type SortField = 'itemNo' | 'amount' | 'quantity';
type SortDir = 'asc' | 'desc';

// If status is 'running' and startedAt is older than this, treat as stale immediately.
const STALE_MS = 5 * 60_000;
// If status is 'running' and startedAt is recent, time out after this.
const BOQ_TIMEOUT_MS = 60_000;

interface BOQMeta {
  itemCount: number;
  totalAmount: number;
  engine: string;
  visionUsed: boolean;
  verificationScore: number;
  parserDurationMs: number;
}

interface BOQViewerProps {
  projectId: string;
  onProceedToPricing: () => void;
  /** Re-runs BOQ extraction. Must write status updates to Firestore so the
   *  onSnapshot listener updates the viewer automatically. */
  onManualExtract?: () => Promise<void>;
  /** When 'item_rate' or 'lump_sum_epc', the item table becomes an editable
   *  pricing grid (relabeled "Package"/"Package Price" for lump sum). */
  boqType?: BOQType;
  /** Full BOQ pricing state, read-only here — used to render the
   *  percentage-rate summary strip (Estimated Amount / % / Final Bid Amount)
   *  without recomputing anything BOQSection already computes. */
  boq?: BOQData;
  /** Fired whenever the per-item pricing grid's aggregate totals change, so
   *  the caller can feed them into the shared BOQData/BOQSection pipeline
   *  the same way percentage-rate bids already populate quotedAmount. */
  onItemRateTotalsChange?: (estimatedAmount: number, quotedAmount: number) => void;
}

const GRID_LABELS: Record<'item_rate' | 'lump_sum_epc', PricingGridLabels> = {
  item_rate: { entityLabel: 'Item No', rateLabel: 'Quoted Rate' },
  lump_sum_epc: { entityLabel: 'Package', rateLabel: 'Package Price' },
};

function fmtIndian(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30 inline" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 inline" />
    : <ChevronDown className="w-3 h-3 inline" />;
}

function humaniseReason(raw: string): string {
  if (/download|fetch|cors|network|http \d{3}/i.test(raw)) return "Couldn't download the tender PDF.";
  if (/permission|unauthorized|insufficient/i.test(raw)) return "Permission denied. Please try signing out and back in.";
  if (/timeout|timed out|stale|previous session/i.test(raw)) return "The extraction did not complete. Click Retry to try again.";
  return raw;
}

// Extract milliseconds from a Firestore Timestamp or plain {seconds, nanoseconds} object.
function getStartedAtMs(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis() as number;
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return null;
}

function ErrorUI({
  title,
  reason,
  onRetry,
  retrying,
  retryLabel = 'Retry',
}: {
  title: string;
  reason: string;
  onRetry: () => void;
  retrying?: boolean;
  retryLabel?: string;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <AlertCircle className="w-10 h-10 text-rose-400" />
      <div className="text-center">
        <p className="font-semibold text-slate-700">{title}</p>
        {reason && (
          <p className="text-sm text-slate-500 mt-1 max-w-md">{humaniseReason(reason)}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRetry}
          disabled={retrying}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
          {retryLabel}
        </button>
        {reason && (
          <button
            onClick={() => setShowDetails(v => !v)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        )}
      </div>
      {showDetails && (
        <pre className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-3 max-w-md w-full overflow-auto whitespace-pre-wrap">
          {reason}
        </pre>
      )}
    </div>
  );
}

export default function BOQViewer({ projectId, onProceedToPricing, onManualExtract, boqType, boq, onItemRateTotalsChange }: BOQViewerProps) {
  const [status, setStatus] = useState<ExtractionStatus>('loading');
  const [items, setItems] = useState<BoqItem[]>([]);
  const isGridMode = boqType === 'item_rate' || boqType === 'lump_sum_epc';
  const gridLabels = boqType === 'lump_sum_epc' ? GRID_LABELS.lump_sum_epc : GRID_LABELS.item_rate;
  const { pricing, saveState, updateItem } = usePricingAutosave(isGridMode ? projectId : undefined);
  const [meta, setMeta] = useState<BOQMeta | null>(null);
  const [failReason, setFailReason] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('itemNo');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());
  // startedAtMs: Firestore's startedAt in ms. Used to calculate timeout remaining time
  // and to detect stale-running documents from previous sessions.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  useEffect(() => {
    const latestRef = doc(db, 'saved_tenders', projectId, 'boq_extraction', 'latest');
    const unsub = onSnapshot(
      latestRef,
      (snap) => {
        if (!snap.exists()) {
          setStatus('not_attempted');
          setStartedAtMs(null);
          return;
        }
        const data = snap.data() as any;
        const s = data.status as ExtractionStatus;

        if (s === 'running') {
          const ms = getStartedAtMs(data.startedAt);
          // Stale: extraction started > 5 min ago and never completed — show error immediately.
          if (ms !== null && Date.now() - ms > STALE_MS) {
            console.warn('[BOQViewer] stale running document detected', {
              startedAtMs: ms,
              ageMs: Date.now() - ms,
            });
            setFailReason('Extraction did not complete (stuck from a previous session).');
            setStatus('failed');
            setStartedAtMs(null);
            return;
          }
          setStartedAtMs(ms ?? Date.now());
          // setStatus('running') falls through to the bottom
        } else {
          setStartedAtMs(null);
        }

        setStatus(s);
        if (s === 'done') {
          setItems(data.items ?? []);
          setMeta({
            itemCount: data.itemCount ?? 0,
            totalAmount: data.totalAmount ?? 0,
            engine: data.engine ?? 'deterministic',
            visionUsed: data.visionUsed ?? false,
            verificationScore: data.verificationScore ?? 0,
            parserDurationMs: data.parserDurationMs ?? 0,
          });
        }
        if (s === 'failed') setFailReason(data.reason ?? 'Unknown error');
      },
      (err) => {
        console.error('[BOQViewer] snapshot error', err);
        setStatus('failed');
        setFailReason('Could not load BOQ data: ' + (err.message ?? ''));
        setStartedAtMs(null);
      },
    );
    return () => unsub();
  }, [projectId]);

  // Timeout guard: if status stays 'running', fire after (BOQ_TIMEOUT_MS - elapsed).
  // Depends on startedAtMs so reconnects don't restart the clock from zero.
  useEffect(() => {
    if (status !== 'running') {
      setTimedOut(false);
      return;
    }
    const elapsed = startedAtMs ? Math.max(0, Date.now() - startedAtMs) : 0;
    const remaining = Math.max(1_000, BOQ_TIMEOUT_MS - elapsed);
    console.log('[BOQViewer] timeout guard started', { elapsed, remaining });
    const t = setTimeout(() => {
      console.warn('[BOQViewer] extraction timed out');
      setTimedOut(true);
    }, remaining);
    return () => clearTimeout(t);
  }, [status, startedAtMs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const snap = await getDoc(doc(db, 'saved_tenders', projectId, 'boq_extraction', 'latest'));
      if (!snap.exists()) { setStatus('not_attempted'); return; }
      const data = snap.data() as any;
      const s = data.status as ExtractionStatus;
      setStatus(s);
      if (s === 'done') {
        setItems(data.items ?? []);
        setMeta({
          itemCount: data.itemCount ?? 0,
          totalAmount: data.totalAmount ?? 0,
          engine: data.engine ?? 'deterministic',
          visionUsed: data.visionUsed ?? false,
          verificationScore: data.verificationScore ?? 0,
          parserDurationMs: data.parserDurationMs ?? 0,
        });
      }
      if (s === 'failed') setFailReason(data.reason ?? 'Unknown error');
    } catch (e: any) {
      setStatus('failed');
      setFailReason(e?.message ?? 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleRetryExtraction = async () => {
    if (!onManualExtract) {
      // No extraction function available — just refresh to see latest Firestore state
      handleRefresh();
      return;
    }
    setTimedOut(false);
    setExtractError('');
    setIsExtracting(true);
    // Reset to loading so the spinner shows while extraction rewrites Firestore
    setStatus('loading');
    try {
      await onManualExtract();
      // status transitions via onSnapshot once Firestore is updated
    } catch (err: any) {
      console.error('[BOQViewer] retry extraction failed', err);
      setExtractError(err?.message ?? 'Extraction failed. Please try again.');
      setStatus('failed');
      setFailReason(err?.message ?? 'Extraction failed.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExtractClick = async () => {
    if (!onManualExtract || isExtracting) return;
    await handleRetryExtraction();
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = items.filter(it =>
    !search ||
    it.itemNo.toLowerCase().includes(search.toLowerCase()) ||
    it.description.toLowerCase().includes(search.toLowerCase()),
  );

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'itemNo') {
      const an = parseFloat(a.itemNo) || 0;
      const bn = parseFloat(b.itemNo) || 0;
      cmp = an !== bn ? an - bn : a.itemNo.localeCompare(b.itemNo);
    } else if (sortField === 'amount') {
      cmp = (a.amount ?? 0) - (b.amount ?? 0);
    } else {
      cmp = a.quantity - b.quantity;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleDesc = (id: string) => {
    setExpandedDescs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Item-rate pricing grid wiring ──────────────────────────────────────────

  const pricingKeys = useMemo(() => buildPricingKeys(items), [items]);
  const pricingKeyById = useMemo(
    () => new Map(items.map((item, i) => [item.id, pricingKeys[i]])),
    [items, pricingKeys],
  );
  const duplicateItemNos = useMemo(() => new Set(findDuplicateItemNos(items)), [items]);

  const handlePricingFieldChange = useCallback((key: string, item: BoqItem, field: EditableField, rawValue: string) => {
    const existing = pricing[key];
    const patch: Partial<{ bidRate: number; discountPercent: number; premiumPercent: number; remarks: string; quotedAmount: number }> = {};

    if (field === 'remarks') {
      patch.remarks = rawValue === '' ? undefined : rawValue;
    } else {
      const n = rawValue === '' ? undefined : parseFloat(rawValue);
      patch[field] = n !== undefined && isFinite(n) ? n : undefined;
    }

    const nextBidRate = field === 'bidRate' ? patch.bidRate : existing?.bidRate;
    patch.quotedAmount = computeQuotedAmount(item.quantity, nextBidRate);

    const isDuplicate = duplicateItemNos.has(item.itemNo.trim());
    const validation = validateItemPricing(item, { ...existing, ...patch, validation: { level: 'ok', issues: [] } }, isDuplicate);
    updateItem(key, patch, validation);
  }, [pricing, duplicateItemNos, updateItem]);

  const itemRateTotals = useMemo(
    () => sumItemRateTotals(items, pricing, pricingKeys),
    [items, pricing, pricingKeys],
  );

  useEffect(() => {
    if (!isGridMode || !onItemRateTotalsChange) return;
    // Don't push a bare 0 quotedAmount before any row has a rate — that
    // would falsely make BOQSection think the bid is "computable".
    if (itemRateTotals.pricedItemCount === 0) return;
    onItemRateTotalsChange(itemRateTotals.estimatedAmount, itemRateTotals.quotedAmount);
    // onItemRateTotalsChange intentionally omitted: it's a fresh closure each
    // ProjectDetails render, and this effect should only re-fire when the
    // grid's own totals actually change, not on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGridMode, itemRateTotals.estimatedAmount, itemRateTotals.quotedAmount, itemRateTotals.pricedItemCount]);

  const exportCsv = () => {
    const rows = [
      ['Item No', 'Description', 'Unit', 'Quantity', 'Est. Rate (Rs)', 'Amount (Rs)'],
      ...sorted.map(it => [
        it.itemNo, it.description, it.unit, it.quantity,
        it.estimatedRate ?? '', it.amount ?? '',
      ]),
    ];
    const csv = rows.map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','),
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'boq.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const data = sorted.map(it => ({
      'Item No': it.itemNo,
      'Description': it.description,
      'Unit': it.unit,
      'Quantity': it.quantity,
      'Est. Rate (Rs)': it.estimatedRate ?? '',
      'Amount (Rs)': it.amount ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOQ');
    XLSX.writeFile(wb, 'boq.xlsx');
  };

  // ── Status renders ─────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (status === 'running') {
    if (timedOut) {
      return (
        <ErrorUI
          title="Unable to extract BOQ"
          reason="BOQ extraction timed out."
          onRetry={handleRetryExtraction}
          retrying={isExtracting}
          retryLabel="Retry extraction"
        />
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <p className="font-medium">Extracting BOQ items…</p>
        <p className="text-sm text-slate-400">This may take up to a minute.</p>
        <button
          onClick={() => setTimedOut(true)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mt-2 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Taking too long? Cancel
        </button>
      </div>
    );
  }

  if (status === 'not_attempted') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
        <Search className="w-10 h-10 text-slate-300" />
        <p className="font-semibold text-slate-600">BOQ not yet extracted</p>
        <p className="text-sm text-center max-w-sm text-slate-400">
          This project was analysed before automatic BOQ extraction was available.
        </p>
        {extractError && (
          <p className="text-sm text-rose-600 text-center max-w-sm">{humaniseReason(extractError)}</p>
        )}
        {onManualExtract && (
          <button
            onClick={handleExtractClick}
            disabled={isExtracting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {isExtracting
              ? <><Loader2 className="w-4 h-4 animate-spin" />Extracting…</>
              : <><Sparkles className="w-4 h-4" />Extract BOQ</>}
          </button>
        )}
      </div>
    );
  }

  if (status === 'no_boq_found') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
        <FileText className="w-10 h-10 text-slate-300" />
        <p className="font-semibold text-slate-600">No BOQ detected</p>
        <p className="text-sm text-center max-w-sm text-slate-400">
          This tender document does not appear to contain a structured Bill of Quantities.
        </p>
        {onManualExtract && (
          <button
            onClick={handleRetryExtraction}
            disabled={isExtracting}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isExtracting ? 'animate-spin' : ''}`} />
            Try extraction again
          </button>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <ErrorUI
        title="Unable to extract BOQ"
        reason={failReason}
        onRetry={handleRetryExtraction}
        retrying={isExtracting}
        retryLabel={onManualExtract ? 'Retry extraction' : 'Refresh'}
      />
    );
  }

  // ── status === 'done' ──────────────────────────────────────────────────────
  const totalFiltered = sorted.reduce((s, it) => s + (it.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-indigo-50 rounded-xl p-4">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-1">Items</p>
          <p className="text-2xl font-bold text-indigo-700">{meta?.itemCount ?? items.length}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 col-span-1 sm:col-span-1">
          <p className="text-xs font-medium text-amber-600 uppercase tracking-wide mb-1">Total (₹)</p>
          <p className="text-xl font-bold text-amber-700 break-all">{fmtIndian(meta?.totalAmount ?? 0)}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Engine</p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-sm font-semibold text-slate-700">
              {meta?.visionUsed ? 'AI Assisted' : 'Parser'}
            </p>
            {meta?.visionUsed && <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Confidence</p>
          <p className="text-sm font-semibold text-slate-700 mt-1">{meta?.verificationScore ?? 0}/100</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Parse Time</p>
          <p className="text-sm font-semibold text-slate-700 mt-1">
            {((meta?.parserDurationMs ?? 0) / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search items or descriptions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isGridMode && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 px-2">
              {saveState === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>}
              {saveState === 'saved' && <><Check className="w-3.5 h-3.5 text-emerald-500" /> Saved</>}
              {saveState === 'error' && <><AlertCircle className="w-3.5 h-3.5 text-rose-500" /> Save failed</>}
            </span>
          )}
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          {!isGridMode && (
            <button
              onClick={onProceedToPricing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Proceed to Pricing <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Percentage-rate summary strip — read-only, sourced entirely from
          boq (already computed/synced by BOQSection). No new calculation. */}
      {boqType === 'percentage_rate' && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-5 py-4">
          {boq?.estimatedAmount != null ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-1">Estimated Amount</p>
                <p className="text-lg font-bold text-indigo-900">{fmtIndian(boq.estimatedAmount)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-1">Bid</p>
                <p className="text-lg font-bold text-indigo-900">
                  {boq.percentage == null
                    ? '—'
                    : boq.percentage === 0
                    ? 'At Par'
                    : `${boq.aboveBelow === 'above' ? '↑' : '↓'} ${boq.percentage}% ${boq.aboveBelow}`}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-1">Final Bid Amount</p>
                <p className="text-lg font-bold text-indigo-900">
                  {boq.quotedAmount != null ? fmtIndian(boq.quotedAmount) : '— enter % in the Bid Engine tab'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-indigo-700">
              Confirm the estimated amount in the Bid Engine &amp; Profit Calculator tab to see the bid summary here.
            </p>
          )}
          <p className="text-[11px] text-indigo-400 mt-2">
            Percentage-rate tenders submit a single percentage and total — these figures are presentational only, not per-item rates.
          </p>
        </div>
      )}

      {/* Table */}
      {isGridMode ? (
        <BoqPricingGrid
          items={sorted}
          pricingKeys={sorted.map(item => pricingKeyById.get(item.id)!)}
          pricing={pricing}
          duplicateItemNos={duplicateItemNos}
          onFieldChange={handlePricingFieldChange}
          labels={gridLabels}
        />
      ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">
                <button className="flex items-center gap-1" onClick={() => handleSort('itemNo')}>
                  Item No <SortIcon field="itemNo" sortField={sortField} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 min-w-[200px]">Description</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">Unit</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">
                <button className="flex items-center gap-1 ml-auto" onClick={() => handleSort('quantity')}>
                  Quantity <SortIcon field="quantity" sortField={sortField} sortDir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">Est. Rate (₹)</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">
                <button className="flex items-center gap-1 ml-auto" onClick={() => handleSort('amount')}>
                  Amount (₹) <SortIcon field="amount" sortField={sortField} sortDir={sortDir} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No items match your search.
                </td>
              </tr>
            ) : sorted.map(item => {
              const expanded = expandedDescs.has(item.id);
              const longDesc = item.description.length > 80;
              return (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap align-top">{item.itemNo}</td>
                  <td className="px-4 py-3 text-slate-700 max-w-xs">
                    <div className={expanded ? '' : 'line-clamp-2'}>{item.description}</div>
                    {longDesc && (
                      <button
                        onClick={() => toggleDesc(item.id)}
                        className="text-xs text-indigo-500 hover:underline mt-0.5 flex items-center gap-0.5"
                      >
                        {expanded
                          ? <><ChevronUp className="w-3 h-3" />Show less</>
                          : <><ChevronDown className="w-3 h-3" />Show more</>}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap align-top">{item.unit}</td>
                  <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap align-top">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap align-top">
                    {item.estimatedRate !== undefined ? fmtIndian(item.estimatedRate) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700 whitespace-nowrap align-top">
                    {item.amount !== undefined ? fmtIndian(item.amount) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold text-slate-600">
                  {search ? `${sorted.length} of ${items.length} items` : `${sorted.length} items`}
                </td>
                <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                  ₹{fmtIndian(totalFiltered)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
    </div>
  );
}
