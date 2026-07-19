/// <reference types="vite/client" />
import { useState } from 'react';
import type { ExtractionResult } from '../types/boq';
import { extractBoqFromPdf } from '../services/boqPdfExtractService';

export default function BoqDebugView() {
  if (!import.meta.env.DEV) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500 text-sm">
        This page is only available in development mode.
      </div>
    );
  }

  return <BoqDebugViewDev />;
}

function BoqDebugViewDev() {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const r = await extractBoqFromPdf(buffer);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-800">BOQ Extraction Debug View</h1>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        Development only — not visible in production.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Upload PDF</label>
        <input type="file" accept=".pdf" onChange={handleFile} className="text-sm" />
      </div>

      {loading && <p className="text-sm text-gray-500">Extracting…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-6">
          {/* Confidence summary */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Confidence</h2>
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto">
              {JSON.stringify(result.confidence, null, 2)}
            </pre>
          </section>

          {/* Detected type */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Detected BOQ Type</h2>
            <span className="rounded bg-indigo-100 text-indigo-800 px-2 py-0.5 text-xs font-medium">
              {result.detectedBoqType}
            </span>
            {result.isScanned && (
              <span className="ml-2 rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">
                Scanned PDF
              </span>
            )}
          </section>

          {/* Tables */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Tables ({result.tables.length})</h2>
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto max-h-64">
              {JSON.stringify(result.tables.map(t => ({
                type: t.type,
                title: t.title,
                itemCount: t.items.length,
                header: t.header ? { confidence: t.header.confidence, mappedCount: t.header.mappedCount, mapping: t.header.mapping } : null,
              })), null, 2)}
            </pre>
          </section>

          {/* Items */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Items ({result.items.length})</h2>
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto max-h-64">
              {JSON.stringify(result.items, null, 2)}
            </pre>
          </section>

          {/* Raw text */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Raw Text (first 2000 chars)</h2>
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto max-h-40 whitespace-pre-wrap">
              {result.rawText.slice(0, 2000)}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
