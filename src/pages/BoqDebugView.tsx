/// <reference types="vite/client" />
import { useState } from 'react';
import type { ExtractionResult, BoqItem, DetectedTable } from '../types/boq';
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

// ── Verification logic (mirrors scripts/verify-boq.ts) ────────────────────────

const EXPECTED_TOTAL        = 48_265.33;
const EXPECTED_ITEM_COUNT   = 41;
const MULTILINE_ITEMS       = ['13', '14', '26', '34', '36'];
const RATE_ANALYSIS_TITLES  = ['ra-1', 'ra-2', 'ra-3', 'cost aggregate', 's.d.b.c'];

interface Check {
  label: string;
  pass: boolean;
  detail: string[];
}

function runChecks(result: ExtractionResult): Check[] {
  const { tables, items } = result;
  const boqTables = tables.filter(t => t.type === 'boq_schedule');
  const raTables  = tables.filter(t => t.type === 'rate_analysis');

  // CHECK 1 — Reconciliation
  const itemsWithAmt   = items.filter(i => i.amount !== undefined);
  const computedTotal  = Math.round(itemsWithAmt.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
  const diff           = Math.abs(computedTotal - EXPECTED_TOTAL);
  const check1: Check = {
    label: 'Reconciliation — amounts sum to ₹48,265.33',
    pass:  diff < 1,
    detail: [
      `Items with amount: ${itemsWithAmt.length} / ${items.length}`,
      `Computed total: ₹${computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      `Expected total: ₹${EXPECTED_TOTAL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      `Difference: ₹${diff.toFixed(2)}`,
    ],
  };

  // CHECK 2 — Item count
  const extractedNos = items.map(i => i.itemNo.trim());
  const counts: Record<string, number> = {};
  for (const n of extractedNos) counts[n] = (counts[n] ?? 0) + 1;
  const duplicates = Object.entries(counts).filter(([, c]) => c > 1).map(([n, c]) => `${n}×${c}`);
  const expectedNos = Array.from({ length: EXPECTED_ITEM_COUNT }, (_, i) => String(i + 1));
  const missing = expectedNos.filter(n => !extractedNos.includes(n));
  const check2: Check = {
    label: `Item count — all ${EXPECTED_ITEM_COUNT} items extracted`,
    pass:  items.length === EXPECTED_ITEM_COUNT && missing.length === 0 && duplicates.length === 0,
    detail: [
      `Extracted: ${items.length} items`,
      missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'No missing items',
      duplicates.length > 0 ? `Duplicates: ${duplicates.join(', ')}` : 'No duplicates',
      `Item numbers: ${extractedNos.join(', ')}`,
    ],
  };

  // CHECK 3 — Classification
  const raInBoq = boqTables.filter(t =>
    RATE_ANALYSIS_TITLES.some(pat => (t.title ?? '').toLowerCase().includes(pat))
  );
  const leakRe = /\b(material|labour|labor|machinery|transport|overhead|profit)\b/i;
  const leaked = items.filter(i => leakRe.test(i.description) && !/^\d+$/.test(i.itemNo));
  const check3: Check = {
    label: 'Classification — RA tables excluded, no row leakage',
    pass:  raInBoq.length === 0 && leaked.length === 0,
    detail: [
      `Tables: ${tables.length} total (${boqTables.length} BOQ, ${raTables.length} rate_analysis, ${tables.length - boqTables.length - raTables.length} other)`,
      ...tables.map(t => `  [${t.type}] "${t.title ?? '(no title)'}"  items=${t.items.length}`),
      raInBoq.length > 0 ? `⚠ RA tables wrongly in boq_schedule: ${raInBoq.map(t => t.title).join(', ')}` : '✓ No RA tables in boq_schedule',
      leaked.length > 0 ? `⚠ ${leaked.length} material/labour rows leaked: ${leaked.map(i => `[${i.itemNo}]`).join(', ')}` : '✓ No row leakage',
    ],
  };

  // CHECK 4 — Descriptions
  const descProblems: string[] = [];
  const descDetail: string[] = [];
  for (const no of MULTILINE_ITEMS) {
    const item = items.find(i => i.itemNo.trim() === no);
    if (!item) {
      descProblems.push(`item ${no} not found`);
      descDetail.push(`Item ${no}: NOT FOUND`);
    } else {
      const len = item.description.trim().length;
      descDetail.push(`Item ${no} (${len}c): ${item.description.slice(0, 100)}${len > 100 ? '…' : ''}`);
      if (len < 60) descProblems.push(`item ${no} truncated (${len} chars)`);
    }
  }
  const phantoms = items.filter(i => i.description.trim().length === 0 && i.quantity === 0);
  if (phantoms.length > 0) descProblems.push(`${phantoms.length} phantom rows`);
  const check4: Check = {
    label: 'Descriptions — items 13,14,26,34,36 intact, no phantom rows',
    pass:  descProblems.length === 0,
    detail: [
      ...descDetail,
      phantoms.length > 0 ? `Phantom rows: ${phantoms.map(i => i.itemNo).join(', ')}` : 'No phantom rows',
    ],
  };

  // CHECK 5 — Column mapping
  const check5: Check = {
    label: 'Column mapping — BOQ header mapped with confidence',
    pass:  boqTables.some(t => t.header && t.header.confidence >= 60),
    detail: tables.map(t => {
      if (!t.header) return `  [${t.type}] "${t.title ?? '(no title)'}" — no header`;
      const { mapping, confidence, mappedCount, totalColumns } = t.header;
      const cols = Object.entries(mapping).map(([ci, r]) => `col[${ci}]→${r}`).join(', ');
      return `  [${t.type}] conf=${confidence.toFixed(0)}% (${mappedCount}/${totalColumns} cols) | ${cols}`;
    }),
  };

  return [check1, check2, check3, check4, check5];
}

// ── Component ─────────────────────────────────────────────────────────────────

function BoqDebugViewDev() {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'checks' | 'tables' | 'items' | 'raw'>('checks');

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
      setTab('checks');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const checks = result ? runChecks(result) : [];
  const passCount = checks.filter(c => c.pass).length;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <h1 className="text-xl font-bold text-gray-800">BOQ Extraction Debug View</h1>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        Development only — not visible in production. Phase 2 Milestone 1 verification harness.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Upload PDF (Schedule-B1)</label>
        <input type="file" accept=".pdf" onChange={handleFile} className="text-sm" />
      </div>

      {loading && <p className="text-sm text-gray-500">Extracting…</p>}
      {error && <p className="text-sm text-red-600 font-mono">{error}</p>}

      {result && (
        <div className="space-y-4">
          {/* Score banner */}
          <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${passCount === 5 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <span className={`font-bold text-sm ${passCount === 5 ? 'text-green-800' : 'text-red-800'}`}>
              {passCount === 5 ? '✓ ALL CHECKS PASSED — safe to proceed to Milestone 2' : `✗ ${5 - passCount} CHECK(S) FAILED — fix extraction first`}
            </span>
            <span className={`text-xs font-mono px-2 py-1 rounded ${passCount === 5 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {passCount}/5
            </span>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-gray-200">
            {(['checks', 'tables', 'items', 'raw'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${tab === t ? 'bg-white border border-b-white border-gray-200 text-gray-900 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t === 'checks' ? `Verification (${passCount}/5)` : t === 'tables' ? `Tables (${result.tables.length})` : t === 'items' ? `Items (${result.items.length})` : 'Raw Text'}
              </button>
            ))}
          </div>

          {/* Verification checks tab */}
          {tab === 'checks' && (
            <div className="space-y-3">
              {checks.map((check, i) => (
                <div key={i} className={`rounded-lg border p-3 ${check.pass ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-start gap-2 mb-2">
                    <span className={`text-sm font-bold shrink-0 ${check.pass ? 'text-green-700' : 'text-red-700'}`}>
                      {check.pass ? '✓' : '✗'} CHECK {i + 1}
                    </span>
                    <span className={`text-sm font-medium ${check.pass ? 'text-green-800' : 'text-red-800'}`}>{check.label}</span>
                  </div>
                  <pre className="text-[11px] font-mono text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {check.detail.join('\n')}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Tables tab */}
          {tab === 'tables' && (
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto max-h-[600px] whitespace-pre-wrap">
              {JSON.stringify(result.tables.map(t => ({
                type: t.type,
                title: t.title,
                itemCount: t.items.length,
                header: t.header ? {
                  confidence: t.header.confidence,
                  mappedCount: t.header.mappedCount,
                  totalColumns: t.header.totalColumns,
                  mapping: t.header.mapping,
                } : null,
              })), null, 2)}
            </pre>
          )}

          {/* Items tab */}
          {tab === 'items' && (
            <div className="space-y-1 max-h-[600px] overflow-auto">
              <div className="grid grid-cols-[3rem_3rem_1fr_3rem_6rem_6rem] gap-1 text-[10px] font-bold text-gray-500 px-2">
                <span>#</span><span>No</span><span>Description</span><span>Unit</span><span>Qty</span><span>Amount</span>
              </div>
              {result.items.map((item, i) => (
                <div key={item.id} className={`grid grid-cols-[3rem_3rem_1fr_3rem_6rem_6rem] gap-1 text-[11px] font-mono px-2 py-0.5 rounded ${i % 2 === 0 ? 'bg-gray-50' : ''}`}>
                  <span className="text-gray-400">{i + 1}</span>
                  <span className="font-semibold">{item.itemNo}</span>
                  <span className="text-gray-700 truncate" title={item.description}>{item.description}</span>
                  <span className="text-gray-500">{item.unit}</span>
                  <span className="text-right">{item.quantity}</span>
                  <span className="text-right">{item.amount !== undefined ? `₹${item.amount.toFixed(2)}` : '—'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Raw text tab */}
          {tab === 'raw' && (
            <pre className="rounded bg-gray-50 border border-gray-200 p-3 text-xs overflow-auto max-h-[600px] whitespace-pre-wrap">
              {result.rawText.slice(0, 5000)}
              {result.rawText.length > 5000 ? `\n… (${result.rawText.length - 5000} more chars truncated)` : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
