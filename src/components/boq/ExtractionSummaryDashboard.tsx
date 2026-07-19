import { useMemo, useState } from 'react';
import type { ExtractionResult } from '../../types/boq';

interface ExtractionSummaryDashboardProps {
  result: ExtractionResult;
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function ExtractionSummaryDashboard({ result }: ExtractionSummaryDashboardProps) {
  const { confidence, detectedBoqType, tables, items } = result;
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const boqSchedules = useMemo(() => tables.filter(t => t.type === 'boq_schedule'), [tables]);
  const rateAnalysisTables = useMemo(() => tables.filter(t => t.type === 'rate_analysis'), [tables]);
  const ignoredTables = useMemo(() => tables.filter(t => t.type === 'other'), [tables]);

  const totalEstimatedAmount = useMemo(() => {
    const amounts = items.filter(i => i.amount !== undefined).map(i => i.amount!);
    return amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) : null;
  }, [items]);

  // Count from warnings; tableReconstruction does not currently emit per-merge warnings
  const repeatedHeadersRemoved = useMemo(
    () => confidence.warnings.filter(w => w.includes('Repeated header row removed')).length,
    [confidence.warnings],
  );

  // tableReconstruction.ts merges wrapped descriptions silently (no counter emitted)
  const wrappedMergeCount = 0;

  const actionableWarnings = useMemo(
    () => confidence.warnings.filter(w => !w.includes('Repeated header row removed')),
    [confidence.warnings],
  );

  const status: 'success' | 'warning' | 'failed' =
    items.length === 0
      ? 'failed'
      : confidence.warnings.length > 0 || confidence.overallConfidence < 80
      ? 'warning'
      : 'success';

  const statusBadge = {
    success: { label: '✅ Successful', cls: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
    warning: { label: '⚠ Completed with warnings', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
    failed: { label: '❌ Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  }[status];

  const typeBadge = {
    percentage_rate: { label: 'Percentage Rate', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
    item_rate: { label: 'Item Rate', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
    unknown: { label: 'Unknown', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  }[detectedBoqType];

  const confColor = (pct: number) =>
    pct >= 80
      ? 'text-green-600 dark:text-green-400'
      : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:bg-gray-900 dark:border-gray-700">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Extraction Summary</h3>
        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 px-5 py-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Tender Type</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeBadge.cls}`}>
            {typeBadge.label}
          </span>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Overall Confidence</p>
          <p className={`text-sm font-semibold ${confColor(confidence.overallConfidence)}`}>
            {confidence.overallConfidence}%
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Header Confidence</p>
          <p className={`text-sm font-semibold ${confColor(confidence.headerConfidence)}`}>
            {confidence.headerConfidence}%
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total BOQ Items</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{items.length}</p>
        </div>

        {totalEstimatedAmount !== null && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Estimated Amount</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">₹{fmt(totalEstimatedAmount)}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Repeated Headers Removed</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{repeatedHeadersRemoved}</p>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wrapped Descriptions Merged</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{wrappedMergeCount}</p>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Tables Ignored</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{ignoredTables.length}</p>
        </div>
      </div>

      {/* BOQ schedules found */}
      {boqSchedules.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">BOQ Schedules Found</p>
          <div className="flex flex-wrap gap-1.5">
            {boqSchedules.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800"
              >
                {t.title || `Schedule ${i + 1}`}
                &nbsp;({t.items.length} {t.items.length === 1 ? 'Item' : 'Items'})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rate analysis tables found */}
      {rateAnalysisTables.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Rate Analysis Tables Found</p>
          <div className="flex flex-wrap gap-1.5">
            {rateAnalysisTables.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600"
              >
                {t.title || `RA-${i + 1}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible warnings */}
      {actionableWarnings.length > 0 && (
        <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <button
            onClick={() => setWarningsOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
          >
            <span>{warningsOpen ? '▾' : '▸'}</span>
            Extraction Warnings ({actionableWarnings.length})
          </button>
          {warningsOpen && (
            <ul className="mt-2 space-y-1 pl-4">
              {actionableWarnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-700 dark:text-amber-400 list-disc">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Debug section — dev only */}
      {import.meta.env.DEV && (
        <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <button
            onClick={() => setDebugOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs font-mono text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:underline"
          >
            <span>{debugOpen ? '▾' : '▸'}</span>
            Debug Details
          </button>
          {debugOpen && (
            <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-auto max-h-64 text-gray-700 dark:text-gray-300 leading-relaxed">
              {JSON.stringify(
                {
                  tablesDetected: tables.length,
                  tableClassifications: tables.map(t => ({
                    type: t.type,
                    title: t.title ?? null,
                    itemCount: t.items.length,
                    headerRowIndex: t.header?.headerRowIndex ?? null,
                    headerConfidence: t.header?.confidence ?? null,
                    mappedColumns: t.header?.mappedCount ?? null,
                  })),
                  overallConfidence: confidence.overallConfidence,
                  headerConfidence: confidence.headerConfidence,
                  rowsExtracted: confidence.rowsExtracted,
                  repeatedHeadersRemoved,
                  wrappedDescriptionsMerged: wrappedMergeCount,
                  allWarnings: confidence.warnings,
                },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
