/**
 * ModeBReviewPanel — field review + edit UI for Mode B (exact-form overlay).
 *
 * Pure display component: receives MappedField[] from the mapper, lets the
 * user edit every value before export, and calls onExport with the final list.
 * The overlay + download happens in the parent; this panel is stateless w.r.t.
 * the PDF itself.
 *
 * Status colour contract (matches FieldStatus in types.ts):
 *   filled       → emerald  (auto-filled from profile/tender, editable)
 *   blank        → amber    (field recognised, profile value missing)
 *   needs_review → red      (unrecognised label, overflow, or yes/no)
 *   skip         → slate    (signature / seal — write nothing, never export text)
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import {
  CheckCircle2, AlertTriangle, EyeOff, Eye,
  Download, X, FileText, Loader2,
} from 'lucide-react';
import type { MappedField, FieldStatus } from '../../lib/modeb/types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ModeBReviewPanelProps {
  mappedFields: MappedField[];
  pageW: number;
  pageH: number;
  pageCount: number;
  formName?: string;
  exporting?: boolean;
  onExport: (editedFields: MappedField[]) => Promise<void>;
  onCancel: () => void;
}

// ── Per-status styling ──────────────────────────────────────────────────────────

type StatusStyle = {
  label: string;
  badge: string;
  ring: string;    // left border (border-l-4)
  rowBg: string;
  input: string;
  miniBox: string; // classes for the page-miniature box
};

const STYLE: Record<FieldStatus, StatusStyle> = {
  filled: {
    label: 'Auto-filled',
    badge: 'bg-emerald-100 text-emerald-700',
    ring: 'border-l-emerald-400',
    rowBg: 'bg-white hover:bg-emerald-50/40',
    input: 'border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100',
    miniBox: 'border-emerald-500 bg-emerald-200/60',
  },
  blank: {
    label: 'Needs data',
    badge: 'bg-amber-100 text-amber-700',
    ring: 'border-l-amber-400',
    rowBg: 'bg-amber-50/30 hover:bg-amber-50/60',
    input: 'border-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-100 placeholder:text-amber-300',
    miniBox: 'border-amber-500 bg-amber-200/60',
  },
  needs_review: {
    label: 'Review',
    badge: 'bg-red-100 text-red-700',
    ring: 'border-l-red-400',
    rowBg: 'bg-red-50/30 hover:bg-red-50/60',
    input: 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-100',
    miniBox: 'border-red-500 bg-red-200/70',
  },
  skip: {
    label: 'Physical',
    badge: 'bg-slate-100 text-slate-500',
    ring: 'border-l-slate-200',
    rowBg: 'bg-slate-50/60',
    input: 'border-slate-200 bg-slate-50 cursor-not-allowed text-slate-400',
    miniBox: 'border-slate-400 bg-slate-200/40',
  },
};

// ── Page miniature ─────────────────────────────────────────────────────────────

const MINI_W = 258; // px — right-panel width minus padding

interface MiniField extends MappedField { idx: number }

function PageMiniature({
  fields, pageW, pageH, selectedIdx, onSelect,
}: {
  fields: MiniField[];
  pageW: number;
  pageH: number;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  const scale  = MINI_W / pageW;
  const miniH  = Math.round(scale * pageH);

  return (
    <div
      className="relative border border-slate-300 shadow-inner rounded bg-white overflow-hidden select-none mx-auto"
      style={{ width: MINI_W, height: miniH }}
      role="img"
      aria-label="Page field positions"
    >
      {/* Subtle ruled lines to evoke a paper form */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(transparent, transparent calc(18px - 1px), #e2e8f0 18px)',
          backgroundSize: '100% 18px',
        }}
      />

      {fields.map(({ idx, pdfRect, status }) => {
        // Convert PDF bottom-left → CSS top-left
        const top  = Math.round(scale * (pageH - pdfRect.y - pdfRect.height));
        const left = Math.round(scale * pdfRect.x);
        const w    = Math.max(Math.round(scale * pdfRect.width),  2);
        const h    = Math.max(Math.round(scale * pdfRect.height), 2);
        const sel  = selectedIdx === idx;

        return (
          <button
            key={idx}
            aria-label={`Jump to field ${idx + 1}`}
            onClick={() => onSelect(idx)}
            className={`absolute border transition-all cursor-pointer outline-none ${
              sel
                ? 'border-indigo-600 bg-indigo-400/50 ring-1 ring-indigo-500 z-10'
                : `${STYLE[status].miniBox} border hover:opacity-90`
            }`}
            style={{ top, left, width: w, height: h }}
          />
        );
      })}
    </div>
  );
}

// ── Tab definition ─────────────────────────────────────────────────────────────

type TabKey = 'all' | FieldStatus;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'filled',       label: 'Auto-filled' },
  { key: 'blank',        label: 'Needs data' },
  { key: 'needs_review', label: 'Review' },
  { key: 'skip',         label: 'Skipped' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function ModeBReviewPanel({
  mappedFields,
  pageW,
  pageH,
  pageCount,
  formName,
  exporting = false,
  onExport,
  onCancel,
}: ModeBReviewPanelProps) {
  // Local editable values, keyed by field index
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(mappedFields.map((f, i) => [i, f.value])),
  );

  const [tab,        setTab]        = useState<TabKey>('all');
  const [miniPage,   setMiniPage]   = useState(1);
  const [selectedIdx, setSelected]  = useState<number | null>(null);
  const [showMini,   setShowMini]   = useState(true);

  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const setValue = useCallback((idx: number, val: string) => {
    setValues(prev => ({ ...prev, [idx]: val }));
  }, []);

  // Derive effective status from current edited value
  const effSt = useCallback((idx: number, original: FieldStatus): FieldStatus => {
    if (original === 'skip') return 'skip';
    const val = (values[idx] ?? '').trim();
    if (val) return 'filled';
    return original === 'filled' ? 'blank' : original;
  }, [values]);

  // Counts for tab badges + progress
  const counts = useMemo<Record<TabKey, number>>(() => {
    const c = { all: 0, filled: 0, blank: 0, needs_review: 0, skip: 0 } as Record<TabKey, number>;
    mappedFields.forEach((f, i) => { c.all++; c[effSt(i, f.status)]++; });
    return c;
  }, [mappedFields, effSt]);

  const { filledCount, totalNonSkip } = useMemo(() => {
    let filled = 0, total = 0;
    mappedFields.forEach((f, i) => {
      if (f.status === 'skip') return;
      total++;
      if (effSt(i, f.status) === 'filled') filled++;
    });
    return { filledCount: filled, totalNonSkip: total };
  }, [mappedFields, effSt]);

  const pct = totalNonSkip > 0 ? Math.round((filledCount / totalNonSkip) * 100) : 0;

  // Filtered list
  const filtered = useMemo(() =>
    mappedFields
      .map((f, i) => ({ ...f, idx: i }))
      .filter(f => tab === 'all' || effSt(f.idx, f.status) === tab),
    [mappedFields, tab, effSt],
  );

  // Fields on the currently-previewed page
  const miniFields = useMemo(() =>
    mappedFields
      .map((f, i) => ({ ...f, idx: i }))
      .filter(f => (f.page ?? 1) === miniPage),
    [mappedFields, miniPage],
  );

  const selectField = useCallback((idx: number) => {
    setSelected(idx);
    setMiniPage(mappedFields[idx].page ?? 1);
    rowRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mappedFields]);

  const handleExport = async () => {
    const edited = mappedFields.map((f, i) => {
      if (f.status === 'skip') return f;
      const val = values[i] ?? '';
      const st  = val.trim() ? 'filled' : (f.status === 'filled' ? 'blank' : f.status);
      return { ...f, value: val, status: st as FieldStatus };
    });
    await onExport(edited);
  };

  const needsAction = counts.blank + counts.needs_review;

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-5 py-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
            <h2 className="font-bold text-slate-800 text-sm truncate">
              {formName ? `Review: ${formName}` : 'Review Filled Form'}
            </h2>
          </div>
          <button
            onClick={onCancel}
            disabled={exporting}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1 rounded shrink-0 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1 ml-6">
          Review and confirm every field before export — this is a legal submission.
        </p>

        {/* Progress bar */}
        <div className="mt-3 ml-6">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-600">
              <span className="font-bold">{filledCount}</span>
              <span className="text-slate-400"> / {totalNonSkip} fields ready</span>
            </span>
            <span className={`font-bold tabular-nums ${
              pct === 100 ? 'text-emerald-600' : pct >= 70 ? 'text-indigo-600' : 'text-amber-600'
            }`}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                pct === 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-indigo-500' : 'bg-amber-400'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: field list ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Filter tabs */}
          <div className="flex items-center bg-white border-b border-slate-100 px-3 overflow-x-auto shrink-0 gap-0.5">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  tab === key
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
                {counts[key] > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                    tab === key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {counts[key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Field rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filtered.length === 0 && (
              <div className="p-10 text-center text-slate-400 text-sm">
                No fields in this category.
              </div>
            )}

            {filtered.map(({ idx, field_label, page, status, source }) => {
              const es       = effSt(idx, status);
              const val      = values[idx] ?? '';
              const isMulti  = val.includes('\n') || (mappedFields[idx].value ?? '').includes('\n');
              const isActive = selectedIdx === idx;

              return (
                <div
                  key={idx}
                  ref={el => { rowRefs.current[idx] = el; }}
                  onClick={() => { setSelected(idx); setMiniPage(page ?? 1); }}
                  className={`px-4 py-3 border-l-4 transition-colors cursor-default ${
                    STYLE[es].ring
                  } ${STYLE[es].rowBg} ${
                    isActive ? 'ring-1 ring-indigo-300 ring-inset' : ''
                  }`}
                >
                  {/* Label row */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0 tabular-nums">
                      P.{page ?? '?'}
                    </span>
                    <span
                      className="text-xs font-semibold text-slate-700 truncate flex-1 min-w-0"
                      title={field_label}
                    >
                      {field_label}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${STYLE[es].badge}`}>
                      {STYLE[es].label}
                    </span>
                  </div>

                  {/* Input / textarea / skip message */}
                  {es === 'skip' ? (
                    <p className="text-[10px] text-slate-400 italic pl-0.5">
                      Physical field — sign or stamp manually
                    </p>
                  ) : isMulti ? (
                    <textarea
                      rows={Math.min(val.split('\n').length + 1, 5)}
                      value={val}
                      onChange={e => setValue(idx, e.target.value)}
                      placeholder={es === 'blank' ? 'Enter value…' : 'Review and enter…'}
                      className={`w-full text-xs rounded border px-2 py-1.5 font-mono resize-y outline-none transition-colors ${STYLE[es].input}`}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <input
                      type="text"
                      value={val}
                      onChange={e => setValue(idx, e.target.value)}
                      placeholder={es === 'blank' ? 'Enter value…' : es === 'needs_review' ? 'Review and enter…' : ''}
                      className={`w-full text-xs rounded border px-2 py-1.5 font-mono outline-none transition-colors ${STYLE[es].input}`}
                      onClick={e => e.stopPropagation()}
                    />
                  )}

                  {/* Source provenance (filled fields only) */}
                  {es === 'filled' && source && (
                    <p className="text-[10px] text-slate-400 mt-1 pl-0.5 truncate" title={source}>
                      ↳ {source}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: page miniature (lg+ only) ──────────────────────────────── */}
        {showMini && (
          <div className="w-[300px] shrink-0 hidden lg:flex flex-col border-l border-slate-200 bg-slate-50 overflow-hidden">
            {/* Page tabs */}
            <div className="flex items-center gap-1 px-3 py-2.5 border-b border-slate-100 bg-white shrink-0">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mr-1">Page</span>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(pg => (
                <button
                  key={pg}
                  onClick={() => setMiniPage(pg)}
                  className={`w-6 h-6 text-xs font-bold rounded transition-colors ${
                    miniPage === pg
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {pg}
                </button>
              ))}
              <button
                onClick={() => setShowMini(false)}
                className="ml-auto text-slate-300 hover:text-slate-500 p-0.5 rounded transition-colors"
                title="Hide preview"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Miniature scroll area */}
            <div className="flex-1 overflow-auto p-3">
              <p className="text-[10px] text-slate-400 text-center mb-2">
                Click a box to jump to that field
              </p>
              <PageMiniature
                fields={miniFields}
                pageW={pageW}
                pageH={pageH}
                selectedIdx={selectedIdx}
                onSelect={selectField}
              />
              {/* Legend */}
              <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {(['filled', 'blank', 'needs_review', 'skip'] as FieldStatus[]).map(st => (
                  <span key={st} className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span className={`w-2.5 h-2.5 rounded-sm border ${STYLE[st].miniBox}`} />
                    {STYLE[st].label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Show-preview button when miniature is hidden */}
        {!showMini && (
          <button
            onClick={() => setShowMini(true)}
            className="hidden lg:flex flex-col items-center justify-center gap-1 w-7 border-l border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:bg-slate-50 transition-colors shrink-0"
            title="Show page preview"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-3 shrink-0">
        {/* Status summary */}
        <div className="text-xs min-w-0">
          {needsAction > 0 ? (
            <span className="text-amber-600 font-medium flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {needsAction} field{needsAction !== 1 ? 's' : ''} still need{needsAction === 1 ? 's' : ''} input
            </span>
          ) : (
            <span className="text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              All fields ready
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onCancel}
            disabled={exporting}
            className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-5 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60 shadow-sm"
          >
            {exporting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
              : <><Download className="w-4 h-4" /> Confirm &amp; Export PDF</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
