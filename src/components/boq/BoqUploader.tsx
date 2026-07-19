import { useCallback, useRef } from 'react';
import useBoqImport from '../../hooks/useBoqImport';
import type { ExtractionResult } from '../../types/boq';
import BoqPreview from './BoqPreview';
import ColumnMapper from './ColumnMapper';
import ExtractionSummaryDashboard from './ExtractionSummaryDashboard';

interface BoqUploaderProps {
  onResult: (result: ExtractionResult) => void;
}

export default function BoqUploader({ onResult }: BoqUploaderProps) {
  const { state, result, pendingMapping, error, importFile, applyManualMapping, reset } = useBoqImport();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) importFile(file);
  }, [importFile]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importFile(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  if (state === 'ready' && result) {
    return (
      <div className="space-y-4">
        <ExtractionSummaryDashboard result={result} />
        <BoqPreview
          result={result}
          onReset={() => {
            reset();
            onResult(result);
          }}
        />
      </div>
    );
  }

  if (state === 'scanned') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This appears to be a scanned PDF. OCR support will be added in a future release.
        </div>
        <button
          onClick={reset}
          className="text-sm text-indigo-600 hover:text-indigo-800 underline"
        >
          Try another file
        </button>
      </div>
    );
  }

  if (state === 'needs_mapping' && result) {
    // Derive ColumnAnchors from the header mapping key indices (raw anchors aren't stored in ExtractionResult)
    const firstTable = result.tables.find(t => t.header);
    const colIndices = firstTable?.header
      ? Object.keys(firstTable.header.mapping).map(Number)
      : [];
    const derivedColumns = colIndices.map(i => ({ index: i, x: i * 50, spanWidth: 40 }));

    return (
      <div className="space-y-4">
        <ExtractionSummaryDashboard result={result} />
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Manual column mapping required</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              Header confidence is below 80%. Please assign a role to each column before the BOQ preview is shown.
            </p>
          </div>
        </div>
        <ColumnMapper
          columns={derivedColumns.length > 0 ? derivedColumns : [{ index: 0, x: 0, spanWidth: 40 }]}
          sampleRows={[]}
          currentMapping={pendingMapping ?? {}}
          onApply={applyManualMapping}
        />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? 'An error occurred during extraction.'}
        </div>
        <button
          onClick={reset}
          className="text-sm text-indigo-600 hover:text-indigo-800 underline"
        >
          Try another file
        </button>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-6 py-8 justify-center">
        <svg className="animate-spin h-5 w-5 text-indigo-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3V0a12 12 0 100 24v-4l-3 3 3 3v4A12 12 0 014 12z" />
        </svg>
        <span className="text-sm text-gray-600">Extracting BOQ data…</span>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onClick={() => inputRef.current?.click()}
      className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xls,.xlsx"
        className="hidden"
        onChange={handleFileChange}
      />
      <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">Drop your BOQ file here</p>
        <p className="text-xs text-gray-500 mt-1">PDF, XLS, or XLSX — click to browse</p>
      </div>
    </div>
  );
}
